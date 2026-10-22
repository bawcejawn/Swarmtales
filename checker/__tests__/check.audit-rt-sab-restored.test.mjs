// Red-team (Saboteur) attack tests, SwarmTales fix check @ d82364b.
// Target: checker/check.mjs (the copy checker, moderator key).
//
// Attack A ("hide it yourself, then restore it"), against the new
// state.hiddenWhenRead pass (check.mjs:416-435), whose comment promises
// "check each once it is visible again ... so restoring it never skips the check":
//   1. Three sock writer wallets report the copied part before the hourly run
//      (report_segment, threshold 3): hidden_by = 1 (reports).
//   2. The run sees it hidden and only records hiddenWhenRead (check.mjs:493).
//      The moderator could not hide it anyway: set_segment_hidden refuses an
//      already-hidden part for the moderator (Stories.ts:1220).
//   3. The opener restores it (allowed for hidden_by 1, Stories.ts:1508). That sets
//      seg.restored = true, and refund_forfeited stays false (only a hidden_by 2
//      restore forfeits, Stories.ts:1511).
//   4. Next run: hiddenWhenRead re-checks it, but checkPart never hides a part
//      with seg.restored (check.mjs:376 duplicates, :399 web copies) — it only
//      adds a source note. The copied text stays up for good, the checker can
//      never hide it, and the writer keeps the right to a full refund.
//   The repo's RT-IMP B test passes on a source note alone, which hides nothing.
//
// Attack B ("pass the check, then reword"): the checker reads each part once
// (state.checked, check.mjs:466) and never looks at edits. The writer posts
// original text, waits for the run, then edit_segment rewords it into copied
// text for free (rewording costs nothing, Stories.ts:876-880). Never checked.
//
// The real check.mjs runs in a child process with koilib and fetch replaced
// by in-memory fakes (harness copied from check.audit-rt-imp-unhide.test.mjs).
// Each attack test asserts the SAFE behaviour and FAILS while the attack works.
// Copy into checker/__tests__/ and run: node --test checker/__tests__/
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-sab-checker-"));
  fs.writeFileSync(path.join(dir, "preload.mjs"), PRELOAD);
  return dir;
}

/** Runs check.mjs once against the scenario; returns { ops, state, out }. */
function run(dir, scenario) {
  const scen = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "ops.log");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(scen, JSON.stringify({ chainId: TESTNET_CHAIN, rc: "100000000", book: BOOK, copiedText: COPIED, ...scenario }));
  fs.writeFileSync(logFile, "");
  const env = {
    ...process.env,
    STORIES_ADDRESS: STORIES, RPC: "", EXPECTED_CHAIN_ID: "", DRY_RUN: "", TEST_PHRASE: "", GITHUB_STEP_SUMMARY: "",
    MODERATOR_WIF: "5Kfake-moderator-wif",
    GOOGLE_BOOKS_KEY: "fake-key", TAVILY_API_KEY: "", BRAVE_API_KEY: "",
    STATE_FILE: stateFile, RT_SCENARIO: scen, RT_LOG: logFile,
  };
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "preload.mjs")).href, CHECK],
    { env, cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, "check.mjs did not finish: " + r.stdout + r.stderr);
  const ops = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
  return { ops, state, out: r.stdout };
}

const config = { moderator: MOD, next_story_id: "2" };
const story = { "1": { status: 1, segment_count: "1" } };
const part = (extra) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: COPIED, created_at: "1000", ...extra } });
const hides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && String(o.args.seq) === "1");
const acts = (ops) => ops.filter((o) => (o.op === "set_segment_hidden" || o.op === "set_source_note") && String(o.args.seq) === "1");

test("control: a fresh copied part is hidden by the checker", () => {
  const dir = workdir();
  const { ops } = run(dir, { config, stories: story, segments: part({}) });
  assert.equal(hides(ops).length, 1, "harness: the checker should hide a fresh copied part");
});

test("control: an original part is left alone", () => {
  const dir = workdir();
  const { ops } = run(dir, { config, stories: story, segments: part({ text: ORIGINAL }) });
  assert.equal(acts(ops).length, 0, "harness: the original text should pass");
});

test("RT-SAB A: a part sock reports hid before the run, then its opener restored, is still hidden by the checker", () => {
  const dir = workdir();
  // Run 1: hidden by 3 sock writer reports just before the run.
  run(dir, { config, stories: story, segments: part({ hidden: true, hidden_by: 1, hidden_by_reports: true }) });
  // Run 2: the opener restored it (restored = true); the copied text is visible.
  const { ops } = run(dir, { config, stories: story, segments: part({ restored: true }) });
  assert.equal(hides(ops).length, 1,
    "RT-SAB A: the checker never hid the copied part: it treats seg.restored as 'the opener overrode MY hide', " +
    "though the hide it overrode was the sock reports'. The copy stays up for good and stays refundable");
});

test("RT-SAB B: a part the checker passed, then reworded by its writer into copied text, is checked again", () => {
  const dir = workdir();
  // Run 1: the writer's original text passes.
  run(dir, { config, stories: story, segments: part({ text: ORIGINAL }) });
  // Run 2: edit_segment reworded it (free) into a copied page.
  const { ops } = run(dir, {
    config, stories: story,
    segments: part({ text: COPIED, last_edited_by: WRITER, last_edited_at: "5000" }),
  });
  assert.ok(acts(ops).length > 0,
    "RT-SAB B: the checker reads each part once (state.checked) and never re-checks an edited part: copied text added by a free edit is never looked at");
});
