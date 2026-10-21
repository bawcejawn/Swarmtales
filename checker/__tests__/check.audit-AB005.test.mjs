// Audit Bot attack test for AB-005 (SwarmTales fix check, commit b002091).
// Attack: copy writer W's new part into a LOWER-numbered story before the
// checker's next run. The checker must flag the copy, never W's original.
// The run loop of check.mjs is reproduced with the real lib.mjs functions
// (checkOrder, Index.bestMatch with `at`, isDuplicate): no network.
// Test 1 asserts the AB-005 fix (PASSES on b002091).
// Test 2 [NEW FINDING AB-024]: the copy lands in the SAME block as the
// original (same created_at, e.g. front-run from the mempool). Asserts the
// safe behaviour (the original is not flagged) and FAILS on b002091.
// Copy into checker/__tests__/ and run: node --test checker/__tests__/
import assert from "node:assert/strict";
import test from "node:test";
import { Index, checkOrder, fingerprint, isDuplicate, isPartialDuplicate } from "../lib.mjs";

const ORIGINAL = "The lighthouse keeper counted the ships each night, and every night one more " +
  "came home than had left, a quiet grey hull that no harbour master had ever logged, " +
  "riding low in the water as if it carried the whole weight of the sea back to shore.";

// What check.mjs does with one run's new parts: oldest first, compare
// with earlier text only, index the clean ones. Returns the flagged keys.
function run(parts) {
  const index = new Index();
  const flagged = [];
  const fresh = [];
  for (const p of parts) {
    let s = fresh.find((x) => x.id === p.story);
    if (!s) fresh.push((s = { id: p.story, parts: [] }));
    s.parts.push({ seq: p.seq, at: p.at, seg: { author: p.author, text: p.text, created_at: String(p.at) } });
  }
  for (const { story, seq, seg } of checkOrder(fresh)) {
    const key = story + ":" + seq;
    const hashes = fingerprint(seg.text);
    const match = index.bestMatch(hashes, seg.author, key, Number(seg.created_at));
    if (match && (isDuplicate(hashes, match) || isPartialDuplicate(hashes, match))) flagged.push(key);
    else index.add(key, seg.author, hashes, seg.created_at);
  }
  return flagged;
}

test("AB-005: a later copy in a lower-numbered story is flagged, the original is not", () => {
  const flagged = run([
    { story: 10, seq: 4, at: 1000, author: "W", text: ORIGINAL },
    { story: 5, seq: 9, at: 1600, author: "COPIER", text: ORIGINAL },
  ]);
  assert.deepEqual(flagged, ["5:9"], "AB-005: the original writer was flagged");
});

test("AB-024: a copy in the same block as the original never gets the original flagged", () => {
  const flagged = run([
    { story: 10, seq: 4, at: 1000, author: "W", text: ORIGINAL },
    { story: 5, seq: 9, at: 1000, author: "COPIER", text: ORIGINAL },
  ]);
  assert.ok(!flagged.includes("10:4"), "AB-024: on a timestamp tie the lower story id wins, so the original 10:4 was flagged");
});
