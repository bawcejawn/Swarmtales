// Red-team (Impersonator) attack tests, SwarmTales fix check @ 00eec36.
// Target: checker/check.mjs, which signs with the MODERATOR key. Since
// AB-053 the moderator may unhide ANY part, including one the admin hid
// (hidden_by 3), so whatever makes the checker send an unhide is a way for a
// writer to act with the moderator's power.
//
// Attack A ("the writer unlocks the admin's hide through the checker"):
//   1. The checker decides to hide copied part P and records it in
//      state.hiddenByChecker, whether or not the hide was sent: it records it
//      when the moderator wallet has no mana, when the chain refused the hide,
//      and in every report-only run (no MODERATOR_WIF yet).
//      (A part the checker DID hide that the admin then re-hides with the
//      admin key, unhide+hide in one transaction as docs/TESTNET_UPGRADE_AUDIT2.md
//      tells the admin to do to lock old hides, gets the same entry.)
//   2. The admin hides P with the admin key (hidden_by 3) after a complaint,
//      so that the opener cannot restore it (AB-053).
//   3. The writer calls set_citation on P (allowed while hidden) naming the
//      book the checker found.
//   4. Next hourly run: the re-check loop sees seg.hidden + a covering
//      citation and sends set_segment_hidden(hidden=false) with the moderator
//      key. It never looks at seg.hidden_by, so the admin's hide is undone.
// Attack B ("hide it yourself first"): a part that is hidden when the
//   checker reads it (e.g. hidden by 3 sybil writer reports in the hour
//   before the run) is marked checked and skipped for good. The opener then
//   restores it (allowed: hidden_by 1) and the copied text is never checked.
//
// The real check.mjs is run in a child process with koilib and fetch
// replaced by in-memory fakes (no network, no chain). Each attack test
// asserts the SAFE behaviour and FAILS while the attack works. The
// "control" tests show the harness works (they pass on the current code).
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
const CITATION = "From The Night Circus by Erin Morgenstern";
const COPIED =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black and white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
  "is black or white, painted or powdered, or treated with some other circus trick.";

// Fake koilib + fetch, loaded with --import before check.mjs.
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
  const items = sc.book ? [{ id: "nc", volumeInfo: { title: sc.book.title, authors: [sc.book.author],
    infoLink: "https://books.google.com/books?id=nc" }, searchInfo: { textSnippet: phrase } }] : [];
  return { ok: true, status: 200, json: async () => ({ items }) };
};
`;

function workdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-imp-checker-"));
  fs.writeFileSync(path.join(dir, "preload.mjs"), PRELOAD);
  return dir;
}

/** Runs check.mjs once against the scenario; returns { ops, state }. */
function run(dir, scenario, { wif = true, books = false } = {}) {
  const scen = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "ops.log");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(scen, JSON.stringify({ chainId: TESTNET_CHAIN, rc: "100000000", book: null, ...scenario }));
  fs.writeFileSync(logFile, "");
  const env = {
    ...process.env,
    STORIES_ADDRESS: STORIES, RPC: "", EXPECTED_CHAIN_ID: "", DRY_RUN: "", TEST_PHRASE: "", GITHUB_STEP_SUMMARY: "",
    MODERATOR_WIF: wif ? "5Kfake-moderator-wif" : "",
    GOOGLE_BOOKS_KEY: books ? "fake-key" : "", TAVILY_API_KEY: "", BRAVE_API_KEY: "",
    STATE_FILE: stateFile, RT_SCENARIO: scen, RT_LOG: logFile,
  };
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "preload.mjs")).href, CHECK],
    { env, cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, "check.mjs did not finish: " + r.stdout + r.stderr);
  const ops = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  return { ops, state, out: r.stdout };
}

function writeState(dir, state) {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ checked: {}, swept: {}, index: {}, ...state }));
}

const config = { moderator: MOD, next_story_id: "2" };
const story = { "1": { status: 1, segment_count: "1" } };
const entry = { "1:1": { source: BOOK, label: "“The Night Circus” by Erin Morgenstern" } };
const hiddenPart = (hiddenBy) => ({
  "1:1": { status: 1, hidden: true, hidden_by: hiddenBy, citation: CITATION, author: WRITER, text: COPIED, created_at: "1000" },
});
const unhides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false && String(o.args.seq) === "1");

test("control: a part the checker itself hid comes back once the writer cites the source", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: entry });
  const { ops } = run(dir, { config, stories: story, segments: hiddenPart(2) });
  assert.equal(unhides(ops).length, 1, "harness: expected the moderator unhide of a checker-hidden part");
});

test("RT-IMP A1: the writer's citation never makes the checker unhide a part the ADMIN hid", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: entry });
  const { ops } = run(dir, { config, stories: story, segments: hiddenPart(3) });
  assert.equal(unhides(ops).length, 0,
    "RT-IMP A1: the checker used the moderator key to unhide a part hidden_by=3 (admin) because the writer set a citation");
});

// Step 1 of attack A: a hide that was never sent must not leave a
// "the checker hid this" record that a later citation can cash in.
for (const [name, opts, rc] of [
  ["the moderator wallet has no mana", { wif: true, books: true }, "0"],
  ["a report-only run (no moderator key)", { wif: false, books: true }, "100000000"],
]) {
  test("RT-IMP A2: no hiddenByChecker record when the hide was not sent (" + name + ")", () => {
    const dir = workdir();
    writeState(dir, {});
    const fresh = { "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: COPIED, created_at: "1000" } };
    const { ops, state, out } = run(dir, { config, stories: story, segments: fresh, book: BOOK, rc }, opts);
    assert.ok(/HIDE story 1 part 1/.test(out), "harness: the checker should have wanted to hide the copied part");
    assert.equal(ops.filter((o) => o.op === "set_segment_hidden").length, 0, "harness: nothing should have been sent");
    assert.equal((state.hiddenByChecker || {})["1:1"], undefined,
      "RT-IMP A2: the checker recorded a hide it never made; if the admin hides the part later, the writer's citation makes the checker unhide it");
  });
}

test("RT-IMP B: a part hidden (by reports) when the checker reads it is still checked after it is restored", () => {
  const dir = workdir();
  writeState(dir, {});
  // Run 1: three sybil writer reports hid the copied part just before the run.
  run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: true, hidden_by: 1, hidden_by_reports: true, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  // Run 2: the opener (who wrote it) restored it; the copied text is visible.
  const { ops } = run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: false, restored: true, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  const acted = ops.filter((o) => (o.op === "set_source_note" || o.op === "set_segment_hidden") && String(o.args.seq) === "1");
  assert.ok(acted.length > 0,
    "RT-IMP B: the part was marked checked while hidden and is never looked at again: copied text stays up with no note");
});
