// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ e5255c6.
// Attack: the opener (or an editor) restores a part the ADMIN hid
// (restore_segment, Stories.ts ~1399, does not look at who hid it), and the
// writer then removes it with a full refund. When the opener IS the writer
// (their own book), the admin's hide while a takedown notice is checked is
// undone in one free call and the "not refunded" rule is bypassed:
//   Stories header: "A part the admin or moderator hid is not refunded when removed".
// Second route: restore_segment has no requireNotBlocked, so an opener
// blocked under the repeat-infringer policy keeps bringing copied parts the
// checker hid back into view (and `restored` stops the checker for good).
// Claim: ADMIN_POWERS.md "Block ... a wallet from opening, writing, editing,
// changing and reporting".
// Asserts the SAFE behaviour. FAILS on the current code.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, mintsTo, openPublic, reset, segment,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const COPIED = "A page Alice copied from somebody else's novel.";
let gId: u64 = 0;
let gSeq: u64 = 0;

function aliceWrites(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}
function hideAs(actor: Uint8Array): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, gId, gSeq, true, COPYRIGHT, "takedown notice being checked"));
  checkpoint();
}
function aliceRestores(): void {
  authorize(ALICE);
  new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "it's fine"));
}
function aliceRemoves(): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, gId, gSeq));
}

describe("RT-INS restore: the opener undoes the admin's or checker's hide", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    gSeq = aliceWrites(gId, COPIED);
  });

  it("an admin-hidden part removed by its writer is never refunded, even after the writer-opener restores it", () => {
    hideAs(STORIES);
    const before = mintsTo(ALICE);
    // Repo note: the audit called aliceRestores() unguarded, which fits the other fix the report
    // offered (remember "admin-hidden" for the refund). The owner chose "only the admin or the
    // moderator can unhide a part the admin hid", so the restore is refused here; AssemblyScript
    // can't catch an abort, so the refusal is asserted. The refund assertion below is unchanged.
    expect(aliceRestores).toThrow("RT-INS restore: the writer-opener unhid a part the admin hid");
    MockVM.rollbackTransaction();
    aliceRemoves();
    checkpoint();
    expect(mintsTo(ALICE) - before).toBe(0,
      "RT-INS restore: Alice restored her own admin-hidden part and removed it for a full refund");
  });

  it("a blocked opener cannot bring a hidden part back", () => {
    hideAs(BOT);
    authorize(STORIES);
    new Stories().set_blocked(new stories.set_blocked_arguments(ALICE, true, "repeat infringer"));
    checkpoint();
    expect(aliceRestores).toThrow("RT-INS restore: a blocked opener restored a part the copy checker hid");
    MockVM.rollbackTransaction();
    expect(segment(gId, gSeq).hidden).toBe(true, "RT-INS restore: the copied part is visible again");
  });
});
