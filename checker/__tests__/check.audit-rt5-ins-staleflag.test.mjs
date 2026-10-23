// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ da91205.
// Roles: an opener (with sock reporters) who once restored a writer-reports
// hide of a part, so segment.restored is true FOREVER; the admin, whose
// decision to leave a copy visible should stand; a writer whose part writer
// reports hid.
// Code (checker/check.mjs):
//  - enforce(): `else if (seen.admin && !seg.restored)` (check.mjs ~482) treats
//    the admin's unhide as final only if the part was NEVER restored; an old
//    restore (of a reports hide, long before) makes the checker hide the copy
//    again right after the admin unhid it.
//  - hiddenByChecker loop: `keptRefund = !seg.hidden && seg.restored &&
//    !seg.refund_forfeited` (~575): a part restored long ago that the ADMIN
//    unhid (before the checker saw its own hide in place) looks like "my hide
//    never landed", so the checker hides it again.
//  - A writer-reports hide taken over by the checker (AB-071) is then
//    unhidden by the checker as soon as the writer types a citation (~580):
//    the reports' hide is undone with no opener or admin decision.
// Every test asserts the SAFE behaviour; a FAILING test proves the problem.
// Harness copied from checker/__tests__/check.audit-fc4.test.mjs.
// Copy into checker/__tests__/.
// =====================================================================
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
const unhides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false && String(o.args.seq) === "1");
const CITED = "From The Night Circus by Erin Morgenstern";

// Attack: the admin took over the copy (hidden_by 3) and unhid it; an old opener restore makes the checker re-hide it.
test("RT5-INS staleflag 1: an admin's unhide stands, even for a part its opener once restored", () => {
  const dir = workdir();
  const held = run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3, restored: true }) });
  assert.equal(held.ops.length, 0, "harness: the admin's hide is left alone");
  const { ops } = run(dir, { config, stories: story(), segments: part({ restored: true }) });
  assert.equal(hides(ops).length, 0, "RT5-INS staleflag 1: the checker hid again a copy the admin looked at and unhid");
});

// Control: the same without the old restore (passes today).
test("control: an admin's unhide stands for a part never restored", () => {
  const dir = workdir();
  run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3 }) });
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({}) }).ops).length, 0);
});

// Attack: the checker hid a visible copy (so its hide surely landed); the admin unhid it before the next run.
// Because the part was restored once long ago, the checker reads this as "my hide never landed" and hides it again.
test("RT5-INS staleflag 2: the admin unhiding the checker's hide before the next run is not undone", () => {
  const dir = workdir();
  const first = run(dir, { config, stories: story(), segments: part({ restored: true }) });
  assert.equal(hides(first.ops).length, 1, "harness: the visible copy is hidden");
  const { ops } = run(dir, { config, stories: story(), segments: part({ restored: true, hidden: false, hidden_by: 0 }) });
  assert.equal(hides(ops).length, 0, "RT5-INS staleflag 2: the checker re-hid a part the admin unhid (stale `restored` flag)");
});

// Control: the same without the old restore (passes today: treated as overruled).
test("control: the admin unhiding the checker's hide of a never-restored part stands", () => {
  const dir = workdir();
  run(dir, { config, stories: story(), segments: part({}) });
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({ hidden: false, hidden_by: 0 }) }).ops).length, 0);
});

// Attack (design): writer reports hid the part; the checker takes it over (AB-071); the writer then types a citation
// and the checker unhides it, undoing the writer reports' hide that neither the opener nor the admin lifted.
test("RT5-INS staleflag 3: a hide writer reports made is not lifted by the checker because of a citation", () => {
  const dir = workdir();
  const first = run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 1, hidden_by_reports: true }) });
  // With the AB-078 fix the checker takes over only a reports hide made for copying; this one gives no
  // reason, so it may stay the reports'. Run 2 shows the chain as run 1 left it (as fc5's C1 does).
  const tookOver = hides(first.ops).length;
  const { ops } = run(dir, { config, stories: story(), segments: tookOver
    ? part({ hidden: true, hidden_by: 2, citation: CITED })
    : part({ hidden: true, hidden_by: 1, hidden_by_reports: true, citation: CITED }) });
  assert.equal(unhides(ops).length, 0, "RT5-INS staleflag 3: the checker unhid a part writer reports had hidden");
});
