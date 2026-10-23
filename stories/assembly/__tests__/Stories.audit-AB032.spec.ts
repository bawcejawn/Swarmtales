// Audit Bot attack test for AB-032 (Swarmtales main @ 42f6af9).
// Attack: get copied text into a part's kept versions, remove the part (writer's free
// remove, or an empty revise_part), then wait for the takedown. takedown_segment wipes
// versions only for a part that is still live, so get_versions keeps serving the text.
// Asserts the SAFE behaviour: FAILS before the fix (proof), PASSES after (regression test).
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, CARA, configure, openPublic, ownerRemove, reset, revise, segment, takedown, versions, write,
} from "./auditFixHelpers";

const COPIED = "Copied paragraph from a published novel, pasted here word for word.";

describe("AUDIT AB-032: a takedown leaves the kept versions of a removed part readable", () => {
  beforeEach(() => { reset(); configure(); });

  it("writer removes the part after a paid change; takedown must wipe its versions", () => {
    const id = openPublic();
    const seq = write(BOB, id, "Bob's own honest opening line for this tale.");
    revise(CARA, id, seq, COPIED);
    expect(versions(id, seq).length).toBe(2);
    ownerRemove(BOB, id, seq);
    takedown(id, seq, CARA);
    expect(segment(id, seq).taken_down).toBe(true);
    expect(versions(id, seq).length).toBe(0, "AB-032: get_versions still returns the taken-down text");
  });

  it("changer removes the part with an empty revise_part; takedown must wipe its versions", () => {
    const id = openPublic();
    const seq = write(BOB, id, COPIED);
    revise(CARA, id, seq, "");
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
    takedown(id, seq, BOB);
    expect(versions(id, seq).length).toBe(0, "AB-032: the original (infringing) version survives the takedown");
  });
});
