// Red-team (Insider) attack tests, SwarmTales fix check @ d82364b.
// Target: checker/check.mjs (the copy checker, moderator key). Roles: a
// story opener (or editor) who wrote, or wants to keep, copied text, plus a
// few friendly writer wallets.
//
// L1 "launder through reports": the opener has friends report her copied
//   part (report_threshold writer reports) before the hourly run. The run
//   sees it hidden (hidden_by 1) and records state.hiddenWhenRead. She then
//   restores it (allowed for a reports hide, and NOT refund-forfeiting:
//   restore_segment only forfeits hidden_by 2). restore sets seg.restored,
//   and checkPart never hides a restored part (`!seg.restored`, check.mjs
//   ~375 and ~399). So the checker's later check of the visible part can
//   only add a note: the opener overrode a checker hide that never happened,
//   and kept her full refund. (RT-IMP B accepted a note; this asserts the
//   copied text is hidden, because nobody ever overrode the checker.)
// L2 "edit after the check": the writer posts original text, the run checks
//   it clean (state.checked marks the seq done), then rewords it for free
//   (edit_segment) into copied text. Parts are only ever read once
//   (state.checked) and the "full story" sweep doesn't search the web, so the
//   copied text is never checked.
// L3 "cite, get unhidden, un-cite": the checker hid a copied part; the writer
//   sets a citation naming the source, the checker unhides it (and the part
//   is refundable again, per docs); the writer then clears the citation. The
//   uncited copy stays up: nothing re-checks it.
//
// Each attack test asserts the SAFE behaviour and FAILS while the attack works.
// The harness (fake koilib + fetch, real check.mjs in a child process) is
// copied from check.audit-rt-imp-unhide.test.mjs.
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
const hides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && String(o.args.seq) === "1");
const ORIGINAL =
  "Marguerite kept the lighthouse ledger in pencil, because ink froze in the winter and the keeper before her had " +
  "written everything in ink. Each night she counted the ships by their lamps, red to port and green to starboard, " +
  "and each morning she walked the shingle to see what the sea had returned. Usually it was rope. Once it was a " +
  "piano stool, upright and dry, as if someone had set it there on purpose and gone back for the piano. She wrote " +
  "that down too, with the date and the state of the tide, and drew a small square around it so she would not forget.";

test("RT-INS L1: a copied part restored from a writer-reports hide is still hidden by the checker", () => {
  const dir = workdir();
  writeState(dir, {});
  // Run 1: three friendly writer reports hid it just before the run.
  run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: true, hidden_by: 1, hidden_by_reports: true, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  // Run 2: the opener restored it (no refund forfeited: it was a reports hide).
  const { ops } = run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: false, restored: true, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  assert.equal(hides(ops).length, 1,
    "RT-INS L1: the opener laundered copied text through a reports hide + restore: the checker never hides a restored part");
});

test("RT-INS L2: a part reworded into copied text after its check is checked again", () => {
  const dir = workdir();
  writeState(dir, {});
  const seg = (text) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text, created_at: "1000", last_edited_at: "2000" } });
  // Run 1: original text, nothing found anywhere.
  const first = run(dir, { config, stories: story, segments: seg(ORIGINAL), book: null }, { books: true });
  assert.equal(first.state.checked["1"], 1, "harness: run 1 checked part 1");
  // The writer rewords it for free (edit_segment) into the novel's opening page.
  const { ops } = run(dir, { config, stories: story, segments: seg(COPIED), book: BOOK }, { books: true });
  assert.ok(ops.some((o) => (o.op === "set_segment_hidden" || o.op === "set_source_note") && String(o.args.seq) === "1"),
    "RT-INS L2: copied text put in by a free edit after the check is never looked at");
});

test("RT-INS L3: clearing the citation after the checker unhid the part brings the hide back", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: entry });
  // Run 1: the writer cited the source; the checker unhides its own hide (control).
  const first = run(dir, { config, stories: story, segments: hiddenPart(2), book: BOOK }, { books: true });
  assert.equal(unhides(first.ops).length, 1, "harness: the checker unhid its own hide after the citation");
  // The writer clears the citation (set_citation ""): the same copied text, uncited.
  const { ops } = run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: false, hidden_by: 0, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  assert.equal(hides(ops).length, 1,
    "RT-INS L3: cite to get unhidden, then clear the citation: the uncited copy stays up and is never re-checked");
});
