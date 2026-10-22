// Fourth October fix check: the copy checker checks a part again when its
// text or citation changes (AB-067), checks hidden parts and takes over a
// writer-reports hide (AB-071), and never hides again a copy whose checker
// hide was undone, for the same text. The harness (fake koilib and fetch, the
// real check.mjs in a child process) is the Audit Bot's, from
// check.audit-rt-sab-restored.test.mjs; it also logs part reads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));
const MOD = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";
const WRITER = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const TESTNET_CHAIN = "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==";
const BOOK = { title: "The Night Circus", author: "Erin Morgenstern" };
const COPIED =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black and white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
  "is black or white, painted or powdered, or treated with some other circus trick.";
const ORIGINAL =
  "Marta kept the lighthouse ledger in a hand so small that the gulls seemed to read it before she did. Every evening she " +
  "counted the boats that came home, wrote the wind in three words, and left the last line empty for the ones still out. " +
  "On the night of the long fog the empty line stayed empty until morning, and she sat with the lamp until its oil ran low, " +
  "listening for oars, for voices, for anything that was not the sea breathing against the rocks below the tower window. " +
  "When the first hull scraped the shingle she did not run; she wrote the time, then the name, then let the pen rest.";

const PRELOAD = String.raw`
import Module from "node:module";
import fs from "node:fs";
const sc = JSON.parse(fs.readFileSync(process.env.RT_SCENARIO, "utf8"));
const log = (e) => fs.appendFileSync(process.env.RT_LOG, JSON.stringify(e) + "\n");
function read(name, args) {
  if (name === "get_config") return sc.config;
  if (name === "get_story") return sc.stories[String(args.story_id)] || {};
  if (name === "get_segment") return sc.segments[args.story_id + ":" + args.seq] || {};
  if (name === "get_segments") {
    log({ read: name, start: String(args.start) });
    const st = sc.stories[String(args.story_id)] || {};
    const out = [];
    for (let s = Number(args.start); s < Number(args.start) + Number(args.limit) && s <= Number(st.segment_count || 0); s++)
      out.push(sc.segments[args.story_id + ":" + s] || {});
    return { values: out };
  }
  return {};
}
class Provider {
  async getChainId() { return sc.chainId; }
  async getAccountRc() { return sc.rc; }
}
class Signer {
  static fromWif() { return new Signer(); }
  getAddress() { return sc.config.moderator; }
}
class Contract {
  constructor() {
    this.functions = new Proxy({}, { get: (_, name) => async (args) => ({ result: read(String(name), args || {}) }) });
  }
  async encodeOperation(op) { return op; }
}
class Transaction {
  constructor() { this.ops = []; }
  async pushOperation(op) { this.ops.push(op); }
  async prepare() {}
  async sign() {}
  async send() { for (const op of this.ops) log({ op: op.name, args: op.args }); return { reverted: false }; }
  async wait() {}
}
const fake = { Provider, Signer, Contract, Transaction };
const load = Module._load;
Module._load = function (request) {
  if (request === "koilib") return fake;
  return load.apply(this, arguments);
};
globalThis.fetch = async (url) => {
  const q = new URL(String(url)).searchParams.get("q") || "";
  const phrase = q.replace(/^"|"$/g, "");
  // Only phrases from the copied page are "found" in the book (words compared
  // without edge punctuation, as pickPhrases builds them).
  const norm = (t) => String(t).replace(/\s+/g, " ").trim().split(" ")
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean).join(" ").toLowerCase();
  const items = sc.book && norm(sc.copiedText).includes(norm(phrase)) ? [{ id: "nc", volumeInfo: { title: sc.book.title, authors: [sc.book.author],
    infoLink: "https://books.google.com/books?id=nc" }, searchInfo: { textSnippet: phrase } }] : [];
  return { ok: true, status: 200, json: async () => ({ items }) };
};
`;

function workdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc4-checker-"));
  fs.writeFileSync(path.join(dir, "preload.mjs"), PRELOAD);
  return dir;
}

/** Runs check.mjs once against the scenario; returns { ops, reads, state, out }. */
function run(dir, scenario, env = {}) {
  const scen = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "ops.log");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(scen, JSON.stringify({ chainId: TESTNET_CHAIN, rc: "100000000", book: BOOK, copiedText: COPIED, ...scenario }));
  fs.writeFileSync(logFile, "");
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "preload.mjs")).href, CHECK], {
    env: {
      ...process.env,
      STORIES_ADDRESS: STORIES, RPC: "", EXPECTED_CHAIN_ID: "", DRY_RUN: "", TEST_PHRASE: "", GITHUB_STEP_SUMMARY: "",
      MODERATOR_WIF: "5Kfake-moderator-wif", GOOGLE_BOOKS_KEY: "fake-key", TAVILY_API_KEY: "", BRAVE_API_KEY: "", SEARCH_PER_RUN: "",
      STATE_FILE: stateFile, RT_SCENARIO: scen, RT_LOG: logFile, ...env,
    },
    cwd: dir, encoding: "utf8", timeout: 60000,
  });
  assert.equal(r.status, 0, "check.mjs did not finish: " + r.stdout + r.stderr);
  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
  return { ops: lines.filter((l) => l.op), reads: lines.filter((l) => l.read), state, out: r.stdout };
}

function writeState(dir, state) {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ checked: {}, swept: {}, index: {}, ...state }));
}

const config = { moderator: MOD, next_story_id: "2" };
const story = (extra) => ({ "1": { status: 1, segment_count: "1", ...extra } });
const part = (extra) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: COPIED, created_at: "1000", ...extra } });
const hides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && String(o.args.seq) === "1");
const notes = (ops) => ops.filter((o) => o.op === "set_source_note" && String(o.args.seq) === "1");

test("a part hidden by reports when first read is checked at once; a deferred check waits for the next run", () => {
  const dir = workdir();
  const reportsHidden = part({ hidden: true, hidden_by: 1, hidden_by_reports: true });
  // Too few searches left this run for the part's phrases: nothing happens, nothing is marked done.
  const first = run(dir, { config, stories: story(), segments: reportsHidden }, { SEARCH_PER_RUN: "1" });
  assert.equal(first.ops.length, 0);
  assert.equal(Number(first.state.checked["1"] || 0), 0, "the part waits for the next run");
  // Next run: the copy is found and the reports hide becomes the checker's.
  const { ops, state } = run(dir, { config, stories: story(), segments: reportsHidden });
  assert.equal(hides(ops).length, 1);
  assert.equal(state.checked["1"], 1);
  assert.ok(state.hiddenByChecker["1:1"], "remembered as the checker's hide");
});

test("a copy whose checker hide its opener restored is never hidden again for the same text, but is after an edit", () => {
  const dir = workdir();
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({}) }).ops).length, 1, "harness: hidden at first");
  // The opener restored it, which forfeits the refund.
  const restored = run(dir, { config, stories: story(), segments: part({ restored: true, refund_forfeited: true }) });
  assert.equal(hides(restored.ops).length, 0, "the opener's decision stands for this text");
  assert.equal(notes(restored.ops).length, 1, "it gets a source note instead");
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({ restored: true, refund_forfeited: true }) }).ops).length, 0);
  // The writer swaps in another copied page: new text, checked and hidden again.
  const other = COPIED.replace("The circus arrives without warning.", "The circus arrives at night.");
  const { ops } = run(dir, {
    config, stories: story(), copiedText: other,
    segments: part({ text: other, restored: true, refund_forfeited: true, source_note: "Parts of this text also appear in a book.", last_edited_at: "5000" }),
  });
  assert.equal(hides(ops).length, 1);
});

test("a copy the admin took over and later unhid is never hidden again by the checker", () => {
  const dir = workdir();
  run(dir, { config, stories: story(), segments: part({}) });
  run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3 }) });
  const { ops } = run(dir, { config, stories: story(), segments: part({}) });
  assert.equal(hides(ops).length, 0);
});

test("a copy found while the admin holds it is left to the admin, and stays unhidden if the admin unhides it", () => {
  const dir = workdir();
  const held = run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3 }) });
  assert.equal(held.ops.length, 0, "the moderator never touches an admin hide");
  assert.equal(held.state.seen["1:1"].v, "copy");
  const { ops } = run(dir, { config, stories: story(), segments: part({}) });
  assert.equal(hides(ops).length, 0, "the admin looked at it and unhid it");
});

test("a story unchanged since its last full read is not read again; a change in it is (AB-067)", () => {
  const dir = workdir();
  const quiet = story({ last_activity_at: "2000" });
  run(dir, { config, stories: quiet, segments: part({ text: ORIGINAL }) });
  const same = run(dir, { config, stories: quiet, segments: part({ text: ORIGINAL }) });
  assert.equal(same.reads.length, 0, "no part read again");
  const moved = run(dir, { config, stories: story({ last_activity_at: "3000" }), segments: part({ last_edited_at: "3000" }) });
  assert.ok(moved.reads.length > 0, "read again after activity");
  assert.equal(hides(moved.ops).length, 1, "the reworded copy is hidden");
});

test("a story active in the last few minutes is read in full again next run", () => {
  const dir = workdir();
  const recent = story({ last_activity_at: String(Math.floor(Date.now() / 1000)) });
  run(dir, { config, stories: recent, segments: part({ text: ORIGINAL }) });
  const again = run(dir, { config, stories: recent, segments: part({ text: ORIGINAL }) });
  assert.ok(again.reads.length > 0);
});

test("upgrading from an older checker: unedited parts count as checked; edited and hidden-when-read ones are checked", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 } });
  assert.equal(run(dir, { config, stories: story(), segments: part({}) }).ops.length, 0, "checked by the older checker");
  const edited = workdir();
  writeState(edited, { checked: { "1": 1 } });
  assert.equal(hides(run(edited, { config, stories: story(), segments: part({ last_edited_at: "2000" }) }).ops).length, 1);
  const never = workdir();
  writeState(never, { checked: { "1": 1 }, hiddenWhenRead: { "1:1": true } });
  const { ops, state } = run(never, { config, stories: story(), segments: part({}) });
  assert.equal(hides(ops).length, 1);
  assert.equal(state.hiddenWhenRead, undefined, "the old list is gone");
});

test("a cited copy is left alone, and hidden once the citation stops naming the source", () => {
  const dir = workdir();
  const cited = run(dir, { config, stories: story(), segments: part({ citation: "From The Night Circus by Erin Morgenstern" }) });
  assert.equal(cited.ops.length, 0);
  assert.equal(cited.state.seen["1:1"].v, "cited");
  const { ops } = run(dir, { config, stories: story(), segments: part({ citation: "my own words" }) });
  assert.equal(hides(ops).length, 1);
});
