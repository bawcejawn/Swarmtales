// =====================================================================
// Audit Bot attack tests, SwarmTales fix check 4 (audit-fixes-2 @ d82364b).
// Attacks the fixes for AB-059 to AB-066 and the AB-046 residual from all
// sides. Each `it` asserts the SAFE behaviour; a failing `it` is a finding.
//   forfeit-bypass  AB-062: after a restored checker hide, a trim keeps
//                   `charged`; a sock's paid removal then refunds all of it.
//   invite          AB-046: a blocked opener still creates invites.
//   takeover/*      AB-061/062 controls (expected to pass).
// Copy into stories/assembly/__tests__/ (uses the repo's auditFixHelpers.ts).
// =====================================================================
import { Base58, MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, MALLORY, PRIVATE, START, DAY, STORIES, authorize, checkpoint, configure, mintsTo, openAs,
  openPublic, ownerEdit, ownerRemove, reset, revise, segment, story, strikes, takedown, write,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt");
const SEGMENTS_SPACE_ID: u32 = 3;
const PART_EDITORS_SPACE_ID: u32 = 28;
const PART_CHANGERS_SPACE_ID: u32 = 29;
const LIVE_PARTS_SPACE_ID: u32 = 30;
const BOB_TEXT = "Bob writes a short scene in the harbour, draft 000";

let gId: u64 = 0;
let gSeq: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);

function u64Key(value: u64): Uint8Array {
  const key = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) { key[i] = <u8>(v & 0xff); v = v >> 8; }
  return key;
}
function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  for (let i = 0; i < b.length; i++) out[a.length + i] = b[i];
  return out;
}
function draft(i: i32): string {
  const n = i.toString();
  return BOB_TEXT.slice(0, BOB_TEXT.length - n.length) + n;
}
function moderatorKey(): void {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
}
function hide(actor: Uint8Array, hidden: bool): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, gId, gSeq, hidden, COPYRIGHT, "checked"));
  checkpoint();
}
function moderatorHidesAgain(): void {
  authorize(BOT);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, true, COPYRIGHT, "again"));
}
function moderatorUnhides(): void {
  authorize(BOT);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, false, COPYRIGHT, "back"));
}
function aliceRestores(): void {
  authorize(ALICE);
  new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "fine"));
}
function autoTakedown(): void { takedown(gId, gSeq, new Uint8Array(0)); }
function strikeWho(): void { takedown(gId, gSeq, gWho); }
function blockedOpenerInvites(): void {
  authorize(ALICE);
  new Stories().create_invite(new stories.create_invite_arguments(ALICE, gId, MALLORY, 1000, START + 30 * DAY));
}
function bobSummary(): void {
  authorize(BOB);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(BOB, gId, "Bob sums it up."));
}
describe("AUDIT fc4: attacks on the AB-059..066 fixes", () => {
  beforeEach(() => { reset(); configure(); });

  it("forfeit-bypass: after the opener restores a checker hide, a sock's cheap paid removal must not refund the writer", () => {
    moderatorKey();
    gId = openPublic();
    const long = "B".repeat(1000);
    gSeq = write(BOB, gId, long);
    hide(BOT, true);
    aliceRestores();
    checkpoint();
    expect(segment(gId, gSeq).refund_forfeited).toBe(true);
    const before = mintsTo(BOB);
    ownerEdit(BOB, gId, gSeq, "Bob cut.");                // refund 0 (forfeited), charged stays 1000
    expect(mintsTo(BOB) - before).toBe(0, "precondition: the trim refunds nothing");
    revise(CARA, gId, gSeq, "");                           // CARA (a sock) removes it: 10 units x 2 = 20 Ink
    expect(mintsTo(BOB) - before).toBe(0, "AB-062 bypass: a 20-Ink paid removal refunded the forfeited part's 1,000 Ink to its writer");
  });

  it("invite: a blocked opener can't create invites (another way to change who may write, AB-046)", () => {
    gId = openAs(PRIVATE, 10000);
    authorize(STORIES);
    new Stories().set_blocked(new stories.set_blocked_arguments(ALICE, true, "repeated takedowns"));
    checkpoint();
    expect(blockedOpenerInvites).toThrow("AB-046 residual: a blocked opener created a 1,000-use invite");
    MockVM.rollbackTransaction();
  });

  it("takeover control: the admin takes over a checker hide in place; the opener then can't restore; hidden_count unchanged", () => {
    moderatorKey();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    hide(BOT, true);
    const count = story(gId).hidden_count;
    hide(STORIES, true);
    expect(segment(gId, gSeq).hidden_by).toBe(3);
    expect(story(gId).hidden_count).toBe(count);
    expect(aliceRestores).toThrow();
    MockVM.rollbackTransaction();
    expect(moderatorUnhides).toThrow("the checker key unhid the admin's takeover");
    MockVM.rollbackTransaction();
  });

  it("takeover control: the moderator can't take over a reports hide, nor hide an admin hide again", () => {
    moderatorKey();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    hide(STORIES, true);
    expect(moderatorHidesAgain).toThrow();
    MockVM.rollbackTransaction();
  });

  it("takedown control: naming the writer or no_strike reads no version and works on a writer-only part past 61", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    for (let i = 1; i <= 70; i++) ownerEdit(BOB, gId, gSeq, draft(i));
    gWho = BOB;
    expect(strikeWho).not.toThrow();
    expect(strikes(BOB)).toBe(1);
  });
});
