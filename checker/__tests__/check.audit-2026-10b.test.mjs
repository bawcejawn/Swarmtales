// Re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md) M-B: the apply step
// (moderator key) no longer trusts the key-less plan step's afterRestore,
// published date, source or note text, and seals only protections it
// worked out itself. Run: node --test checker/__tests__/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { BOOK, BOOKPAGE, MOD, ORIGINAL, SABOTEUR, WRITER, ALICE, applyOnly, hidesOf, notesOf, seg, workdir } from "./harness.mjs";
import { textKey } from "../lib.mjs";

const config = { moderator: MOD, next_story_id: "10" };

test("M-B: a hide for a clean live part, 'book' published '1900', afterRestore true, is refused", () => {
  const segments = { "1:1": seg(WRITER, BOOKPAGE, 1000), "2:1": seg(WRITER, BOOKPAGE + " two", 1000, { restored: true, refund_forfeited: true }) };
  const t = (k) => textKey(segments[k].text);
  const forged = { kind: "hide", reason: 1, note: "copied", sourceKind: "book", published: "1900", afterRestore: true };
  const plan = [
    { ...forged, story: 1, seq: 1, t: t("1:1") },                          // the audit's case: no book this step can look up
    { ...forged, story: 1, seq: 1, t: t("1:1"), books: ["nc"] },            // a real book, but newer than the part
    { ...forged, story: 2, seq: 1, t: t("2:1"), books: ["nc"] },            // its opener restored the checker's hide
  ];
  const r = applyOnly(workdir(), { config, segments, book: { ...BOOK, published: "2027" } }, plan);
  assert.equal(hidesOf(r.ops).length, 0, r.out);
  assert.match(r.out, /story 1 part 1: could not look the book up/);
  assert.match(r.out, /story 1 part 1: no book provably older than the part/);
  assert.match(r.out, /story 2 part 1: its opener restored the checker's hide/);
  // With an old book, the clean part is hidden, and the note is the apply step's own.
  const ok = applyOnly(workdir(), { config, segments, book: BOOK }, [{ ...forged, story: 1, seq: 1, t: t("1:1"), books: ["nc"], note: "PLAN TEXT" }]);
  assert.equal(hidesOf(ok.ops, 1, 1).length, 1);
  assert.equal(hidesOf(ok.ops, 1, 1)[0].args.note, 'copied text: found in "The Night Circus" by Erin Morgenstern (published 1960)');
  assert.deepEqual(ok.state.hiddenByChecker["1:1"].source, { title: BOOK.title, author: BOOK.author }, "the source this step looked up");
});

test("M-B: the sealed protections are the apply step's own, never the plan's", () => {
  const segments = {
    "1:1": seg(WRITER, ORIGINAL, 1000, { restored: true, refund_forfeited: true }),   // restored: protect its text
    "2:1": seg(WRITER, BOOKPAGE, 1000),                                               // live, not hidden
    "3:1": seg(WRITER, BOOKPAGE + " three", 1000, { hidden: true, hidden_by: 2 }),     // the checker's own hide, found in place
  };
  const t = (k) => textKey(segments[k].text);
  const planState = {
    checked: { "1": 1 }, seen: {},
    protect: { "1:1": "planted-text-key" },                                         // would un-protect 1:1
    hiddenByChecker: {
      "2:1": { source: BOOK, label: "x", t: t("2:1") },                             // not hidden on chain: not adopted
      "3:1": { source: BOOK, label: "The Night Circus", t: t("3:1") },              // confirmed on chain: adopted
    },
  };
  const plan = [{ kind: "note", story: 1, seq: 1, t: t("1:1"), note: "x", web: "example.com" }];
  const r = applyOnly(workdir(), { config, segments }, plan, {}, planState);
  assert.equal(r.state.protect["1:1"], t("1:1"), "the text now, as the chain shows it restored");
  assert.ok(!r.state.hiddenByChecker["2:1"]);
  assert.ok(r.state.hiddenByChecker["3:1"]);
  assert.deepEqual(r.state.checked, { "1": 1 }, "the plan's search progress is kept");
});

test("M-B: notes are written by the apply step from what it checked; plan text never reaches the chain", () => {
  const copy = ORIGINAL.slice(0, Math.floor(ORIGINAL.length * 0.7)) + " And then a different ending entirely, written later by someone else.";
  const segments = { "1:1": seg(ALICE, ORIGINAL, 1000), "2:1": seg(SABOTEUR, copy, 2000), "3:1": seg(WRITER, BOOKPAGE, 1000) };
  const t = (k) => textKey(segments[k].text);
  const plan = [
    { kind: "note", story: 2, seq: 1, t: t("2:1"), note: "PLAN TEXT 2", about: "1:1" },
    { kind: "note", story: 3, seq: 1, t: t("3:1"), note: "PLAN TEXT 3", about: "1:1" },   // they don't share text
  ];
  const r = applyOnly(workdir(), { config, segments }, plan);
  const notes = notesOf(r.ops);
  assert.equal(notes.length, 1, r.out);
  assert.match(notes[0].args.note, /^About \d+% of this text also appears in story 1, part 1\.$/);
  assert.match(r.out, /story 3 part 1: the texts don't match enough/);
  assert.ok(!notes.some((n) => /PLAN TEXT/.test(n.args.note)));
});
