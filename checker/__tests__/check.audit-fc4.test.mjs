// Fourth October fix check: the copy checker checks a part again when its
// text or citation changes (AB-067), checks hidden parts and takes over a
// writer-reports hide (AB-071), and never hides again a copy whose checker
// hide was undone, for the same text. Runs the real checker (load, plan,
// apply) through the shared harness.
import assert from "node:assert/strict";
import test from "node:test";
import { BOOK, BOOKPAGE, CITED, MOD, ORIGINAL, WRITER, hidesOf, notesOf, run as runChecker, workdir } from "./harness.mjs";

const run = (dir, sc, env) => runChecker(dir, { book: BOOK, copiedText: BOOKPAGE, ...sc }, env);
const config = { moderator: MOD, next_story_id: "2" };
const story = (extra) => ({ "1": { status: 1, segment_count: "1", ...extra } });
const part = (extra) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: BOOKPAGE, created_at: "1000", ...extra } });
const hides = (ops) => hidesOf(ops, undefined, 1);
const notes = (ops) => notesOf(ops, undefined, 1);

test("a part hidden by reports when first read is checked at once; a deferred check waits for the next run", () => {
  const dir = workdir();
  // Writers reported it as copied (only a reports hide for copying is taken over, AB-078).
  const reportsHidden = part({ hidden: true, hidden_by: 1, moderation_reason: 1 });
  // Too few searches left this run for the part's phrases: nothing happens, nothing is marked done.
  const first = run(dir, { config, stories: story(), segments: reportsHidden }, { SEARCH_PER_RUN: "1" });
  assert.equal(first.ops.length, 0);
  assert.equal(Number(first.state.checked["1"] || 0), 0, "the part waits for the next run");
  // Next run: the copy is found and the reports hide becomes the checker's.
  const { ops, state } = run(dir, { config, stories: story(), segments: reportsHidden });
  assert.equal(hides(ops).length, 1);
  assert.equal(state.checked["1"], 1);
  assert.ok(state.hiddenByChecker["1:1"], "remembered as the checker's hide");
});

test("a copy whose checker hide its opener restored is never hidden again for the same text, but is after an edit", () => {
  const dir = workdir();
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({}) }).ops).length, 1, "harness: hidden at first");
  // The opener restored it, which forfeits the refund.
  const restored = run(dir, { config, stories: story(), segments: part({ restored: true, refund_forfeited: true }) });
  assert.equal(hides(restored.ops).length, 0, "the opener's decision stands for this text");
  assert.equal(notes(restored.ops).length, 1, "it gets a source note instead");
  assert.equal(hides(run(dir, { config, stories: story(), segments: part({ restored: true, refund_forfeited: true }) }).ops).length, 0);
  // The writer swaps in another copied page: new text, checked and hidden again.
  const other = BOOKPAGE.replace("The circus arrives without warning.", "The circus arrives at night.");
  const { ops } = run(dir, {
    config, stories: story(), copiedText: other,
    segments: part({ text: other, restored: true, refund_forfeited: true, source_note: "Parts of this text also appear in a book.", last_edited_at: "5000" }),
  });
  assert.equal(hides(ops).length, 1);
});

test("a copy the admin took over and later unhid is never hidden again by the checker", () => {
  const dir = workdir();
  run(dir, { config, stories: story(), segments: part({}) });
  run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3 }) });
  const { ops } = run(dir, { config, stories: story(), segments: part({}) });
  assert.equal(hides(ops).length, 0);
});

test("a copy found while the admin holds it is left to the admin, and stays unhidden if the admin unhides it", () => {
  const dir = workdir();
  const held = run(dir, { config, stories: story(), segments: part({ hidden: true, hidden_by: 3 }) });
  assert.equal(held.ops.length, 0, "the moderator never touches an admin hide");
  assert.equal(held.state.seen["1:1"].v, "copy");
  const { ops } = run(dir, { config, stories: story(), segments: part({}) });
  assert.equal(hides(ops).length, 0, "the admin looked at it and unhid it");
});

test("a story unchanged since its last full read is not read again; a change in it is (AB-067)", () => {
  const dir = workdir();
  const quiet = story({ last_activity_at: "2000" });
  run(dir, { config, stories: quiet, segments: part({ text: ORIGINAL }) });
  const same = run(dir, { config, stories: quiet, segments: part({ text: ORIGINAL }) });
  assert.equal(same.reads.length, 0, "no part read again");
  const moved = run(dir, { config, stories: story({ last_activity_at: "3000" }), segments: part({ last_edited_at: "3000" }) });
  assert.ok(moved.reads.length > 0, "read again after activity");
  assert.equal(hides(moved.ops).length, 1, "the reworded copy is hidden");
});

test("a story active in the last few minutes is read in full again next run", () => {
  const dir = workdir();
  const recent = story({ last_activity_at: String(Math.floor(Date.now() / 1000)) });
  run(dir, { config, stories: recent, segments: part({ text: ORIGINAL }) });
  const again = run(dir, { config, stories: recent, segments: part({ text: ORIGINAL }) });
  assert.ok(again.reads.length > 0);
});

test("a story active minutes ago on the activity clock (Stories was paused for a day) is read in full again", () => {
  const dir = workdir();
  const now = Math.floor(Date.now() / 1000);
  // last_activity_at lags wall time by the paused day: it is recent all the same.
  const cfg = { ...config, paused_at: "0", paused_seconds: "86400" };
  const recent = story({ last_activity_at: String(now - 86400 - 60) });
  run(dir, { config: cfg, stories: recent, segments: part({ text: ORIGINAL }) });
  const again = run(dir, { config: cfg, stories: recent, segments: part({ text: ORIGINAL }) });
  assert.ok(again.reads.length > 0);
});

test("a cited copy is left alone, and hidden once the citation stops naming the source", () => {
  const dir = workdir();
  const cited = run(dir, { config, stories: story(), segments: part({ citation: CITED }) });
  assert.equal(cited.ops.length, 0);
  assert.equal(cited.state.seen["1:1"].v, "cited");
  const { ops } = run(dir, { config, stories: story(), segments: part({ citation: "my own words" }) });
  assert.equal(hides(ops).length, 1);
});
