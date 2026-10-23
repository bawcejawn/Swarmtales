// Audit Bot fix check 5: a run whose search budget lands on exactly 0 records the next long part as clean
// with no web search, for good (check.mjs checkPart: `alsoWeb && ... && spendable.any()` falls through to clean).
// Harness: the verifier's copy of the repo's check.audit-fc4 harness. Asserts the SAFE outcome.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));
const MOD = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";
const WRITER = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf"; // innocent writer A
const SABOTEUR = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const TESTNET_CHAIN = "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==";
const BOOK = { title: "The Night Circus", author: "Erin Morgenstern" };
const COPIED =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not.";
const ORIGINAL =
  "Marta kept the lighthouse ledger in a hand so small that the gulls seemed to read it before she did. Every evening she " +
  "counted the boats that came home, wrote the wind in three words, and left the last line empty for the ones still out. " +
  "On the night of the long fog the empty line stayed empty until morning, and she sat with the lamp until its oil ran low, " +
  "listening for oars, for voices, for anything that was not the sea breathing against the rocks below the tower window. " +
  "When the first hull scraped the shingle she did not run; she wrote the time, then the name, then let the pen rest.";
// The saboteur's paid revise_part on P: a two-word tail (price max(10, 8) x 2 = 20 Ink).
const REVISED = ORIGINAL.replace("then let the pen rest.", "then let the pen rest at last.");

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
  const norm = (t) => String(t).replace(/\s+/g, " ").trim().split(" ")
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean).join(" ").toLowerCase();
  const items = sc.book && norm(sc.copiedText).includes(norm(phrase)) ? [{ id: "nc", volumeInfo: { title: sc.book.title, authors: [sc.book.author],
    infoLink: "https://books.google.com/books?id=nc" }, searchInfo: { textSnippet: phrase } }] : [];
  return { ok: true, status: 200, json: async () => ({ items }) };
};
`;

function workdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt5-sab-redate-"));
  fs.writeFileSync(path.join(dir, "preload.mjs"), PRELOAD);
  return dir;
}

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
  return { ops: lines.filter((l) => l.op), state, out: r.stdout };
}

const hidesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true &&
  String(o.args.story_id) === String(sid) && String(o.args.seq) === String(sq));
const seg = (author, text, created, extra) => ({ status: 1, hidden: false, citation: "", author, text, created_at: String(created), ...extra });
const one = { status: 1, segment_count: "1" }; // no last_activity_at: the story is read in full every run
import { createHash } from "node:crypto";

const key16 = (t) => createHash("sha256").update(String(t || "")).digest("base64").slice(0, 16);
function word(n) {
  let s = "";
  for (let i = 0; i < 5; i++) { s += String.fromCharCode(97 + (n % 26)); n = Math.floor(n / 26); }
  return "v" + s;
}
// Ten long parts of made-up words (never found in any book), 80 words each (~560 chars).
const filler = (i, tweak) => Array.from({ length: 80 }, (_, k) => word(i * 1000 + k + (k === 40 && tweak ? 500 : 0))).join(" ");
const BOOKPAGE =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black-and-white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought-iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
  "is black or white, painted or powdered, or treated with some other circus trick.";

function scenario(edited) {
  const segments = {};
  for (let i = 1; i <= 10; i++) {
    segments["1:" + i] = seg(SABOTEUR, filler(i, edited), 1000, edited ? { last_edited_at: "5000" } : {});
  }
  segments["2:1"] = seg(WRITER, BOOKPAGE, 6000);
  return {
    config: { moderator: MOD, next_story_id: "3" },
    stories: { "1": { status: 1, segment_count: "10" }, "2": one },
    segments, copiedText: BOOKPAGE,
  };
}
function priorState(dir) {
  const seen = {};
  for (let i = 1; i <= 10; i++) seen["1:" + i] = { t: key16(filler(i, false)), c: key16(""), v: "clean" };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ checked: { "1": 10 }, swept: {}, index: {}, seen }));
}

test("BUDGET-0: throwaway book copies drain the budget to exactly 0; the real copy posted next is still hidden or deferred", () => {
  const dir = workdir();
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ checked: { "1": 1 }, swept: {}, index: {}, seen: { "1:1": { t: "x", c: key16(""), v: "clean" } } }));
  // Story 1 part 1: the saboteur's throwaway copy, reworded (free) right after the last run: 5 searches, hidden.
  const segments = { "1:1": seg(SABOTEUR, BOOKPAGE + " Indeed.", 1000, { last_edited_at: "5000" }), "2:1": seg(WRITER, BOOKPAGE.replace("circus trick.", "circus trick!"), 6000) };
  const sc = { config: { moderator: MOD, next_story_id: "3" }, stories: { "1": { status: 1, segment_count: "1" }, "2": one }, segments, copiedText: BOOKPAGE };
  const r1 = run(dir, sc, { SEARCH_PER_RUN: "5" });
  assert.equal(hidesOf(r1.ops, 1, 1).length, 1, "harness: the throwaway copy is hidden and used the 5 searches");
  const v1 = r1.state.seen && r1.state.seen["2:1"] && r1.state.seen["2:1"].v;
  // Next run, full budget: a copy recorded as clean is never searched again.
  const r2 = run(dir, sc, { SEARCH_PER_RUN: "40" });
  assert.ok(hidesOf(r1.ops, 2, 1).length + hidesOf(r2.ops, 2, 1).length >= 1,
    "the copy was recorded '" + v1 + "' with no search when the budget hit 0, and is never searched again (next run: '" + r2.state.seen["2:1"].v + "')");
});
