// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ da91205.
// Role: Cara changed Bob's part on the old (main) code, in its LAST legacy
// slot (version 61); Bob, her friend, then edits it once after the upgrade so
// the part gets version 62 and the takedown stops scanning versions.
// Code: keepVersion's one-time scan (Stories.ts:2178-2188) reads versions
// 2..LEGACY_MAX_VERSIONS when a part with live_counted false gets version 62;
// takedown_segment uses other_version / partEditors after that
// (Stories.ts:1599-1615). Edge checked here: the old change sits in the very
// last slot the scan reads, and get_changers must list Cara for deploy.js.
// Expected to PASS (controls for AB-069). A FAILING test proves a hole.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, CARA, COPYRIGHT, STORIES, authorize, checkpoint, configure, openPublic, ownerEdit, reset, revise, segment, strikes, write,
} from "./auditFixHelpers";

const SEGMENTS_SPACE_ID: u32 = 3;
const PART_EDITORS_SPACE_ID: u32 = 28;
const PART_CHANGERS_SPACE_ID: u32 = 29;
const BOB_TEXT = "Bob writes a quiet scene at the old harbour, draft 000";
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
function draft(base: string, i: i32): string {
  const n = i.toString();
  return base.slice(0, base.length - n.length) + n;
}
function same(a: Uint8Array, b: Uint8Array): bool {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
  return true;
}
// The part as main left it: no flags, no changer records, never counted live.
function asOlderCodeLeftIt(id: u64, seq: u64): void {
  const key = join(u64Key(id), u64Key(seq));
  const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
  const seg = segs.get(key)!;
  seg.edited_by_others = false;
  seg.paid_changes = 0;
  seg.other_version = false;
  seg.live_counted = false;
  segs.put(key, seg);
  const editors = new Storage.Map<Uint8Array, stories.boole>(STORIES, PART_EDITORS_SPACE_ID, stories.boole.decode, stories.boole.encode, null);
  editors.remove(join(key, CARA));
  const changers = new Storage.Map<Uint8Array, stories.address_list>(STORIES, PART_CHANGERS_SPACE_ID,
    stories.address_list.decode, stories.address_list.encode, null);
  changers.remove(key);
  checkpoint();
}
function autoTakedown(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-062", new Uint8Array(0), false));
}
function strikeCara(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-062", CARA, false));
}

describe("RT5-INS legacy62: an old change in the last legacy slot, then version 62", () => {
  beforeEach(() => {
    reset(); configure();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    for (let i = 1; i <= 59; i++) ownerEdit(BOB, gId, gSeq, draft(BOB_TEXT, i)); // versions 1..60
    revise(CARA, gId, gSeq, draft(BOB_TEXT, 59) + " Cara pastes a copied page."); // version 61
    asOlderCodeLeftIt(gId, gSeq);
    expect(segment(gId, gSeq).version_count).toBe(61, "precondition: a full legacy history");
    const s = segment(gId, gSeq).text!;
    ownerEdit(BOB, gId, gSeq, s.slice(0, s.length - 1) + "!"); // version 62: the one-time scan
  });

  // Attack: Bob's single edit pushes the part past the takedown's scan; an automatic takedown must still refuse.
  it("the automatic takedown does not strike Bob for Cara's change in version 61", () => {
    expect(segment(gId, gSeq).version_count).toBe(62);
    expect(autoTakedown).toThrow("RT5-INS legacy62: Bob struck automatically for Cara's old change");
    MockVM.rollbackTransaction();
    expect(strikes(BOB)).toBe(0);
  });

  // Attack: Cara escapes the strike once the scan no longer runs at takedown time.
  it("the admin can strike Cara, and get_changers lists her for deploy.js takedown", () => {
    const list = new Stories().get_changers(new stories.get_changers_arguments(gId, gSeq)).values;
    let found = false;
    for (let i = 0; i < list.length; i++) if (same(list[i], CARA)) found = true;
    expect(found).toBe(true, "RT5-INS legacy62: the scan did not record Cara as a changer");
    expect(strikeCara).not.toThrow("RT5-INS legacy62: the admin can't name Cara");
    checkpoint();
    expect(strikes(CARA)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });
});
