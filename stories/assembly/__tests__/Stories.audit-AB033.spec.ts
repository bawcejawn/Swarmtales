// Audit Bot attack test for AB-033 (Swarmtales main @ 42f6af9).
// Attack: Bob writes clean text; Cara pays for a one-letter fix (version 2); Bob then
// swaps the whole part for copied text with a free edit_segment. No version records
// Bob's edit, so the history the admin compares (get_versions, deploy.js takedown) ends
// with Cara's clean version and names only Cara as a changer.
// Asserts the SAFE behaviour: FAILS before the fix (proof), PASSES after (regression test).
import {
  BOB, CARA, configure, openPublic, ownerEdit, reset, revise, segment, versions, write,
} from "./auditFixHelpers";

describe("AUDIT AB-033: the version history misses the writer's own later edits", () => {
  beforeEach(() => { reset(); configure(); });

  it("after a paid change, the newest kept version is the part's current text", () => {
    const id = openPublic();
    const seq = write(BOB, id, "The quiet river ran past the old mill at dawnn.");
    revise(CARA, id, seq, "The quiet river ran past the old mill at dawn.");
    // Two letters longer than the current text: Bob pays 2 Ink for them (rule 3).
    ownerEdit(BOB, id, seq, "It was the best of times, it was the worst of t.");
    const kept = versions(id, seq);
    const current = segment(id, seq).text!;
    const newest = kept.length > 0 ? kept[kept.length - 1].text! : "";
    expect(newest).toBe(current, "AB-033: the writer's free edit after a paid change is missing from the versions the admin compares");
  });
});
