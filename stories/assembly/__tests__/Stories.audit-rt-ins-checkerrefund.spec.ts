// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ 00eec36.
// Role: the opener, writing a copied part in her own story.
// Claim: docs/ADMIN_POWERS.md "Removing a part the admin or the checker hid
// refunds nothing." and the Stories header "A part the admin or moderator
// hid is not refunded when removed".
// AB-053 closed this for ADMIN hides only. For a CHECKER hide, the opener
// who wrote the part restores it herself (restore_segment allows any
// non-admin hide, Stories.ts ~1456), then removes it: refundable() is
// `!seg.hidden || seg.hidden_by_reports`, so the burned Ink comes back in
// full. `restored` also stops the checker from ever hiding it again
// (check.mjs `!seg.restored`). Net: the copy checker costs a copier nothing.
// Asserts the SAFE behaviour (no refund for a part the checker hid, even
// after the writer-opener restored it herself). FAILS on the current code.
// A fix that refuses a writer-opener restoring her own checker-hidden part
// makes the restore throw here: then change the call to expect(...).toThrow.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58 } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, mintsTo, openPublic, reset, segment,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const COPIED = "A long page Alice pasted from somebody else's published novel, word for word.";
let gId: u64 = 0;
let gSeq: u64 = 0;

function aliceWrites(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

describe("RT-INS checker refund: the writer-opener restores her own checker-hidden part and removes it", () => {
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
  });

  it("is not refunded for a part the copy checker hid", () => {
    expect(segment(gId, gSeq).hidden_by).toBe(2, "precondition: hidden by the moderator");
    const charged = segment(gId, gSeq).charged;
    expect(charged).toBeGreaterThan(0, "precondition: Alice paid Ink for the part");
    const before = mintsTo(ALICE);
    authorize(ALICE);
    new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "it's mine"));
    checkpoint();
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, gId, gSeq));
    checkpoint();
    expect(mintsTo(ALICE) - before).toBe(0,
      "RT-INS checker refund: Alice un-hid her own copied part (the checker never re-hides a restored part) and got all " +
        charged.toString() + " Ink back");
  });
});
