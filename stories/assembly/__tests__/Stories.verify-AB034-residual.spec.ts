// Independent verifier (e5255c6): residual of AB-034 "summary follows membership".
// A writer whose only part the admin hid and who then removed it (no refund, so
// contributorTotals is not reduced) still counts as a "current writer" and can
// rewrite the 1,500-character story summary.
// Asserts the SAFE behaviour: FAILS if the residual is real.
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, COPYRIGHT, STORIES, authorize, checkpoint, configure, openPublic, ownerRemove, reset, segment, write,
} from "./auditFixHelpers";

// AssemblyScript has no closures: the story id lives in a module global (compile fix by the auditor).
let gId: u64 = 0;

describe("verify AB-034 residual", () => {
  it("a writer whose only part was admin-hidden and removed can no longer set the summary", () => {
    reset();
    configure();
    const id = openPublic();
    gId = id;
    const seq = write(BOB, id, "Bob writes fifty letters of story text here, ok!!");
    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, seq, true, COPYRIGHT, "matched a book"));
    checkpoint();
    ownerRemove(BOB, id, seq);
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
    authorize(BOB);
    expect(() => {
      new Stories().set_story_summary(new stories.set_story_summary_arguments(BOB, gId, "Bob's summary after his only part was removed"));
    }).toThrow();
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
  });
});
