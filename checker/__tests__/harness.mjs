// Shared harness for the copy checker's end-to-end tests: the real checker
// run as the workflow runs it, in three child processes (load: state.mjs
// open; plan: check.mjs, no moderator key; apply: apply.mjs), with koilib and
// fetch replaced by in-memory fakes (no network, no chain). It grew out of
// the Audit Bot's harness (check.audit-rt-sab-restored), which every
// check.audit-* file used to carry a copy of.
//
// Scenario (sc): config, stories, segments ("story:seq" -> segment),
// versions ("story:seq" -> [{ version, text, at }]), chainId, rc (moderator
// mana), book ({ title, author, published }), copiedText (the book page: a
// phrase is "found" in the book when it is part of it), web ({ url, text }:
// a website Tavily finds phrases of), failSearch, failStory (a story id whose
// get_story throws), failVersions, pageLimitChars (a get_segments page whose
// text is longer fails, as a node's read limit does), revert (the chain
// refuses every write).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keyProblem, sealState } from "../state.mjs";

export const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));
export const APPLY = fileURLToPath(new URL("../apply.mjs", import.meta.url));
export const STATE = fileURLToPath(new URL("../state.mjs", import.meta.url));
export const MOD = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";
export const WRITER = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
export const SABOTEUR = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";
export const ALICE = "1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq";
export const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
export const TESTNET_CHAIN = "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==";
export const STATE_KEY = "test-state-key-0123456789abcdef0123456789";
// Published long before the parts in these tests (created_at 1000 and so on: 1970), so a copy of it can be hidden (M-11).
export const BOOK = { title: "The Night Circus", author: "Erin Morgenstern", published: "1960" };
export const CITED = "From The Night Circus by Erin Morgenstern";
export const BOOKPAGE =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black and white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
  "is black or white, painted or powdered, or treated with some other circus trick.";
export const ORIGINAL =
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
const segOf = (s, q) => sc.segments[s + ":" + q] || {};
function read(name, args) {
  if (name === "get_config") return sc.config;
  if (name === "get_story") {
    if (sc.failStory && String(args.story_id) === String(sc.failStory)) throw new Error("node busy");
    return sc.stories[String(args.story_id)] || {};
  }
  if (name === "get_segment") {
    log({ read: name, story: String(args.story_id), seq: String(args.seq) });
    return segOf(args.story_id, args.seq);
  }
  if (name === "get_segments") {
    log({ read: name, story: String(args.story_id), start: String(args.start), limit: Number(args.limit) });
    const st = sc.stories[String(args.story_id)] || {};
    const count = Number(st.segment_count || 0);
    const out = [];
    let s = Number(args.start) || 1;
    for (; s < (Number(args.start) || 1) + Math.min(10, Number(args.limit) || 10) && s <= count; s++) out.push(segOf(args.story_id, s));
    const size = out.reduce((n, seg) => n + Buffer.byteLength(String(seg.text || "")), 0);
    if (sc.pageLimitChars && out.length > 1 && size > sc.pageLimitChars) throw new Error("read limit exceeded");
    return { values: out, next: s <= count ? String(s) : "0" };
  }
  if (name === "get_versions") {
    if (sc.failVersions) throw new Error("node busy");
    const all = (sc.versions || {})[args.story_id + ":" + args.seq] || [];
    const page = all.filter((v) => v.version >= Math.max(1, Number(args.from || 1))).slice(0, Number(args.count) || 5);
    const last = page.length ? page[page.length - 1].version : 0;
    return { values: page, next: last && last < all.length ? last + 1 : 0 };
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
  async send() {
    if (sc.revert) return { reverted: true, logs: ["refused"] };
    for (const op of this.ops) log({ op: op.name, args: op.args });
    return { reverted: false };
  }
  async wait() {}
}
const fake = { Provider, Signer, Contract, Transaction };
const load = Module._load;
Module._load = function (request) {
  if (request === "koilib") return fake;
  return load.apply(this, arguments);
};
const norm = (t) => String(t).replace(/\s+/g, " ").trim().split(" ")
  .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean).join(" ").toLowerCase();
globalThis.fetch = async (url, opts) => {
  if (sc.failSearch) { log({ search: true }); return { ok: false, status: 403, json: async () => ({}) }; }
  const u = new URL(String(url));
  if (u.host === "api.tavily.com") {
    log({ search: "tavily" });
    const phrase = JSON.parse(opts.body).query.replace(/^"|"$/g, "");
    const results = sc.web && norm(sc.web.text).includes(norm(phrase)) ? [{ url: sc.web.url, title: "A page", content: phrase }] : [];
    return { ok: true, status: 200, json: async () => ({ results }) };
  }
  const volume = /^\/books\/v1\/volumes\/([^/]+)$/.exec(u.pathname);
  if (u.host === "www.googleapis.com" && volume) {
    // The apply step's own lookup of a book (audit M-B): not a search.
    log({ book: volume[1] });
    if (!sc.book || volume[1] !== "nc" || sc.failBookLookup) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ id: "nc", volumeInfo: { title: sc.book.title, authors: [sc.book.author], publishedDate: sc.book.published } }) };
  }
  log({ search: true });
  const phrase = (u.searchParams.get("q") || "").replace(/^"|"$/g, "");
  const items = sc.book && sc.copiedText && norm(sc.copiedText).includes(norm(phrase)) ? [{ id: "nc", volumeInfo: { title: sc.book.title, authors: [sc.book.author],
    publishedDate: sc.book.published, infoLink: "https://books.google.com/books?id=nc" }, searchInfo: { textSnippet: phrase } }] : [];
  return { ok: true, status: 200, json: async () => ({ items }) };
};
`;

const made = [];
process.on("exit", () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

export function workdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-checker-"));
  made.push(dir);
  fs.writeFileSync(path.join(dir, "preload.mjs"), PRELOAD);
  return dir;
}

const sealedFile = (dir) => path.join(dir, "state.sealed.json");

/** Saved progress as the last apply step left it (sealed with the test key). */
export function writeState(dir, state) {
  fs.writeFileSync(sealedFile(dir), sealState({ checked: {}, swept: {}, index: {}, ...state }, STATE_KEY, STORIES));
}

/** The saved progress (the sealed file's contents), or {}. */
export function readState(dir) {
  try {
    return JSON.parse(JSON.parse(fs.readFileSync(sealedFile(dir), "utf8")).body);
  } catch {
    return {};
  }
}

/**
 * One hourly run: load, plan, apply. Returns { ops (signed writes), reads,
 * searches, state (the saved progress), plan, out, code (plan's exit code) }.
 * env: extra environment for all three steps (MODERATOR_WIF "" = no key,
 * CHECKER_STATE_KEY "" = no state key, and so on).
 */
export function run(dir, scenario, env = {}) {
  const scen = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "ops.log");
  fs.writeFileSync(scen, JSON.stringify({ chainId: TESTNET_CHAIN, rc: "100000000", ...scenario }));
  fs.writeFileSync(logFile, "");
  for (const f of ["state.json", "plan.json"]) fs.rmSync(path.join(dir, f), { force: true });
  const base = {
    ...process.env,
    STORIES_ADDRESS: STORIES, RPC: "", EXPECTED_CHAIN_ID: "", DRY_RUN: "", TEST_PHRASE: "", GITHUB_STEP_SUMMARY: "",
    GOOGLE_BOOKS_KEY: "fake-key", TAVILY_API_KEY: "", BRAVE_API_KEY: "", SEARCH_PER_RUN: "", TIME_BUDGET_MINUTES: "",
    MODERATOR_WIF: "5Kfake-moderator-wif", CHECKER_STATE_KEY: STATE_KEY,
    STATE_FILE: path.join(dir, "state.json"), PLAN_FILE: path.join(dir, "plan.json"), SEALED_FILE: sealedFile(dir),
    RT_SCENARIO: scen, RT_LOG: logFile, ...env,
  };
  const step = (args, stepEnv) => spawnSync(process.execPath, args, { env: stepEnv, cwd: dir, encoding: "utf8", timeout: 60000 });
  const loaded = step([STATE, "open", sealedFile(dir), path.join(dir, "state.json")], base);
  assert.equal(loaded.status, 0, "load failed: " + loaded.stdout + loaded.stderr);
  // The plan step never gets the moderator key or the state key (as in the workflow).
  const planEnv = { ...base };
  delete planEnv.MODERATOR_WIF;
  delete planEnv.CHECKER_STATE_KEY;
  const preload = ["--import", pathToFileURL(path.join(dir, "preload.mjs")).href];
  const planned = step([...preload, CHECK], planEnv);
  const noKey = !!keyProblem(base.CHECKER_STATE_KEY); // then both steps fail on purpose (loudly)
  assert.ok(planned.status === 0 || noKey, "plan failed: " + planned.stdout + planned.stderr);
  const applied = step([...preload, APPLY], base);
  assert.ok(applied.status === 0 || noKey, "apply failed: " + applied.stdout + applied.stderr);
  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")); } catch { plan = null; }
  return {
    ops: lines.filter((l) => l.op), reads: lines.filter((l) => l.read === "get_segments"), searches: lines.filter((l) => l.search).length,
    state: readState(dir), plan, out: loaded.stdout + planned.stdout + planned.stderr + applied.stdout + applied.stderr,
    code: planned.status, applyCode: applied.status,
  };
}

export const seg = (author, text, created, extra) => ({ status: 1, hidden: false, citation: "", author, text, created_at: String(created), ...extra });
const matches = (o, sid, sq) => (sid === undefined || String(o.args.story_id) === String(sid)) && (sq === undefined || String(o.args.seq) === String(sq));
export const hidesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && matches(o, sid, sq));
export const unhidesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false && matches(o, sid, sq));
export const notesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_source_note" && matches(o, sid, sq));

/**
 * Only the apply step, with a plan written by hand (as a misbehaving plan job
 * could): returns { ops, out, state }.
 */
export function applyOnly(dir, scenario, plan, env = {}, planState = undefined) {
  const scen = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "ops.log");
  fs.writeFileSync(scen, JSON.stringify({ chainId: TESTNET_CHAIN, rc: "100000000", ...scenario }));
  fs.writeFileSync(logFile, "");
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(planState || { checked: {}, seen: {}, hiddenByChecker: {} }));
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ v: 1, stories: STORIES, actions: plan }));
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "preload.mjs")).href, APPLY], {
    env: { ...process.env, STORIES_ADDRESS: STORIES, RPC: "", EXPECTED_CHAIN_ID: "", DRY_RUN: "", GITHUB_STEP_SUMMARY: "", TIME_BUDGET_MINUTES: "",
      MODERATOR_WIF: "5Kfake-moderator-wif", CHECKER_STATE_KEY: STATE_KEY, STATE_FILE: path.join(dir, "state.json"),
      PLAN_FILE: path.join(dir, "plan.json"), SEALED_FILE: sealedFile(dir), RT_SCENARIO: scen, RT_LOG: logFile, ...env },
    cwd: dir, encoding: "utf8", timeout: 60000,
  });
  assert.equal(r.status, 0, "apply failed: " + r.stdout + r.stderr);
  const ops = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.op);
  return { ops, out: r.stdout, state: readState(dir) };
}
