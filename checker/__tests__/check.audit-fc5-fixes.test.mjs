// Fixes for the fifth Audit Bot fix check (AB-076, AB-078, AB-080, AB-083), and tests for the six
// checker lines its mutation run found untested. Harness: the Audit Bot's (check.audit-fc5-budget),
// plus get_versions from sc.versions and a search service that fails when sc.failSearch is set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Index, fingerprint } from "../lib.mjs";

const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));
const MOD = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";
const WRITER = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
const SABOTEUR = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";
const ALICE = "1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq";
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const TESTNET_CHAIN = "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==";
const BOOK = { title: "The Night Circus", author: "Erin Morgenstern" };
const CITED = "From The Night Circus by Erin Morgenstern";
const BOOKPAGE =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black-and-white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought-iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
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
  if (name === "get_versions") {
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
  log({ search: true });
  if (sc.failSearch) return { ok: false, status: 403, json: async () => ({}) };
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc5-fixes-"));
  fs.writeFileSync(path.join(dir, "preload.mjs"), PRELOAD);
  return dir;
}

function run(dir, scenario, env = {}) {
  const scen = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "ops.log");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(scen, JSON.stringify({ chainId: TESTNET_CHAIN, rc: "100000000", book: BOOK, copiedText: BOOKPAGE, ...scenario }));
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
  return { ops: lines.filter((l) => l.op), searches: lines.filter((l) => l.search).length, state, out: r.stdout };
}

const writeState = (dir, state) => fs.writeFileSync(path.join(dir, "state.json"),
  JSON.stringify({ checked: {}, swept: {}, index: {}, ...state }));
const key16 = (t) => createHash("sha256").update(String(t || "")).digest("base64").slice(0, 16);
const seg = (author, text, created, extra) => ({ status: 1, hidden: false, citation: "", author, text, created_at: String(created), ...extra });
const one = (n = 1) => ({ status: 1, segment_count: String(n) }); // no last_activity_at: read in full every run
const hidesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true &&
  String(o.args.story_id) === String(sid) && String(o.args.seq) === String(sq));
const unhidesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false &&
  String(o.args.story_id) === String(sid) && String(o.args.seq) === String(sq));
const notesOf = (ops, sid, sq) => ops.filter((o) => o.op === "set_source_note" &&
  String(o.args.story_id) === String(sid) && String(o.args.seq) === String(sq));

function word(n) {
  let s = "";
  for (let i = 0; i < 5; i++) { s += String.fromCharCode(97 + (n % 26)); n = Math.floor(n / 26); }
  return "v" + s;
}
const filler = (seed, count) => Array.from({ length: count }, (_, k) => word(seed * 1000 + k));
// About 40% of the book page, then made-up words: 2 of its 5 phrases are found (a source note, not a
// hide), and every phrase is asked, so each check uses exactly 5 searches.
const partly = (seed, tweak) => BOOKPAGE.split(" ").slice(0, 41).concat(filler(seed + (tweak ? 500 : 0), 59)).join(" ");

// ---------------------------------------------------------------- AB-083

test("AB-083: free rewordings land the search budget on exactly 0; the copy posted next waits, unjudged, and is searched first next run", () => {
  const dir = workdir();
  // Two of the attacker's parts that partly match the book, checked last run (a note each).
  writeState(dir, {
    checked: { "1": 2 },
    seen: { "1:1": { t: key16(partly(1, false)), c: key16(""), v: "note" }, "1:2": { t: key16(partly(2, false)), c: key16(""), v: "note" } },
  });
  // Right after that run the attacker rewords both for free; an innocent-looking writer posts a book page.
  const segments = {
    "1:1": seg(SABOTEUR, partly(1, true), 1000, { last_edited_at: "5000" }),
    "1:2": seg(SABOTEUR, partly(2, true), 1001, { last_edited_at: "5001" }),
    "2:1": seg(WRITER, BOOKPAGE, 6000),
  };
  const sc = { config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one(2), "2": one() }, segments };
  const drained = run(dir, sc, { SEARCH_PER_RUN: "10" });
  assert.equal(drained.searches, 10, "harness: the two rewordings use every search of the run");
  assert.match(drained.out, /Searches this run: 10\./);
  assert.equal(hidesOf(drained.ops, 2, 1).length, 0, "harness: no search was left for the copy");
  assert.equal(drained.state.seen["2:1"], undefined, "the copy was judged without its search");
  assert.equal(Number(drained.state.checked["2"] || 0), 0, "the copy's story is not marked done past it");
  assert.equal(drained.state.pending["2:1"], true, "the copy waits for the next run");
  // Next run, a small budget: the waiting copy is searched before anything else.
  const next = run(dir, sc, { SEARCH_PER_RUN: "5" });
  assert.equal(hidesOf(next.ops, 2, 1).length, 1, "the copy is searched first next run and hidden");
  assert.equal(next.state.pending["2:1"], undefined);
});

test("AB-083: a search service that fails mid-run never leaves a long part judged clean", () => {
  const dir = workdir();
  const sc = { config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) } };
  const failed = run(dir, { ...sc, failSearch: true });
  assert.equal(failed.ops.length, 0);
  assert.equal(failed.state.seen["1:1"], undefined, "not judged on the phrases nobody answered");
  assert.equal(Number(failed.state.checked["1"] || 0), 0);
  const { ops } = run(dir, sc);
  assert.equal(hidesOf(ops, 1, 1).length, 1, "checked again once the service answers");
});

test("AB-083: with no search key set, a long part is still judged on SwarmTales' own text", () => {
  const dir = workdir();
  const { state } = run(dir, { config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) } },
    { GOOGLE_BOOKS_KEY: "" });
  assert.equal(state.seen["1:1"].v, "clean");
  assert.equal(state.checked["1"], 1);
});

// ---------------------------------------------------------------- AB-076

test("AB-076: an original first checked after its writer fixed a typo is dated by its versions, not hidden as a copy of its copy", () => {
  const dir = workdir();
  // Mallory's copy (t=2000) was checked and indexed while Alice's story could not be read.
  writeState(dir, {
    checked: { "2": 1 },
    index: { "2:1": { author: SABOTEUR, hashes: fingerprint(ORIGINAL), at: 2000 } },
    seen: { "2:1": { t: key16(ORIGINAL), c: key16(""), v: "clean" } },
  });
  const fixed = ORIGINAL.replace("so small", "so tiny");
  const { ops } = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one(), "2": one() },
    segments: { "1:1": seg(ALICE, fixed, 1000, { last_edited_at: "3000", version_count: 2 }), "2:1": seg(SABOTEUR, ORIGINAL, 2000) },
    versions: { "1:1": [{ version: 1, text: ORIGINAL, at: "1000", kind: 1 }, { version: 2, text: fixed, at: "3000", kind: 4 }] },
  });
  assert.equal(hidesOf(ops, 1, 1).length, 0, "Alice's words were first written at t=1000, before Mallory's copy");
});

test("AB-076: words a writer edits into an older part of their own are dated by the edit (a copy is still caught)", () => {
  const dir = workdir();
  writeState(dir, {
    checked: { "1": 1 },
    index: { "1:1": { author: ALICE, hashes: fingerprint(ORIGINAL), at: 1000 } },
    seen: { "1:1": { t: key16(ORIGINAL), c: key16(""), v: "clean" } },
  });
  // Mallory's part was written at t=500 and edited into Alice's text at t=2000, before its first check.
  const own = filler(7, 90).join(" ");
  const { ops } = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one(), "2": one() },
    segments: { "1:1": seg(ALICE, ORIGINAL, 1000), "2:1": seg(SABOTEUR, ORIGINAL, 500, { last_edited_at: "2000", version_count: 2 }) },
    versions: { "2:1": [{ version: 1, text: own, at: "500", kind: 1 }, { version: 2, text: ORIGINAL, at: "2000", kind: 4 }] },
  });
  assert.equal(hidesOf(ops, 2, 1).length, 1, "the copied words first appeared at t=2000, after Alice's");
});

test("AB-076: Index dates each shared hash, so newer words in a part don't make its older ones new", () => {
  const idx = new Index();
  const a = fingerprint(ORIGINAL);
  // Indexed at t=1000, with its last few hashes added by an edit at t=3000.
  const newer = Object.fromEntries(a.slice(-3).map((h) => [h, 3000]));
  idx.add("1:1", ALICE, a, 1000, undefined, { newer });
  assert.ok(idx.bestMatch(a, SABOTEUR, "2:1", 2000), "a copy at t=2000 matches the words from t=1000");
  assert.equal(idx.tieMatch(a, SABOTEUR, "2:1", 2000), null);
  assert.equal(idx.bestMatch(a, SABOTEUR, "2:1", 500), null, "a part from t=500 copies nothing");
  idx.add("1:1", ALICE, a, 1000, undefined, { skip: true });
  assert.equal(idx.bestMatch(a, SABOTEUR, "2:1", 2000), null, "a skipped entry only keeps its dates");
});

// ---------------------------------------------------------------- AB-078 (the owner's rule)

test("AB-078: a reports hide for copying is taken over, and the writer's citation lifts it", () => {
  const dir = workdir();
  const sc = (extra) => ({ config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000, extra) } });
  const first = run(dir, sc({ hidden: true, hidden_by: 1, hidden_by_reports: true, moderation_reason: 1 }));
  assert.equal(hidesOf(first.ops, 1, 1).length, 1, "taken over");
  assert.ok(first.state.hiddenByChecker["1:1"]);
  const { ops } = run(dir, sc({ hidden: true, hidden_by: 2, moderation_reason: 1, citation: CITED }));
  assert.equal(unhidesOf(ops, 1, 1).length, 1);
});

test("AB-078: a reports hide for spam is left to the admin; once its opener restores it, the copy is hidden", () => {
  const dir = workdir();
  const sc = (extra) => ({ config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000, extra) } });
  const first = run(dir, sc({ hidden: true, hidden_by: 1, hidden_by_reports: true, moderation_reason: 3 }));
  assert.equal(first.ops.length, 0, "not taken over");
  assert.equal(first.state.seen["1:1"].v, "copy");
  const cited = run(dir, sc({ hidden: true, hidden_by: 1, hidden_by_reports: true, moderation_reason: 3, citation: CITED }));
  assert.equal(unhidesOf(cited.ops, 1, 1).length, 0, "a citation never lifts it");
  const { ops } = run(dir, sc({ restored: true }));
  assert.equal(hidesOf(ops, 1, 1).length, 1);
});

// ---------------------------------------------------------------- AB-080

test("AB-080: after the upgrade, a checked part nobody edited and without a citation still counts as checked (no search)", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: {} });
  const { ops, searches, state } = run(dir, { config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) } });
  assert.equal(ops.length, 0);
  assert.equal(searches, 0);
  assert.equal(state.seen["1:1"].v, "clean");
});

// ---------------------------------------------------------------- the mutation run's survivors

test("mutant check.mjs:446: a part partly matching a source its writer cited gets no source note", () => {
  const dir = workdir();
  const { ops, state } = run(dir, {
    config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() },
    segments: { "1:1": seg(WRITER, partly(3, false), 1000, { citation: CITED }) },
  });
  assert.equal(notesOf(ops, 1, 1).length, 0);
  assert.equal(state.seen["1:1"].v, "clean");
});

test("mutant check.mjs:467: a copy its opener restored is indexed as an original after all", () => {
  const dir = workdir();
  const sc = (extra) => ({ config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000, extra) } });
  const first = run(dir, sc({}));
  assert.equal(hidesOf(first.ops, 1, 1).length, 1);
  assert.equal(first.state.index["1:1"].skip, true, "a hidden copy keeps only its dates");
  const { state } = run(dir, sc({ restored: true, refund_forfeited: true }));
  assert.equal(state.seen["1:1"].v, "overruled");
  assert.ok(state.index["1:1"] && !state.index["1:1"].skip, "indexed, so a later copy of it is caught");
});

test("mutant check.mjs:475: the checker's own hide found in place is remembered, so a citation can lift it", () => {
  const dir = workdir();
  // The run that hid it never saved its state (it stopped): the verdict is known, the hide is not.
  writeState(dir, {
    checked: { "1": 1 },
    seen: { "1:1": { t: key16(BOOKPAGE), c: key16(""), v: "copy", reason: 1, why: "copied", note: "", src: BOOK, label: "The Night Circus" } },
  });
  const sc = (extra) => ({ config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000, extra) } });
  const held = run(dir, sc({ hidden: true, hidden_by: 2, moderation_reason: 1 }));
  assert.equal(held.ops.length, 0);
  assert.ok(held.state.hiddenByChecker["1:1"], "recorded as the checker's hide");
  const { ops } = run(dir, sc({ hidden: true, hidden_by: 2, moderation_reason: 1, citation: CITED }));
  assert.equal(unhidesOf(ops, 1, 1).length, 1);
});

test("mutant check.mjs:126: a story that changes status (say, into its final edit) is read in full again", () => {
  const dir = workdir();
  const sc = (status) => ({
    config: { moderator: MOD, next_story_id: "2" }, stories: { "1": { status, segment_count: "1", last_activity_at: "1000" } },
    segments: { "1:1": seg(WRITER, ORIGINAL, 1000) },
  });
  const open = run(dir, sc(1));
  const locked = run(dir, sc(2));
  assert.ok(open.state.activity["1"], "harness: an open story read in full is marked up to date");
  assert.notEqual(locked.state.activity["1"], open.state.activity["1"], "the status is part of what the story looked like");
});

test("mutant lib.mjs:102: removing the only part leaves no hash behind", () => {
  const idx = new Index();
  idx.add("1:1", ALICE, fingerprint(ORIGINAL), 1000);
  idx.remove("1:1");
  assert.equal(idx.byHash.size, 0);
  assert.equal(idx.parts.size, 0);
});

test("mutant lib.mjs:104: removing one part keeps the hashes another part shares", () => {
  const idx = new Index();
  const h = fingerprint(ORIGINAL);
  idx.add("1:1", ALICE, h, 1000);
  idx.add("3:1", WRITER, h, 1500);
  idx.remove("1:1");
  const m = idx.bestMatch(h, SABOTEUR, "2:1", 2000);
  assert.ok(m && m.key === "3:1" && m.ratio === 1);
});
