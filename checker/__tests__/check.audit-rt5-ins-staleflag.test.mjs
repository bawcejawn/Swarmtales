// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ da91205.
// Roles: an opener (with sock reporters) who once restored a writer-reports
// hide of a part, so segment.restored is true FOREVER; the admin, whose
// decision to leave a copy visible should stand; a writer whose part writer
// reports hid.
// Code (checker/check.mjs):
//  - enforce(): `else if (seen.admin && !seg.restored)` (check.mjs ~482) treats
//    the admin's unhide as final only if the part was NEVER restored; an old
//    restore (of a reports hide, long before) makes the checker hide the copy
//    again right after the admin unhid it.
//  - hiddenByChecker loop: `keptRefund = !seg.hidden && seg.restored &&
//    !seg.refund_forfeited` (~575): a part restored long ago that the ADMIN
//    unhid (before the checker saw its own hide in place) looks like "my hide
//    never landed", so the checker hides it again.
//  - A writer-reports hide taken over by the checker (AB-071) is then
//    unhidden by the checker as soon as the writer types a citation (~580):
//    the reports' hide is undone with no opener or admin decision.
// Every test asserts the SAFE behaviour; a FAILING test proves the problem.
// Runs the real checker (load, plan, apply) through the shared harness (harness.mjs).
// =====================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { BOOK, MOD, ORIGINAL, SABOTEUR, WRITER, run as runChecker, workdir, writeState } from "./harness.mjs";

const COPIED =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black and white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
  "is black or white, painted or powdered, or treated with some other circus trick.";

const run = (dir, sc, env) => runChecker(dir, { book: BOOK, copiedText: COPIED, ...sc }, env);

const config = { moderator: MOD, next_story_id: "2" };
const story = (extra) => ({ "1": { status: 1, segment_count: "1", ...extra } });
const part = (extra) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: COPIED, created_at: "1000", ...extra } });
const hides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && String(o.args.seq) === "1");
const unhides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false && String(o.args.seq) === "1");
const CITED = "From The Night Circus by Erin Morgenstern";

// Attack: the admin took over the copy (hidden_by 3) and unhid it; an old opener restore makes the checker re-hide it.
test("RT5-INS staleflag 1: an admin's unhide stands, even for a part its opener once restored", () => {
  const dir = workdir();
  const held = run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3, restored: true }) });
  assert.equal(held.ops.length, 0, "harness: the admin's hide is left alone");
  const { ops } = run(dir, { config, stories: story(), segments: part({ restored: true }) });
  assert.equal(hides(ops).length, 0, "RT5-INS staleflag 1: the checker hid again a copy the admin looked at and unhid");
});

// Control: the same without the old restore (passes today).
test("control: an admin's unhide stands for a part never restored", () => {
  const dir = workdir();
  run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3 }) });
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({}) }).ops).length, 0);
});

// Attack: the checker hid a visible copy (so its hide surely landed); the admin unhid it before the next run.
// Because the part was restored once long ago, the checker reads this as "my hide never landed" and hides it again.
test("RT5-INS staleflag 2: the admin unhiding the checker's hide before the next run is not undone", () => {
  const dir = workdir();
  const first = run(dir, { config, stories: story(), segments: part({ restored: true }) });
  assert.equal(hides(first.ops).length, 1, "harness: the visible copy is hidden");
  const { ops } = run(dir, { config, stories: story(), segments: part({ restored: true, hidden: false, hidden_by: 0 }) });
  assert.equal(hides(ops).length, 0, "RT5-INS staleflag 2: the checker re-hid a part the admin unhid (stale `restored` flag)");
});

// Control: the same without the old restore (passes today: treated as overruled).
test("control: the admin unhiding the checker's hide of a never-restored part stands", () => {
  const dir = workdir();
  run(dir, { config, stories: story(), segments: part({}) });
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({ hidden: false, hidden_by: 0 }) }).ops).length, 0);
});

// Attack (design): writer reports hid the part; the checker takes it over (AB-071); the writer then types a citation
// and the checker unhides it, undoing the writer reports' hide that neither the opener nor the admin lifted.
test("RT5-INS staleflag 3: a hide writer reports made is not lifted by the checker because of a citation", () => {
  const dir = workdir();
  const first = run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 1 }) });
  // With the AB-078 fix the checker takes over only a reports hide made for copying; this one gives no
  // reason, so it may stay the reports'. Run 2 shows the chain as run 1 left it (as fc5's C1 does).
  const tookOver = hides(first.ops).length;
  const { ops } = run(dir, { config, stories: story(), segments: tookOver
    ? part({ hidden: true, hidden_by: 2, citation: CITED })
    : part({ hidden: true, hidden_by: 1, citation: CITED }) });
  assert.equal(unhides(ops).length, 0, "RT5-INS staleflag 3: the checker unhid a part writer reports had hidden");
});
