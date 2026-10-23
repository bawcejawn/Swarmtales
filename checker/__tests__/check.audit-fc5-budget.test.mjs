// Audit Bot fix check 5: a run whose search budget lands on exactly 0 must not record the next long part as
// clean with no web search, for good (AB-083). Asserts the SAFE outcome. Runs through the shared harness.
import assert from "node:assert/strict";
import test from "node:test";
import { BOOK, MOD, SABOTEUR, WRITER, hidesOf, run, seg, workdir, writeState } from "./harness.mjs";

const BOOKPAGE =
  "The circus arrives without warning. No announcements precede it, no paper notices on downtown posts and billboards, " +
  "no mentions or advertisements in local newspapers. It is simply there, when yesterday it was not. The towering tents " +
  "are striped in white and black, no golds and crimsons to be seen. No color at all, save for the neighboring trees and " +
  "the grass of the surrounding fields. Black-and-white stripes on grey sky; countless tents of varying shapes and sizes, " +
  "with an elaborate wrought-iron fence encasing them in a colorless world. Even what little ground is visible from outside " +
  "is black or white, painted or powdered, or treated with some other circus trick.";

test("BUDGET-0: throwaway book copies drain the budget to exactly 0; the real copy posted next is still hidden or deferred", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, seen: { "1:1": { t: "x", c: "x", v: "clean" } } });
  // Story 1 part 1: the saboteur's throwaway copy, reworded (free) right after the last run: 5 searches, hidden.
  const segments = { "1:1": seg(SABOTEUR, BOOKPAGE + " Indeed.", 1000, { last_edited_at: "5000" }), "2:1": seg(WRITER, BOOKPAGE.replace("circus trick.", "circus trick!"), 6000) };
  const sc = { config: { moderator: MOD, next_story_id: "3" }, stories: { "1": { status: 1, segment_count: "1" }, "2": { status: 1, segment_count: "1" } },
    segments, book: BOOK, copiedText: BOOKPAGE };
  const r1 = run(dir, sc, { SEARCH_PER_RUN: "5" });
  assert.equal(hidesOf(r1.ops, 1, 1).length, 1, "harness: the throwaway copy is hidden and used the 5 searches");
  const v1 = r1.state.seen && r1.state.seen["2:1"] && r1.state.seen["2:1"].v;
  // Next run, full budget: a copy recorded as clean is never searched again.
  const r2 = run(dir, sc, { SEARCH_PER_RUN: "40" });
  assert.ok(hidesOf(r1.ops, 2, 1).length + hidesOf(r2.ops, 2, 1).length >= 1,
    "the copy was recorded '" + v1 + "' with no search when the budget hit 0, and is never searched again (next run: '" + r2.state.seen["2:1"].v + "')");
});
