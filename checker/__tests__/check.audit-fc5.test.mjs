// Audit Bot fix check 5 (Swarmtales @ da91205): attacks on the copy checker's re-check of edited
// parts (AB-067) and its takeover of writer-reports hides (AB-071). Harness copied from the repo's
// checker/__tests__/check.audit-fc4.test.mjs (itself the Audit Bot's), plus sc.failStory: get_story
// for that story throws, as a busy public node does now and then.
// Every test asserts the SAFE behaviour: a failure is a finding.
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
  if (name === "get_story") {
    if (sc.failStory && String(sc.failStory) === String(args.story_id)) throw new Error("node busy (audit: a transient read error)");
    return sc.stories[String(args.story_id)] || {};
  }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc5-checker-"));
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


const ALICE = "1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq";
const MALLORY = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";
const unhides = (ops, seq = "1") => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false && String(o.args.seq) === seq);
const hidesOf = (ops, story, seq) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true &&
  String(o.args.story_id) === String(story) && String(o.args.seq) === String(seq));

test("C1: a part writer reports hid as abusive is never made visible by the checker because the writer cited a source", () => {
  const dir = workdir();
  // Writers reported a page of copied abusive text as ILLEGAL (reason 4); three reports hid it.
  const reported = part({ hidden: true, hidden_by: 1, hidden_by_reports: true, moderation_reason: 4 });
  const first = run(dir, { config, stories: story(), segments: reported });
  const tookOver = hides(first.ops).length;
  // If the takeover was sent, the chain now shows the checker's hide (reason COPYRIGHT); the writer
  // then names the book in the citation (allowed while hidden).
  const after = tookOver
    ? part({ hidden: true, hidden_by: 2, moderation_reason: 1, citation: "From The Night Circus by Erin Morgenstern" })
    : part({ hidden: true, hidden_by: 1, hidden_by_reports: true, moderation_reason: 4, citation: "From The Night Circus by Erin Morgenstern" });
  const second = run(dir, { config, stories: story(), segments: after });
  assert.equal(unhides(second.ops).length, 0,
    "the checker took over an abuse hide made by writer reports (takeover sent: " + tookOver + ") and then unhid it because the writer cited the source");
});

test("C2: a copy the older checker unhid on a citation is hidden again when the citation is cleared after the upgrade", () => {
  const dir = workdir();
  // State an older checker leaves: part 1 checked; it was hidden and then unhidden on the citation,
  // which deleted its hiddenByChecker entry. The part was never edited.
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: {} });
  const cited = run(dir, { config, stories: story(), segments: part({ citation: "From The Night Circus by Erin Morgenstern" }) });
  assert.equal(hides(cited.ops).length, 0, "harness: a cited copy is left alone");
  // The writer clears the citation (set_citation doesn't move last_activity_at; it is allowed even when blocked).
  const cleared = run(dir, { config, stories: story(), segments: part({ citation: "" }) });
  assert.equal(hides(cleared.ops).length, 1, "AB-067 (cite, then clear) is still open for parts unhidden before the upgrade: seen = " +
    JSON.stringify(cleared.state.seen && cleared.state.seen["1:1"]));
});

test("C3: an original is never hidden as a copy of a later copy of it because its writer fixed a typo", () => {
  const dir = workdir();
  const cfg2 = { moderator: MOD, next_story_id: "3" };
  const stA = (at) => ({ status: 1, segment_count: "1", last_activity_at: at });
  // Alice writes the original (story 1, t=1000). Mallory pastes it into story 2 at t=2000.
  const segs = (aliceText, aliceEdited) => ({
    "1:1": { status: 1, hidden: false, citation: "", author: ALICE, text: aliceText, created_at: "1000", ...(aliceEdited ? { last_edited_at: aliceEdited } : {}) },
    "2:1": { status: 1, hidden: false, citation: "", author: MALLORY, text: ORIGINAL, created_at: "2000" },
  });
  // Run 1: the node fails to return story 1 this once ("will retry next run"); story 2 is checked alone.
  run(dir, { config: cfg2, stories: { "1": stA("1000"), "2": stA("2000") }, segments: segs(ORIGINAL), failStory: "1" });
  // Run 2: story 1 is read; Alice's part is older than Mallory's, so it is clean.
  const r2 = run(dir, { config: cfg2, stories: { "1": stA("1000"), "2": stA("2000") }, segments: segs(ORIGINAL) });
  assert.equal(hidesOf(r2.ops, 1, 1).length, 0, "harness: the original is clean when first checked");
  // Run 3: Alice fixes one word of her own part (t=3000).
  const fixed = ORIGINAL.replace("so small", "so tiny");
  const r3 = run(dir, { config: cfg2, stories: { "1": stA("3000"), "2": stA("2000") }, segments: segs(fixed, "3000") });
  assert.equal(hidesOf(r3.ops, 1, 1).length, 0, "the checker hid Alice's original as a copy of Mallory's later copy of it");
});
