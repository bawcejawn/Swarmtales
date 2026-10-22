// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ d82364b.
// Role: an editor (or the opener) the admin has BLOCKED (strike limit or
// set_blocked) who still holds the story role.
// Claim (docs/ADMIN_POWERS.md): a block stops a wallet "from opening,
// writing, editing, changing and reporting, setting a citation ..., restoring
// a hidden part and renaming a story"; AB-046 also took set_editor and
// set_allowed away from blocked wallets.
// Code: remove_segment (Stories.ts ~924) has no requireNotBlocked, and lets
// the opener or an editor remove ANY hidden part of another writer. A part
// the checker hid is removed with no refund (refundable() false), so the
// blocked wallet can still wipe other writers' parts and their Ink while the
// checker or admin is still looking at them (a false positive can no longer
// be unhidden: the part is gone).
// Asserts the SAFE behaviour (a blocked opener/editor cannot remove someone
// else's part). FAILS while the attack works. Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, openPublic, reset, segment, write,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
let gId: u64 = 0;
let gSeq: u64 = 0;

function block(who: Uint8Array): void {
  authorize(STORIES);
  new Stories().set_blocked(new stories.set_blocked_arguments(who, true, "repeated takedowns"));
  checkpoint();
}
function caraRemoves(): void {
  authorize(CARA);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(CARA, gId, gSeq));
}
function aliceRemoves(): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, gId, gSeq));
}

describe("RT-INS blockedremove: a blocked opener/editor still removes other writers' hidden parts", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    authorize(ALICE);
    new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, CARA, true));
    checkpoint();
    gSeq = write(BOB, gId, "Bob's own original paragraph, which the checker flagged by mistake.");
    authorize(BOT);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, true, COPYRIGHT, "copied text: 4 of 5 phrases found"));
    checkpoint();
  });

  it("a blocked editor cannot remove Bob's hidden part", () => {
    block(CARA);
    expect(caraRemoves).toThrow("RT-INS blockedremove 1: blocked editor Cara removed Bob's hidden part (no refund to Bob)");
    MockVM.rollbackTransaction();
    expect(segment(gId, gSeq).status).toBe(stories.segment_status.SEGMENT_ACTIVE, "RT-INS blockedremove 1: Bob's part is gone");
  });

  it("a blocked opener cannot remove Bob's hidden part", () => {
    block(ALICE);
    expect(aliceRemoves).toThrow("RT-INS blockedremove 2: blocked opener Alice removed Bob's hidden part (no refund to Bob)");
    MockVM.rollbackTransaction();
    expect(segment(gId, gSeq).status).toBe(stories.segment_status.SEGMENT_ACTIVE, "RT-INS blockedremove 2: Bob's part is gone");
  });
});
