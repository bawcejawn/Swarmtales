// Audit Bot fix check 5 (Swarmtales @ da91205). Attack tests for the fifth pass:
//   OW-*  the new rule that a pre-upgrade writer keeps going by its Ink total after it writes new
//         parts (oldWriters, AB-066 edge): can it be gamed for refunds, strikes or the summary right?
//   TK-*  the moderator key's new power to take over a writer-reports hide (AB-071).
// Every test asserts the SAFE behaviour: a failure is a finding.
// OW-3 (the summary right, AB-079) needs a contract change and is left for the next contract upgrade
// (docs/TESTNET_UPGRADE_AUDIT2.md); it is in the Audit Bot run's tests.
// Pre-upgrade state is made the way the repo's own Stories.audit-fc4-fixes.spec.ts does it.
import { Base58, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, MALLORY, STORIES, authorize, burnsFrom, checkpoint, configure, mintsTo, openPublic,
  ownerRemove, reset, revise, segment, strikes, takedown, write,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const SEGMENTS_SPACE_ID: u32 = 3;
const LIVE_PARTS_SPACE_ID: u32 = 30;
const ILLEGAL = stories.moderation_reason.REASON_ILLEGAL;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;

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
// A part and its writer as written before parts were counted (as the repo's makePreUpgrade).
function makePreUpgrade(id: u64, seq: u64, who: Uint8Array): void {
  const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
  const key = join(u64Key(id), u64Key(seq));
  const seg = segs.get(key)!;
  seg.live_counted = false;
  segs.put(key, seg);
  const live = new Storage.Map<Uint8Array, stories.uint32>(STORIES, LIVE_PARTS_SPACE_ID, stories.uint32.decode, stories.uint32.encode, null);
  live.remove(join(u64Key(id), who));
  checkpoint();
}
function summarize(who: Uint8Array, id: u64): void {
  authorize(who);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(who, id, "The keeper meets the fog."));
  checkpoint();
}
function moderator(): void {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
}
function report(who: Uint8Array, id: u64, seq: u64, reason: stories.moderation_reason): void {
  authorize(who);
  new Stories().report_segment(new stories.report_segment_arguments(who, id, seq, reason, "reported"));
  checkpoint();
}
function hideAs(actor: Uint8Array, id: u64, seq: u64, hidden: bool): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, id, seq, hidden, COPYRIGHT, "copied text"));
  checkpoint();
}

let gId: u64 = 0;
let gSeq: u64 = 0;

describe("OW: a pre-upgrade writer's Ink-total rule can't be gamed for refunds or strikes", () => {
  beforeEach(() => { reset(); configure(); gId = openPublic(); });

  it("OW-1 refunds: an old writer who writes, then removes everything, gets back at most what it paid", () => {
    const old = write(BOB, gId, "Bob's part from before the upgrade, forty letters.");
    makePreUpgrade(gId, old, BOB);
    const fresh = write(BOB, gId, "Bob's new part, written after the upgrade.");
    ownerRemove(BOB, gId, fresh);
    ownerRemove(BOB, gId, old);
    // A second round on top of the flag: write and remove again.
    const again = write(BOB, gId, "Bob writes once more after the flag is set.");
    ownerRemove(BOB, gId, again);
    expect(mintsTo(BOB)).toBeLessThanOrEqual(burnsFrom(BOB), "never more back than paid");
    const st = new Stories().get_story(new stories.get_story_arguments(gId));
    expect(st.total_refunded).toBeLessThanOrEqual(st.total_burned);
    expect(new Stories().get_contributor_total(new stories.get_contributor_total_arguments(gId, BOB)).value).toBe(0, "Bob's total is back to 0");
  });

  it("OW-2 strikes: the flag doesn't change who a default takedown strikes", () => {
    const old = write(BOB, gId, "Bob's part from before the upgrade.");
    makePreUpgrade(gId, old, BOB);
    const fresh = write(BOB, gId, "Bob's new part after the upgrade.");
    takedown(gId, fresh, new Uint8Array(0));
    expect(strikes(BOB)).toBe(1, "Bob's own new part strikes Bob");
    takedown(gId, old, new Uint8Array(0));
    expect(strikes(BOB)).toBe(2, "Bob's own old part strikes Bob");
    expect(strikes(CARA)).toBe(0);
  });

  it("OW-4 summary (legit use): an old writer whose first new act is a paid change keeps the right while its old part is live", () => {
    const cara = write(CARA, gId, "Cara's part that Bob will pay to change.");
    const old = write(BOB, gId, "Bob's part from before the upgrade.");
    makePreUpgrade(gId, old, BOB);
    revise(BOB, gId, cara, "Cara's part that Bob paid to change, with twenty more letters.");
    expect(segment(gId, old).status).toBe(stories.segment_status.SEGMENT_ACTIVE, "precondition: Bob's old part is live");
    expect(() => { summarize(BOB, gId); }).not.toThrow("Bob still has a live part from before the upgrade");
  });
});

describe("TK: the moderator key's takeover of a writer-reports hide", () => {
  beforeEach(() => {
    reset(); configure(); moderator();
    gId = openPublic();
    write(CARA, gId, "Cara's own part.");
    write(MALLORY, gId, "Mallory's own part.");
  });

  it("TK-2 control: a copyright reports hide is taken over; the opener's restore then forfeits the refund", () => {
    const seq = write(BOB, gId, "A copied page that sock writers reported.");
    report(ALICE, gId, seq, COPYRIGHT);
    report(CARA, gId, seq, COPYRIGHT);
    report(MALLORY, gId, seq, COPYRIGHT);
    hideAs(BOT, gId, seq, true);
    expect(segment(gId, seq).hidden_by).toBe(2);
    authorize(ALICE);
    new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, seq, "fine"));
    checkpoint();
    expect(segment(gId, seq).refund_forfeited).toBe(true);
  });

  it("TK-3 the moderator can't take over a hide on a visible part's behalf twice, nor the admin's", () => {
    gSeq = write(BOB, gId, "A copied page.");
    hideAs(STORIES, gId, gSeq, true);
    expect(() => { hideAs(BOT, gId, gSeq, true); }).toThrow("admin hide");
    expect(() => { hideAs(BOT, gId, gSeq, false); }).toThrow("admin hide");
  });
});
