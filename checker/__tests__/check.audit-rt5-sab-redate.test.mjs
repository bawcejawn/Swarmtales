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
import assert from "node:assert/strict";
import test from "node:test";
import { BOOK, MOD, ORIGINAL, SABOTEUR, WRITER, run as runChecker, workdir, writeState } from "./harness.mjs";

const COPIED =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not.";
const REVISED = ORIGINAL.replace("then let the pen rest.", "then let the pen rest at last.");

const run = (dir, sc, env) => runChecker(dir, { book: BOOK, copiedText: COPIED, ...sc }, env);

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
