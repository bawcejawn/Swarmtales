// =====================================================================
// Red-team (Saboteur) attack test, SwarmTales fix check @ d82364b.
// Target: takedown_segment's legacy cut-off (Stories.ts:1557, 1562-1568):
//     legacy = seg.version_count <= LEGACY_MAX_VERSIONS (61)
// The fixer's premise (Stories.ts:168-170) is that only a part with at most 61
// versions can hold versions the flags don't know about. But a pre-upgrade part
// keeps its old versions in slots 1..N and the WRITER's post-upgrade free edits
// are appended after them (keepVersion, Stories.ts:2119-2127). Once the writer
// has edited 60 times, version_count > 61, the old change is no longer scanned:
//   - an automatic takedown strikes the (innocent) writer for the old changer's
//     words, and
//   - the admin can no longer name the old changer (partEditors has no entry,
//     the version scan is skipped): "strike the part's writer or a wallet that
//     changed it". The culprit can't be struck at all.
// deploy/lib.js:470 (legacyPartNotes) still promises "After the upgrade a
// takedown asks who gets the strike".
// The legacy state is written straight into storage the way older code left it
// (as Stories.audit-rt-ins-legacychange.spec.ts does). Asserts the SAFE
// behaviour; FAILS while the attack works.
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
function draft(i: i32): string {
  const n = i.toString();
  return BOB_TEXT.slice(0, BOB_TEXT.length - n.length) + n;
}

// Bob's part as the pre-flag testnet code left it: Cara's paid change is
// version 2, but no edited_by_others, paid_changes, other_version, changer
// record, or live-part count existed yet.
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
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-777", new Uint8Array(0), false));
}
function strikeCara(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-777", CARA, false));
}

describe("RT-SAB legacygrow: an old part someone else changed, edited 60 times by its writer after the upgrade", () => {
  beforeEach(() => {
    reset(); configure();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    revise(CARA, gId, gSeq, BOB_TEXT + " Cara pastes a copied page.");
    asOlderCodeLeftIt(gId, gSeq);
    // Bob cleans up his part over time (free rewording, same length).
    for (let i = 1; i <= 60; i++) ownerEdit(BOB, gId, gSeq, draft(i));
  });

  it("an automatic takedown still refuses to pick the writer (Cara's old change is in version 2)", () => {
    expect(segment(gId, gSeq).version_count).toBe(62, "precondition: 2 old versions + 60 writer edits");
    expect(segment(gId, gSeq).edited_by_others).toBe(false, "precondition: no flag knows about Cara");
    expect(autoTakedown).toThrow("RT-SAB legacygrow: the takedown struck Bob automatically for Cara's pre-upgrade change");
    MockVM.rollbackTransaction();
    expect(strikes(BOB)).toBe(0, "RT-SAB legacygrow: Bob was struck for Cara's text");
  });

  it("the admin can still strike Cara, the wallet the old version names", () => {
    expect(strikeCara).not.toThrow("RT-SAB legacygrow: the contract refuses to strike the real changer once the writer edited past 61 versions");
    checkpoint();
    expect(strikes(CARA)).toBe(1, "RT-SAB legacygrow: Cara escaped the strike");
    expect(strikes(BOB)).toBe(0);
  });
});
