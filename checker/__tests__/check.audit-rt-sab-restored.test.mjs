// Red-team (Saboteur) attack tests, SwarmTales fix check @ d82364b.
// Target: checker/check.mjs (the copy checker, moderator key).
//
// Attack A ("hide it yourself, then restore it"), against the new
// state.hiddenWhenRead pass (check.mjs:416-435), whose comment promises
// "check each once it is visible again ... so restoring it never skips the check":
//   1. Three sock writer wallets report the copied part before the hourly run
//      (report_segment, threshold 3): hidden_by = 1 (reports).
//   2. The run sees it hidden and only records hiddenWhenRead (check.mjs:493).
//      The moderator could not hide it anyway: set_segment_hidden refuses an
//      already-hidden part for the moderator (Stories.ts:1220).
//   3. The opener restores it (allowed for hidden_by 1, Stories.ts:1508). That sets
//      seg.restored = true, and refund_forfeited stays false (only a hidden_by 2
//      restore forfeits, Stories.ts:1511).
//   4. Next run: hiddenWhenRead re-checks it, but checkPart never hides a part
//      with seg.restored (check.mjs:376 duplicates, :399 web copies) — it only
//      adds a source note. The copied text stays up for good, the checker can
//      never hide it, and the writer keeps the right to a full refund.
//   The repo's RT-IMP B test passes on a source note alone, which hides nothing.
//
// Attack B ("pass the check, then reword"): the checker reads each part once
// (state.checked, check.mjs:466) and never looks at edits. The writer posts
// original text, waits for the run, then edit_segment rewords it into copied
// text for free (rewording costs nothing, Stories.ts:876-880). Never checked.
//
// Runs the real checker (load, plan, apply) through the shared harness (harness.mjs).
// Each attack test asserts the SAFE behaviour and FAILS while the attack works.
import assert from "node:assert/strict";
import test from "node:test";
import { BOOK, BOOKPAGE as COPIED, MOD, ORIGINAL, WRITER, run as runChecker, workdir } from "./harness.mjs";

const run = (dir, sc) => runChecker(dir, { book: BOOK, copiedText: COPIED, ...sc });

const config = { moderator: MOD, next_story_id: "2" };
const story = { "1": { status: 1, segment_count: "1" } };
const part = (extra) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: COPIED, created_at: "1000", ...extra } });
const hides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && String(o.args.seq) === "1");
const acts = (ops) => ops.filter((o) => (o.op === "set_segment_hidden" || o.op === "set_source_note") && String(o.args.seq) === "1");

test("control: a fresh copied part is hidden by the checker", () => {
  const dir = workdir();
  const { ops } = run(dir, { config, stories: story, segments: part({}) });
  assert.equal(hides(ops).length, 1, "harness: the checker should hide a fresh copied part");
});

test("control: an original part is left alone", () => {
  const dir = workdir();
  const { ops } = run(dir, { config, stories: story, segments: part({ text: ORIGINAL }) });
  assert.equal(acts(ops).length, 0, "harness: the original text should pass");
});

test("RT-SAB A: a part sock reports hid before the run, then its opener restored, is still hidden by the checker", () => {
  const dir = workdir();
  // Run 1: hidden by 3 sock writer reports just before the run.
  run(dir, { config, stories: story, segments: part({ hidden: true, hidden_by: 1 }) });
  // Run 2: the opener restored it (restored = true); the copied text is visible.
  const { ops } = run(dir, { config, stories: story, segments: part({ restored: true }) });
  assert.equal(hides(ops).length, 1,
    "RT-SAB A: the checker never hid the copied part: it treats seg.restored as 'the opener overrode MY hide', " +
    "though the hide it overrode was the sock reports'. The copy stays up for good and stays refundable");
});

test("RT-SAB B: a part the checker passed, then reworded by its writer into copied text, is checked again", () => {
  const dir = workdir();
  // Run 1: the writer's original text passes.
  run(dir, { config, stories: story, segments: part({ text: ORIGINAL }) });
  // Run 2: edit_segment reworded it (free) into a copied page.
  const { ops } = run(dir, {
    config, stories: story,
    segments: part({ text: COPIED, last_edited_by: WRITER, last_edited_at: "5000" }),
  });
  assert.ok(acts(ops).length > 0,
    "RT-SAB B: the checker reads each part once (state.checked) and never re-checks an edited part: copied text added by a free edit is never looked at");
});
