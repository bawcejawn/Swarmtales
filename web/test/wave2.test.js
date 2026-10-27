// Wave 2 website rules: suggestions are only offered for acceptance while
// they still match the part, and each person gets only their own actions.
import assert from "node:assert/strict";
import test from "node:test";
import { abis } from "../src/generated/abis.js";
import { isCurrent, suggestionActions } from "../src/lib/suggest.js";

test("wave 2: the Stories ABI has the suggestion and story-guide methods", () => {
  const m = abis.stories.methods;
  for (const name of ["suggest_change", "accept_suggestion", "decline_suggestion", "set_story_guide"]) {
    assert.ok(m[name] && !m[name].read_only, name);
  }
  assert.equal(m.get_suggestions.read_only, true);
});

test("wave 2: a suggestion is current only while the part's text and version count are unchanged", () => {
  const seg = { text_hash: "EiAAAA", version_count: 3 };
  assert.equal(isCurrent({ base_hash: "EiAAAA", base_versions: 3 }, seg), true);
  assert.equal(isCurrent({ base_hash: "EiAAAA", base_versions: 2 }, seg), false);
  assert.equal(isCurrent({ base_hash: "EiBBBB", base_versions: 3 }, seg), false);
});

test("wave 2: the writer accepts or declines, the proposer withdraws, others only close stale ones", () => {
  const seg = { author: "1W", text_hash: "H", version_count: 2 };
  const live = { status: 0, proposer: "1P", base_hash: "H", base_versions: 2 };
  const stale = { ...live, base_versions: 1 };
  assert.deepEqual(suggestionActions(live, seg, "1W", true), ["accept", "decline"]);
  assert.deepEqual(suggestionActions(stale, seg, "1W", true), ["decline"]);
  assert.deepEqual(suggestionActions(live, seg, "1P", true), ["withdraw"]);
  assert.deepEqual(suggestionActions(live, seg, "1X", true), []);
  assert.deepEqual(suggestionActions(stale, seg, "1X", true), ["close"]);
  assert.deepEqual(suggestionActions(live, seg, "1W", false), [], "only while the story is open");
  assert.deepEqual(suggestionActions({ ...live, status: 1 }, seg, "1W", true), [], "only while waiting");
});
