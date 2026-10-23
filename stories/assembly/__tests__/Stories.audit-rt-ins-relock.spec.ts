// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ 00eec36.
// Angle: the admin's hide is the only one an opener can't undo (AB-053),
// but the admin can only make a hide "admin" by hiding a VISIBLE part:
// set_segment_hidden(hidden=true) refuses a part that is already hidden
// ("part is already hidden", Stories.ts ~1184). Two real cases:
//  (a) The copy checker (moderator) hid Bob's part; a takedown notice for it
//      arrives and the admin wants it held. The admin can't lock it in place,
//      so the opener can restore it at any time while the notice is checked.
//  (b) docs/TESTNET_UPGRADE_AUDIT2.md: a part the admin hid before the upgrade
//      has hidden_by 0, so its opener can still restore it; the runbook says
//      "Unhide it and hide it again with the admin key to lock it", and
//      deploy.js `hide` / `hide --unhide` send those as TWO transactions.
//      Between them the part is visible and refundable: its writer removes it
//      for a full refund (refundable() = !hidden), or the opener just leaves
//      it up, which is exactly what the admin hide was meant to stop.
// Asserts the SAFE behaviour: the admin can take over an existing hide
// without the part ever becoming visible. FAILS on the current code.
// (A deploy-only fix that sends unhide+hide in one transaction would close
// (b) but not make these pass; say so if that is the fix chosen.)
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, mintsTo, openPublic, reset, segment, write,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const SEGMENTS_SPACE_ID: u32 = 3;
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
  const x = u64Key(a);
  const y = u64Key(b);
  for (let i = 0; i < 8; i++) { out[i] = x[i]; out[8 + i] = y[i]; }
  return out;
}

function hideAs(actor: Uint8Array): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, gId, gSeq, true, COPYRIGHT, "takedown notice being checked"));
}
function adminLocks(): void { hideAs(STORIES); }
function aliceRestores(): void {
  authorize(ALICE);
  new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "looks fine to me"));
}
function bobRemoves(): void {
  authorize(BOB);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(BOB, gId, gSeq));
}
// What the pre-upgrade code left for a part the admin hid: hidden, not by
// reports, and no hidden_by (new field, 0).
describe("RT-INS relock: the admin takes over a hide without unhiding the part", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's part, which a rights holder says was copied from her novel.");
  });

  it("(a) a part the copy checker hid can be locked by the admin while it stays hidden", () => {
    hideAs(BOT);
    checkpoint();
    expect(segment(gId, gSeq).hidden_by).toBe(2, "precondition: the checker's hide is recorded as the moderator's");
    expect(adminLocks).not.toThrow(
      "RT-INS relock: the admin can't hold a checker-hidden part under a takedown notice without first making it visible");
    checkpoint();
    expect(segment(gId, gSeq).hidden_by).toBe(3, "RT-INS relock: the admin's hold was not recorded");
    expect(aliceRestores).toThrow("RT-INS relock: the opener restored a part the admin is holding");
    MockVM.rollbackTransaction();
  });
});
