// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ e5255c6.
// Upgrade promise under test (docs/TESTNET_UPGRADE_AUDIT2.md, "all data is
// kept"; "Parts changed before this upgrade start counting paid changes from
// zero"). The code on main decided "changed by someone else" as
//     seg.edited_by_others || seg.version_count > 0
// with the comment "version_count also catches parts revised before
// edited_by_others existed". e5255c6 replaced it with
//     seg.edited_by_others || seg.paid_changes > 0     (Stories.ts ~1446)
// paid_changes is a NEW field (0 on every part written by older code). A
// part that someone else revised before edited_by_others/partEditors existed
// (testnet, the revise_part era before AB-028) now looks untouched: a
// takedown strikes its WRITER automatically for text another wallet wrote,
// which is exactly the framing AB-001/AB-029 closed. The version history
// (kept, readable with get_versions) still shows the other wallet's change.
// The test writes the segment as older code left it, straight into Stories'
// storage (space 3, and no partEditors entry in space 28).
// Asserts the SAFE behaviour: the admin must decide (or the writer is not
// struck). FAILS on the current code.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, CARA, COPYRIGHT, STORIES, authorize, checkpoint, configure, openPublic, reset, revise, segment, strikes, versions, write,
} from "./auditFixHelpers";

const SEGMENTS_SPACE_ID: u32 = 3;
const PART_EDITORS_SPACE_ID: u32 = 28;
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
function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  for (let i = 0; i < b.length; i++) out[a.length + i] = b[i];
  return out;
}
function pairKey(a: u64, b: u64): Uint8Array { return join(u64Key(a), u64Key(b)); }

// Make Bob's part look as the pre-AB-028 code left it: Cara's revise is in
// the versions, but there was no edited_by_others, no changer record and no
// paid_changes counter yet.
function asOlderCodeLeftIt(id: u64, seq: u64): void {
  const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
  const key = pairKey(id, seq);
  const seg = segs.get(key)!;
  seg.edited_by_others = false;
  seg.paid_changes = 0;
  segs.put(key, seg);
  const editors = new Storage.Map<Uint8Array, stories.boole>(STORIES, PART_EDITORS_SPACE_ID, stories.boole.decode, stories.boole.encode, null);
  editors.remove(join(key, CARA));
  checkpoint();
}

function takedownDefault(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-401", new Uint8Array(0), false));
}

describe("RT-INS legacy change: a part revised by someone else before the upgrade", () => {
  beforeEach(() => {
    reset(); configure();
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob wrote this scene himself, every word of it.");
    revise(CARA, gId, gSeq, "Bob wrote this scene himself, every word of it. Then Cara pasted a copied page here.");
    asOlderCodeLeftIt(gId, gSeq);
  });

  it("still treats it as changed by someone else (the kept versions show Cara's change)", () => {
    const kept = versions(gId, gSeq);
    expect(kept.length).toBe(2, "precondition: the original and Cara's change are kept");
    expect(segment(gId, gSeq).edited_by_others).toBe(false, "precondition: older code never set edited_by_others");
    expect(takedownDefault).toThrow(
      "RT-INS legacychange: the takedown struck Bob automatically for a part Cara changed before the upgrade");
    expect(strikes(BOB)).toBe(0, "RT-INS legacychange: Bob got a strike for Cara's text");
  });
});
