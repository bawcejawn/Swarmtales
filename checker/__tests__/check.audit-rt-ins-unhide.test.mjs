// Red-team (Insider) attack test, SwarmTales fix check @ 00eec36.
// Role: the moderator key, which only the copy checker uses. The checker
// walks the hides it made itself (state.hiddenByChecker) and, when the part
// is still hidden and its citation "covers" the source, plans an unhide.
// Attack: after the checker's hide, the admin (or writer reports) hides the
// part again; the writer then cites the source. The checker must never undo
// a hide the admin or writer reports made (AB-061): only hidden_by 2.
// Runs the real checker (load, plan, apply) through the shared harness; the
// apply step re-checks hidden_by on the chain before it signs an unhide.
import assert from "node:assert/strict";
import test from "node:test";
import { MOD, WRITER, run, unhidesOf, workdir, writeState } from "./harness.mjs";

const SOURCE = { title: "The Silent Harbour", author: "Jane Roe" };
const CITATION = "From The Silent Harbour by Jane Roe";
const TEXT = "A hidden part whose text does not matter here, long enough to be a part of a story on SwarmTales.";

function recheck(hiddenBy) {
  const dir = workdir();
  writeState(dir, { checked: { "7": 3 }, hiddenByChecker: { "7:3": { source: SOURCE, label: "Google Books: The Silent Harbour" } } });
  const { ops } = run(dir, {
    config: { moderator: MOD, next_story_id: "8" }, stories: { "7": { status: 1, segment_count: "3" } },
    segments: { "7:3": { status: 1, hidden: true, hidden_by: hiddenBy, moderation_reason: 1, citation: CITATION, author: WRITER, text: TEXT, created_at: "1000" } },
  }, { GOOGLE_BOOKS_KEY: "" });
  return unhidesOf(ops, 7, 3);
}

test("RT-INS unhide (sanity): the checker brings back its OWN hide when the writer cites the source", () => {
  assert.equal(recheck(2).length, 1, "precondition: the checker unhides a part the moderator hid");
});

test("RT-INS unhide: the checker's moderator key never undoes a hide the ADMIN made", () => {
  assert.equal(recheck(3).length, 0, "RT-INS unhide: the copy checker unhid a part the admin is holding (hidden_by 3)");
});

test("RT-INS unhide: the checker does not undo a hide made by writer reports either", () => {
  assert.equal(recheck(1).length, 0, "RT-INS unhide: the copy checker unhid a part writer reports hid (hidden_by 1)");
});
