// Audit 2026-10 (16de9dc) copy checker findings: M-5 (long parts), M-10 (sealed state), O1-07 (protections
// from the chain), M-11 (dated matches only), M-13 (time budget, incremental progress), O1-08 (clean notes),
// O1-09 (plan without the key, apply re-checks), O1-16 (unreadable versions). Runs the real checker (load,
// plan, apply) through the shared harness, or the apply step alone with a hand-written plan.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fingerprint, noteAllowed, textKey } from "../lib.mjs";
import { sealState } from "../state.mjs";
import {
  ALICE, BOOK, BOOKPAGE, MOD, ORIGINAL, SABOTEUR, STATE_KEY, STORIES, WRITER, applyOnly, hidesOf, notesOf, run as runChecker, seg, unhidesOf,
  workdir, writeState,
} from "./harness.mjs";

const run = (dir, sc, env) => runChecker(dir, { book: BOOK, copiedText: BOOKPAGE, ...sc }, env);
const config = (n = 2) => ({ moderator: MOD, next_story_id: String(n) });
const story = (count = 1) => ({ status: 1, segment_count: String(count) });
const sealed = (dir) => path.join(dir, "state.sealed.json");
const at = (iso) => String(Date.parse(iso) / 1000);
function word(n) {
  let s = "";
  for (let i = 0; i < 5; i++) { s += String.fromCharCode(97 + (n % 26)); n = Math.floor(n / 26); }
  return "w" + s;
}
const filler = (seed, count = 90) => Array.from({ length: count }, (_, k) => word(seed * 1000 + k)).join(" ");

// ---------------------------------------------------------------- M-5

test("M-5: a story of long multibyte parts is read a few parts at a time, and every part is checked", () => {
  const dir = workdir();
  const cjk = (i) => String.fromCharCode(0x4e00 + i).repeat(6000); // 18 KB of UTF-8 each
  const segments = {};
  for (let i = 1; i <= 6; i++) segments["1:" + i] = seg(WRITER, cjk(i), 1000 + i);
  segments["1:7"] = seg(WRITER, BOOKPAGE, 1007);
  // The node refuses a page over 40 KB of text, as a node's read limit would.
  const r = run(dir, { config: config(), stories: { "1": story(7) }, segments, pageLimitChars: 40000 });
  assert.equal(r.state.checked["1"], 7, "the story is not skipped");
  assert.equal(hidesOf(r.ops, 1, 7).length, 1, "the copy after the long parts is found");
  assert.ok(r.reads.length > 0 && r.reads.every((x) => x.limit <= 3), JSON.stringify(r.reads));
});

// ---------------------------------------------------------------- M-10

test("M-10: a planted state file without a valid seal is ignored and reported", () => {
  const sc = { config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) } };
  // The planted state claims the copy was checked and is clean.
  const lie = { checked: { "1": 1 }, seen: { "1:1": { t: textKey(BOOKPAGE), c: textKey(""), v: "clean" } }, index: {} };
  const valid = sealState(lie, STATE_KEY, STORIES);
  const tampered = JSON.parse(valid);
  tampered.body = tampered.body.replace('"clean"', '"cited"');
  for (const [name, text] of [
    ["unsealed", JSON.stringify(lie)],
    ["sealed with another key", sealState(lie, "another-key-0123456789abcdef0123456789", STORIES)],
    ["sealed for another Stories address", sealState(lie, STATE_KEY, "1OtherStoriesAddressxxxxxxxxxxxxxx")],
    ["changed after sealing", JSON.stringify(tampered)],
    ["not JSON", "{"],
  ]) {
    const dir = workdir();
    fs.writeFileSync(sealed(dir), text);
    const r = run(dir, sc);
    assert.match(r.out, /::error title=Copy checker::the saved progress was ignored/, name);
    assert.equal(hidesOf(r.ops, 1, 1).length, 1, name + ": the copy is checked as if new");
  }
  // Control: the same state, properly sealed, is trusted.
  const dir = workdir();
  fs.writeFileSync(sealed(dir), valid);
  const r = run(dir, sc);
  assert.match(r.out, /seal OK/);
  assert.equal(r.ops.length, 0);
});

test("M-10: without CHECKER_STATE_KEY the run only reports (no search, nothing signed or saved) and fails loudly", () => {
  const dir = workdir();
  const r = run(dir, { config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000), "1:2": seg(WRITER, ORIGINAL, 1001) } },
    { CHECKER_STATE_KEY: "" });
  assert.equal(r.ops.length, 0);
  assert.equal(r.searches, 0);
  assert.notEqual(r.code, 0, "the plan step fails, so GitHub emails the owner");
  assert.notEqual(r.applyCode, 0);
  assert.match(r.out, /CHECKER_STATE_KEY is not set/);
  assert.equal(fs.existsSync(sealed(dir)), false, "nothing saved");
  // A short key is no key.
  assert.match(run(workdir(), { config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, ORIGINAL, 1000) } },
    { CHECKER_STATE_KEY: "short" }).out, /shorter than 32/);
});

// ---------------------------------------------------------------- O1-07

test("O1-07: a part whose checker hide its opener restored is never hidden again, even when the saved progress is lost", () => {
  const restored = { "1:1": seg(WRITER, BOOKPAGE, 1000, { restored: true, refund_forfeited: true }) };
  for (const lose of ["none", "planted"]) {
    const dir = workdir();
    if (lose === "planted") fs.writeFileSync(sealed(dir), JSON.stringify({ checked: {} }));
    const r = run(dir, { config: config(), stories: { "1": story() }, segments: restored });
    assert.equal(hidesOf(r.ops, 1, 1).length, 0, lose);
    assert.equal(notesOf(r.ops, 1, 1).length, 1, lose + ": a source note instead");
    // And still not on the run after.
    assert.equal(hidesOf(run(dir, { config: config(), stories: { "1": story() }, segments: restored }).ops, 1, 1).length, 0);
  }
  // New copied text after that is checked again.
  const dir = workdir();
  run(dir, { config: config(), stories: { "1": story() }, segments: restored });
  const other = BOOKPAGE.replace("The circus arrives without warning.", "The circus arrives at night.");
  const r = run(dir, { config: config(), stories: { "1": story() }, copiedText: other,
    segments: { "1:1": seg(WRITER, other, 1000, { restored: true, refund_forfeited: true, last_edited_at: "5000", source_note: "x" }) } });
  assert.equal(hidesOf(r.ops, 1, 1).length, 1);
});

// ---------------------------------------------------------------- M-11

test("M-11: a book match not provably older than the part leaves the part visible, with a source note", () => {
  const part = { "1:1": seg(WRITER, BOOKPAGE, at("2026-03-01T00:00:00Z")) };
  for (const published of ["2027", "2026", "2026-02-28", "", "sometime"]) {
    const r = run(workdir(), { config: config(), stories: { "1": story() }, segments: part, book: { ...BOOK, published } });
    assert.equal(hidesOf(r.ops).length, 0, "published " + published);
    assert.equal(notesOf(r.ops, 1, 1).length, 1, "published " + published);
  }
  const older = run(workdir(), { config: config(), stories: { "1": story() }, segments: part, book: { ...BOOK, published: "2026-02-20" } });
  assert.equal(hidesOf(older.ops, 1, 1).length, 1, "control: a book from before the part");
});

test("M-11: a newer web match (a mirror of the part) leaves the original visible: web matches only get a note", () => {
  const dir = workdir();
  const r = run(dir, {
    config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, ORIGINAL, 1000) },
    web: { url: "https://quick-mirror.example/story", text: ORIGINAL },
  }, { GOOGLE_BOOKS_KEY: "", TAVILY_API_KEY: "fake-key" });
  assert.ok(r.searches > 0, "harness: the web was searched");
  assert.equal(hidesOf(r.ops).length, 0);
  assert.equal(notesOf(r.ops, 1, 1).length, 1);
  assert.match(notesOf(r.ops, 1, 1)[0].args.note, /quick-mirror\.example/);
});

// ---------------------------------------------------------------- M-13

test("M-13: a run out of time saves its progress, and the next run goes on from there", () => {
  const dir = workdir();
  const stories = { "1": story(), "2": story(), "3": story() };
  const segments = { "1:1": seg(WRITER, filler(1), 1000), "2:1": seg(ALICE, filler(2), 1001), "3:1": seg(SABOTEUR, filler(3), 1002) };
  const sc = { config: config(4), stories, segments };
  const env = { TIME_BUDGET_MINUTES: "0", GOOGLE_BOOKS_KEY: "" };
  const r1 = run(dir, sc, env);
  assert.match(r1.out, /Out of time/);
  assert.deepEqual(r1.state.checked, { "1": 1 }, "one part done and saved");
  const r2 = run(dir, sc, env);
  assert.deepEqual(r2.state.checked, { "1": 1, "2": 1 }, "resumed");
  const r3 = run(dir, sc, {});
  assert.deepEqual(r3.state.checked, { "1": 1, "2": 1, "3": 1 });
});

// ---------------------------------------------------------------- O1-08

test("O1-08: a book title with line breaks, control and direction characters still makes a note the chain accepts", () => {
  const dir = workdir();
  const title = "Evil\n::error::‮title\u0007 " + "very long ".repeat(40);
  const r = run(dir, { config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) }, book: { ...BOOK, title } });
  assert.equal(hidesOf(r.ops, 1, 1).length, 1);
  for (const op of r.ops) assert.ok(noteAllowed(op.args.note), JSON.stringify(op.args.note));
  assert.doesNotMatch(r.out, /^::error::‮/m, "the title never starts a log line");
});

// ---------------------------------------------------------------- O1-16

test("O1-16: when a part's versions can't be read, its words are not dated 'now': it waits for the next run", () => {
  const fixed = ORIGINAL.replace("so small", "so tiny");
  const sc = (extra) => ({
    config: config(3), stories: { "1": story(), "2": story() },
    segments: { "1:1": seg(ALICE, fixed, 1000, { last_edited_at: "3000", version_count: 2 }), "2:1": seg(SABOTEUR, ORIGINAL, 2000) },
    versions: { "1:1": [{ version: 1, text: ORIGINAL, at: "1000" }, { version: 2, text: fixed, at: "3000" }] }, ...extra,
  });
  for (const broken of [{ failVersions: true }, { versions: { "1:1": [{ version: 1, text: ORIGINAL, at: "1000" }] } }]) {
    const dir = workdir();
    // Mallory's copy (t=2000) was checked while Alice's story could not be read.
    writeState(dir, { checked: { "2": 1 }, index: { "2:1": { author: SABOTEUR, hashes: fingerprint(ORIGINAL), at: 2000 } },
      seen: { "2:1": { t: textKey(ORIGINAL), c: textKey(""), v: "clean" } } });
    const r = run(dir, sc(broken));
    assert.equal(hidesOf(r.ops, 1, 1).length, 0, "Alice's original is never hidden on a guessed date");
    assert.equal(Number(r.state.checked["1"] || 0), 0, "and is not marked checked");
    const next = run(dir, sc({}));
    assert.equal(hidesOf(next.ops, 1, 1).length, 0);
    assert.equal(next.state.checked["1"], 1, "checked once its versions can be read");
  }
});

// ---------------------------------------------------------------- O1-09

test("O1-09: the apply step signs a plan's actions only when fresh chain reads support them", () => {
  const dir = workdir();
  const segments = {
    "1:1": seg(ALICE, ORIGINAL, 1000),                                     // an original
    "2:1": seg(SABOTEUR, ORIGINAL, 2000),                                  // its copy
    "3:1": seg(WRITER, BOOKPAGE, at("2026-03-01T00:00:00Z")),              // a page of a book
    "4:1": seg(WRITER, BOOKPAGE, 1000, { hidden: true, hidden_by: 3 }),    // the admin holds it
    "5:1": seg(WRITER, BOOKPAGE, 1000, { restored: true, refund_forfeited: true }),
    "6:1": seg(WRITER, ORIGINAL, 1000, { source_note: "already noted" }),
    "7:1": seg(WRITER, BOOKPAGE, 1000, { hidden: true, hidden_by: 1, moderation_reason: 4 }),
  };
  const t = (k) => textKey(segments[k].text);
  const hide = (k, extra) => ({ kind: "hide", story: Number(k.split(":")[0]), seq: 1, t: t(k), reason: 1, note: "copied", ...extra });
  const book = { sourceKind: "book", published: "1960" };
  const plan = [
    hide("1:1", { reason: 2, copyOf: "2:1" }),                             // the original as a "copy" of its newer copy
    hide("1:1", { reason: 2, copyOf: "1:1" }),                             // of itself
    hide("2:1", { reason: 2, copyOf: "6:1" }),                             // the one real copy: of an older part by another writer
    hide("3:1", { sourceKind: "web" }),                                    // a website match
    hide("3:1", { sourceKind: "book", published: "2027" }),               // a newer book
    hide("4:1", book),                                                     // the admin's hide
    hide("5:1", book),                                                     // restored by its opener
    hide("7:1", book),                                                     // hidden by reports for abuse
    hide("1:1", { ...book, t: "stale-text-key00" }),                       // text changed since
    { kind: "unhide", story: 4, seq: 1, t: t("4:1"), src: BOOK, note: "x" }, // the admin's hide
    { kind: "note", story: 6, seq: 1, t: t("6:1"), note: "over a note" },
    { kind: "note", story: 1, seq: 1, t: t("1:1"), note: "a\n::error::‮b" },
    { kind: "takedown", story: 1, seq: 1, t: t("1:1") },
    { kind: "hide", story: 9, seq: 9, t: "no-such-part0000", reason: 1, note: "copied", ...book },
  ];
  const r = applyOnly(dir, { config: config(10), segments }, plan);
  const hidden = hidesOf(r.ops).map((o) => o.args.story_id);
  assert.deepEqual(hidden, ["2"], "only the copy of an older part by another writer: " + r.out);
  assert.equal(unhidesOf(r.ops).length, 0);
  const notes = notesOf(r.ops);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].args.note, "a ::error::b", "cleaned before signing");
  assert.ok(r.state.hiddenByChecker["2:1"], "only what the chain accepted is recorded");
});

test("O1-09: at most APPLY_MAX_HIDES hides are signed per run; the rest wait", () => {
  const segments = {};
  const plan = [];
  for (let i = 1; i <= 5; i++) {
    segments[i + ":1"] = seg(WRITER, BOOKPAGE + " " + i, 1000);
    plan.push({ kind: "hide", story: i, seq: 1, t: textKey(BOOKPAGE + " " + i), reason: 1, note: "copied", sourceKind: "book", published: "1960" });
  }
  const r = applyOnly(workdir(), { config: config(6), segments }, plan, { APPLY_MAX_HIDES: "2" });
  assert.equal(hidesOf(r.ops).length, 2);
  assert.match(r.out, /more than 2 hides this run/);
});

test("O1-09: the plan step runs without the moderator key; a refused or unsent hide is not recorded", () => {
  const dir = workdir();
  const r = run(dir, { config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) }, revert: true });
  assert.equal(r.plan.actions.length, 1, "planned");
  assert.equal(r.ops.length, 0, "the chain refused it");
  assert.deepEqual(r.state.hiddenByChecker, {});
  assert.equal(r.state.seen["1:1"].v, "copy", "planned again next run");
  const again = run(dir, { config: config(), stories: { "1": story() }, segments: { "1:1": seg(WRITER, BOOKPAGE, 1000) } });
  assert.equal(hidesOf(again.ops, 1, 1).length, 1);
});
