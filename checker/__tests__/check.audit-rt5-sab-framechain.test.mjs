// Red-team (Saboteur) attack test, SwarmTales fix check @ da91205.
// Target: checker/check.mjs enforce() "overruled" indexing + lib.mjs Index
// copyOf exemption + textAt re-dating (AB-067, AB-071).
//
// A restored copy is indexed anyway with copyOf = the part it copied
// (check.mjs:470-474, lib.mjs add/match), so "that part is never flagged for
// matching it". The exemption is ONE level deep. Framing chain:
//   1. Saboteur S opens story 2 and posts Q = innocent P's text + one sentence.
//      The checker hides Q (copy of P). S restores it (forfeits a few Ink):
//      Q is indexed with copyOf "1:1".
//   2. A second wallet S2 posts Q2 = Q in S's story 3. Its best match is Q
//      (it shares Q's extra sentence), so Q2 is hidden with copyOf "2:1".
//      S restores it: Q2 indexed with copyOf "2:1".
//   3. S pays a 20-Ink revise_part on P (two words). P is checked again,
//      dated by its edit (textAt), after Q2. Q is exempt, Q2 is not: P, the
//      innocent ORIGINAL, is hidden by the moderator key as a "copy" of Q2.
//      Removing it then refunds nothing, restoring it forfeits A's refund.
// Asserts the SAFE outcome (P is never hidden). FAILING = innocent writer framed.
// CONTROL: the same without step 2 -> P is not hidden (proves the harness).
//
// Runs the real checker (load, plan, apply) through the shared harness (harness.mjs).
// file into checker/__tests__/ and run with `node --test`.
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

const S2 = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1"; // the saboteur's second wallet
const EXTRA = " Years later the harbour still remembered her careful and patient hand.";
const Q_TEXT = ORIGINAL + EXTRA;
const restored = { restored: true, refund_forfeited: true, source_note: "" };

function stage(dir, withChain) {
  // Run 1: P (innocent) and Q (S's copy plus a sentence). Q is hidden.
  const r1 = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one, "2": one },
    segments: { "1:1": seg(WRITER, ORIGINAL, 1000), "2:1": seg(SABOTEUR, Q_TEXT, 2000) },
  });
  assert.equal(hidesOf(r1.ops, 2, 1).length, 1, "harness: Q is hidden as a copy of P");
  // Run 2: S (the opener of story 2) restored Q. It is indexed with copyOf P.
  const r2 = run(dir, {
    config: { moderator: MOD, next_story_id: "3" }, stories: { "1": one, "2": one },
    segments: { "1:1": seg(WRITER, ORIGINAL, 1000), "2:1": seg(SABOTEUR, Q_TEXT, 2000, restored) },
  });
  assert.equal(hidesOf(r2.ops, 2, 1).length, 0, "harness: a restored copy is not hidden again");
  assert.ok(r2.state.index["2:1"], "harness: the restored copy is indexed");
  assert.equal(r2.state.index["2:1"].copyOf, "1:1", "harness: Q's index entry exempts P");
  const segments = { "1:1": seg(WRITER, ORIGINAL, 1000), "2:1": seg(SABOTEUR, Q_TEXT, 2000, restored) };
  const stories = { "1": one, "2": one };
  if (!withChain) return { segments, stories, next: "3" };
  // Run 3: S2 posts Q2 = Q in S's story 3. Its best match is Q.
  stories["3"] = one;
  segments["3:1"] = seg(S2, Q_TEXT, 4000);
  const r3 = run(dir, { config: { moderator: MOD, next_story_id: "4" }, stories, segments });
  assert.equal(hidesOf(r3.ops, 3, 1).length, 1, "harness: Q2 is hidden");
  // Run 4: S restores Q2 too.
  segments["3:1"] = seg(S2, Q_TEXT, 4000, restored);
  const r4 = run(dir, { config: { moderator: MOD, next_story_id: "4" }, stories, segments });
  assert.ok(r4.state.index["3:1"], "harness: Q2 is indexed after its restore");
  assert.equal(r4.state.index["3:1"].copyOf, "2:1", "harness: Q2's index entry exempts only Q, not P");
  return { segments, stories, next: "4" };
}

test("CONTROL: a restored copy never frames its original after a paid change to the original", () => {
  const dir = workdir();
  const { segments, stories, next } = stage(dir, false);
  segments["1:1"] = seg(WRITER, REVISED, 1000, { last_edited_at: "6000" });
  const { ops } = run(dir, { config: { moderator: MOD, next_story_id: next }, stories, segments });
  assert.equal(hidesOf(ops, 1, 1).length, 0, "copyOf exempts the original from its own restored copy");
});

test("ATTACK: a chain of two restored copies + a 20-Ink revise_part gets the innocent original hidden", () => {
  // Attacks the one-level copyOf exemption combined with textAt re-dating of the original.
  const dir = workdir();
  const { segments, stories, next } = stage(dir, true);
  segments["1:1"] = seg(WRITER, REVISED, 1000, { last_edited_at: "6000" });
  const { ops, state } = run(dir, { config: { moderator: MOD, next_story_id: next }, stories, segments });
  assert.equal(hidesOf(ops, 1, 1).length, 0,
    "RT5-SAB framechain: the innocent original (story 1 part 1, written t=1000) was hidden by the moderator key as a copy" +
    (state.seen && state.seen["1:1"] ? " of " + state.seen["1:1"].copyOf : ""));
});
