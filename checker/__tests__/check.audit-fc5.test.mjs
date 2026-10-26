// Audit Bot fix check 5 (Swarmtales @ da91205): attacks on the copy checker's re-check of edited
// parts (AB-067) and its takeover of writer-reports hides (AB-071). sc.failStory: get_story for that
// story throws, as a busy public node does now and then. Runs through the shared harness.
// Every test asserts the SAFE behaviour: a failure is a finding.
import assert from "node:assert/strict";
import test from "node:test";
import { ALICE, BOOK, BOOKPAGE, CITED, MOD, ORIGINAL, SABOTEUR as MALLORY, WRITER, hidesOf, run as runChecker, unhidesOf, workdir } from "./harness.mjs";

const run = (dir, sc, env) => runChecker(dir, { book: BOOK, copiedText: BOOKPAGE, ...sc }, env);
const config = { moderator: MOD, next_story_id: "2" };
const story = (extra) => ({ "1": { status: 1, segment_count: "1", ...extra } });
const part = (extra) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: BOOKPAGE, created_at: "1000", ...extra } });

test("C1: a part writer reports hid as abusive is never made visible by the checker because the writer cited a source", () => {
  const dir = workdir();
  // Writers reported a page of copied abusive text as ILLEGAL (reason 4); three reports hid it.
  const reported = part({ hidden: true, hidden_by: 1, moderation_reason: 4 });
  const first = run(dir, { config, stories: story(), segments: reported });
  const tookOver = hidesOf(first.ops, 1, 1).length;
  // If the takeover was sent, the chain now shows the checker's hide (reason COPYRIGHT); the writer
  // then names the book in the citation (allowed while hidden).
  const after = tookOver
    ? part({ hidden: true, hidden_by: 2, moderation_reason: 1, citation: CITED })
    : part({ hidden: true, hidden_by: 1, moderation_reason: 4, citation: CITED });
  const second = run(dir, { config, stories: story(), segments: after });
  assert.equal(unhidesOf(second.ops, 1, 1).length, 0,
    "the checker took over an abuse hide made by writer reports (takeover sent: " + tookOver + ") and then unhid it because the writer cited the source");
});

test("C3: an original is never hidden as a copy of a later copy of it because its writer fixed a typo", () => {
  const dir = workdir();
  const cfg2 = { moderator: MOD, next_story_id: "3" };
  const stA = (at) => ({ status: 1, segment_count: "1", last_activity_at: at });
  // Alice writes the original (story 1, t=1000). Mallory pastes it into story 2 at t=2000.
  const segs = (aliceText, aliceEdited) => ({
    "1:1": { status: 1, hidden: false, citation: "", author: ALICE, text: aliceText, created_at: "1000", ...(aliceEdited ? { last_edited_at: aliceEdited } : {}) },
    "2:1": { status: 1, hidden: false, citation: "", author: MALLORY, text: ORIGINAL, created_at: "2000" },
  });
  // Run 1: the node fails to return story 1 this once ("will retry next run"); story 2 is checked alone.
  run(dir, { config: cfg2, stories: { "1": stA("1000"), "2": stA("2000") }, segments: segs(ORIGINAL), failStory: "1" });
  // Run 2: story 1 is read; Alice's part is older than Mallory's, so it is clean.
  const r2 = run(dir, { config: cfg2, stories: { "1": stA("1000"), "2": stA("2000") }, segments: segs(ORIGINAL) });
  assert.equal(hidesOf(r2.ops, 1, 1).length, 0, "harness: the original is clean when first checked");
  // Run 3: Alice fixes one word of her own part (t=3000).
  const fixed = ORIGINAL.replace("so small", "so tiny");
  const r3 = run(dir, { config: cfg2, stories: { "1": stA("3000"), "2": stA("2000") }, segments: segs(fixed, "3000") });
  assert.equal(hidesOf(r3.ops, 1, 1).length, 0, "the checker hid Alice's original as a copy of Mallory's later copy of it");
});
