// Audit Bot fix check 5 (Swarmtales @ da91205). Attack tests for the fifth pass:
//   TK-*  the moderator key's new power to take over a writer-reports hide (AB-071).
// Every test asserts the SAFE behaviour: a failure is a finding.
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
