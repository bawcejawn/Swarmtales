// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ d82364b.
// Role: whoever holds the moderator key (the copy checker's MODERATOR_WIF
// GitHub secret, or a workflow change that can use it).
// Claim (docs/ADMIN_POWERS.md): "A part the admin hid can be unhidden only by
// the admin, never by the moderator (the copy checker's key)."
// Code: restore_segment treats a pre-upgrade hide (hidden_by 0, not by
// reports) as a possible admin hide and refuses it (Stories.ts ~1508), but
// set_segment_hidden's unhide only refuses hidden_by == 3 (~1231):
//   System.require(seg.hidden_by != HIDDEN_BY_ADMIN || byAdmin, ...)
// So every admin hide made before the upgrade can be undone with the
// moderator key until the admin re-hides each one by hand. Nothing is lost
// by refusing it: the checker itself only ever unhides hidden_by == 2
// (check.mjs), and deploy.js hidePlan also lets the moderator unhide these.
// Asserts the SAFE behaviour. FAILS while the attack works.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, COPYRIGHT, STORIES, authorize, checkpoint, configure, openPublic, reset, segment, write,
} from "./auditFixHelpers";

const SEGMENTS_SPACE_ID: u32 = 3;
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
let gId: u64 = 0;
let gSeq: u64 = 0;

function u64Key(value: u64): Uint8Array {
  const key = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    key[i] = <u8>(v & 0xff);
    v = v >> 8;
  }
  return key;
}
function pairKey(a: u64, b: u64): Uint8Array {
  const out = new Uint8Array(16);
  const ka = u64Key(a);
  const kb = u64Key(b);
  for (let i = 0; i < 8; i++) { out[i] = ka[i]; out[8 + i] = kb[i]; }
  return out;
}
function moderatorUnhides(): void {
  authorize(BOT);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, false, stories.moderation_reason.REASON_UNSPECIFIED, "looks fine"));
}

describe("RT-INS legacyunhide: the moderator key undoes a pre-upgrade admin hide", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    gSeq = write(BOB, gId, "A part the admin hid after a rights holder's complaint, before the upgrade.");
    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, gId, gSeq, true, COPYRIGHT, "notice 2026-002"));
    checkpoint();
    // What the pre-upgrade record looks like: hidden, no hidden_by, not by reports.
    const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
    const seg = segs.get(pairKey(gId, gSeq))!;
    seg.hidden_by = 0;
    seg.hidden_by_reports = false;
    segs.put(pairKey(gId, gSeq), seg);
    checkpoint();
  });

  it("the moderator cannot unhide a hidden_by 0 part that restore_segment already treats as the admin's", () => {
    expect(moderatorUnhides).toThrow("RT-INS legacyunhide: the moderator key unhid a pre-upgrade admin hide (hidden_by 0)");
    MockVM.rollbackTransaction();
    expect(segment(gId, gSeq).hidden).toBe(true, "RT-INS legacyunhide: the admin-hidden part is visible again");
  });
});
