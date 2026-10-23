// Red-team (Saboteur) attack tests, SwarmTales fix check @ da91205.
// Target: checker/check.mjs textAt() re-dating (AB-067) + checkOrder.
//
// The checker now dates a part's text by textAt(seg) = max(created_at,
// last_edited_at) (check.mjs:113-117, used at :509 and :588/:622) and only
// lets parts with an EARLIER date count as the original (lib.mjs bestMatch,
// tieMatch). Anyone may pay revise_part on someone else's part, which sets
// last_edited_at = now (Stories.ts:1390). So the saboteur copies an innocent
// writer's part P into his own part Q, then pays a small revise_part on P:
//   A) same second: revise P and write Q in ONE transaction (same block
//      time). P is re-dated to Q's second; the run checks P first (story 1 <
//      story 2), re-indexes it at that time, and Q's only match is a "tie" ->
//      a source note on both, no hide. Works on a P checked long ago.
//   B) new-part window: P is written, copied into Q and revised before the
//      next hourly run. P (ordered by created_at) is checked first but dated
//      by its edit, after Q; Q (dated earlier) can't see P -> Q is clean and
//      indexed as an original.
// Both assert the SAFE outcome (the copy Q is hidden). A FAILING attack case
// proves the copy gets past the checker. Each attack has a control.
//
// Harness: the fake koilib / fetch child-process harness from
// checker/__tests__/check.audit-fc4.test.mjs (copied). Copy this file into
// checker/__tests__/ and run with `node --test`.
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
  // The part's kept versions, as get_versions pages them (added with the AB-076 fix: a revised part
  // always has them on the chain; version 1 is the original text at created_at).
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

// P = story 1 part 1 (innocent WRITER), Q = story 2 part 1 (SABOTEUR's copy of P's original text).

test("CONTROL A: a copy written one second after the original's paid change is hidden", () => {
  const dir = workdir();
  run(dir, { config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one }, segments: { "1:1": seg(WRITER, ORIGINAL, 1000) } });
  const { ops } = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one, "2": one },
    segments: { "1:1": seg(WRITER, REVISED, 1000, { last_edited_at: "5000" }), "2:1": seg(SABOTEUR, ORIGINAL, 5001) },
  });
  assert.equal(hidesOf(ops, 2, 1).length, 1, "harness: the copy is hidden");
  assert.equal(hidesOf(ops, 1, 1).length, 0, "harness: the original is not");
});

test("ATTACK A: revise the original and post the copy in the same block -> the copy should still be hidden", () => {
  // Attacks textAt re-dating + tieMatch: P was checked and indexed long ago, yet a same-second paid change makes Q a 'tie'.
  const dir = workdir();
  run(dir, { config: { moderator: MOD, next_story_id: "2" }, stories: { "1": one }, segments: { "1:1": seg(WRITER, ORIGINAL, 1000) } });
  const { ops } = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one, "2": one },
    segments: { "1:1": seg(WRITER, REVISED, 1000, { last_edited_at: "5000" }), "2:1": seg(SABOTEUR, ORIGINAL, 5000) },
  });
  assert.equal(hidesOf(ops, 2, 1).length, 1,
    "RT5-SAB redate A: the saboteur's copy of a part checked at t=1000 got only a 'written at the same time' note, because a 20-Ink revise_part in the same block re-dated the original to t=5000");
});

test("CONTROL B: a part copied within the hour (before the first check) is hidden when the original is unchanged", () => {
  const dir = workdir();
  const { ops } = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one, "2": one },
    segments: { "1:1": seg(WRITER, ORIGINAL, 1000), "2:1": seg(SABOTEUR, ORIGINAL, 2000) },
  });
  assert.equal(hidesOf(ops, 2, 1).length, 1, "harness: the copy is hidden");
});

test("ATTACK B: copy a new part, then pay a small change on the original before the next run -> the copy should be hidden", () => {
  // Attacks checkOrder (orders new parts by created_at) vs checkPart dating them by textAt: the original is indexed 'after' its copy.
  const dir = workdir();
  const { ops, state } = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one, "2": one },
    segments: { "1:1": seg(WRITER, REVISED, 1000, { last_edited_at: "3000", version_count: 2 }), "2:1": seg(SABOTEUR, ORIGINAL, 2000) },
    // What the chain keeps for the revised original (fixture completed with the AB-076 fix).
    versions: { "1:1": [{ version: 1, text: ORIGINAL, at: "1000", kind: 1 }, { version: 2, text: REVISED, at: "3000", kind: 2 }] },
  });
  assert.equal(hidesOf(ops, 2, 1).length, 1,
    "RT5-SAB redate B: the copy (written t=2000 from a part written t=1000) passed as clean because the original was revised at t=3000 before the run" +
    (state.seen && state.seen["2:1"] ? " (verdict " + state.seen["2:1"].v + ")" : ""));
});
