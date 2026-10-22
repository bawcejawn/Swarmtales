// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ d82364b.
// Role: the opener, who wrote a copied part in her own story, plus any
// friend wallet that can write in a public story.
// Claim (docs/ADMIN_POWERS.md, Refunds; Stories.ts header; AB-062): "if the
// opener or an editor restores it instead, cutting or removing it later
// refunds nothing."
// Code: restore_segment sets seg.refund_forfeited (Stories.ts ~1511), and
// cutRefund / refundable honour it (~2142, ~2163). But revise_part removal
// refunds `seg.charged` directly, never asking refund_forfeited:
//   const refund = removing ? seg.charged : this.cutRefund(seg, newCost);   (~1314)
// Worse, because cutRefund returns 0 after the restore, the writer's free
// shrink (edit_segment) leaves `charged` at the full amount while the part
// becomes a few letters long, so the friend's removal costs only
// max(10, letters) x 2 = 20 Ink and returns the whole forfeited charge.
// Each test asserts the SAFE behaviour and FAILS while the attack works.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58 } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, mintsTo, openPublic, ownerEdit, reset,
  revise, segment,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const COPIED = "A long page Alice pasted from somebody else's published novel, word for word, all of it.";
let gId: u64 = 0;
let gSeq: u64 = 0;

function aliceWrites(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

describe("RT-INS forfeit: a restored checker hide still gets its Ink back through revise_part", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    gSeq = aliceWrites(gId, COPIED);
    authorize(BOT);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, true, COPYRIGHT, "copied text: 5 of 5 phrases found"));
    checkpoint();
    authorize(ALICE);
    new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "it's mine"));
    checkpoint();
  });

  it("a friend's paid removal refunds nothing once the opener restored the checker's hide", () => {
    expect(segment(gId, gSeq).refund_forfeited).toBe(true, "precondition: the restore forfeited the refund");
    const before = mintsTo(ALICE);
    revise(BOB, gId, gSeq, "");
    expect(segment(gId, gSeq).status).toBe(stories.segment_status.SEGMENT_REMOVED, "harness: Bob's empty change removed the part");
    expect(mintsTo(ALICE) - before).toBe(0,
      "RT-INS forfeit 1: revise_part removal refunded Alice's forfeited Ink (it uses seg.charged, not refund_forfeited)");
  });

  it("shrink-then-remove: the whole forfeited charge does not come back for a 20 Ink removal", () => {
    const charged = segment(gId, gSeq).charged;
    // Free shrink by the writer: refund 0 (forfeited) so `charged` stays full.
    ownerEdit(ALICE, gId, gSeq, "Short.");
    expect(mintsTo(ALICE)).toBe(0, "harness: the forfeited cut refunded nothing");
    expect(segment(gId, gSeq).charged).toBe(charged, "harness: charged is untouched by the forfeited cut");
    const before = mintsTo(ALICE);
    revise(BOB, gId, gSeq, ""); // max(10, 6) x 2 = 20 Ink from Bob
    expect(mintsTo(ALICE) - before).toBe(0,
      "RT-INS forfeit 2: for a 20 Ink removal by a friend, Alice got all " + charged.toString() +
        " forfeited Ink back from a part the checker had hidden");
  });
});
