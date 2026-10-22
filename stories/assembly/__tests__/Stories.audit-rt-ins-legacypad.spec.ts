// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ d82364b.
// Roles: Cara changed Bob's part with copied text BEFORE the upgrade (on
// the testnet main code: no edited_by_others, no changer records, no
// paid_changes, no other_version; the change shows only in kept versions).
// Bob (the part's writer; Cara's friend or sock) then makes free rewording
// edits after the upgrade.
// Code (AB-059, Stories.ts takedown_segment ~1557): the version scan
// (versionByOther) runs only when version_count <= LEGACY_MAX_VERSIONS (61),
// on the assumption (comment at the constant, ~169) that "only a part with
// this many or fewer can hold versions that edited_by_others and
// other_version don't know about". False: after the upgrade every writer
// edit is a new version (up to WRITER_VERSION_ROOM 99), so ~60 free edits
// push a legacy part past 61 and hide Cara's version from the takedown:
//  - naming Cara is refused ("strike the part's writer or a wallet that
//    changed it"), so the real changer can't be struck;
//  - the default takedown strikes Bob automatically for Cara's text.
// Asserts the SAFE behaviour. FAILS while the attack works.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, CARA, COPYRIGHT, STORIES, authorize, checkpoint, configure, openPublic, ownerEdit, reset, revise, segment,
  strikes, write,
} from "./auditFixHelpers";

const SEGMENTS_SPACE_ID: u32 = 3;
const PART_EDITORS_SPACE_ID: u32 = 28;
const PART_CHANGERS_SPACE_ID: u32 = 29;
const CARA_TEXT = "Cara pasted three sentences from a published thriller over Bob's paragraph here.";
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

function asOlderCodeLeftIt(id: u64, seq: u64): void {
  const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
  const key = pairKey(id, seq);
  const seg = segs.get(key)!;
  seg.edited_by_others = false;
  seg.paid_changes = 0;
  seg.other_version = false;
  // Fix (audit-fixes-2): a part written before the upgrade was never counted as
  // a live part (live_counted didn't exist), as Stories.audit-rt-sab-legacygrow
  // and Stories.audit-fc4-attacks set it. The contract reads that flag to know
  // a part is from before the upgrade (AB-069).
  seg.live_counted = false;
  segs.put(key, seg);
  const editors = new Storage.Map<Uint8Array, stories.boole>(STORIES, PART_EDITORS_SPACE_ID, stories.boole.decode, stories.boole.encode, null);
  editors.remove(join(key, CARA));
  const changers = new Storage.Map<Uint8Array, stories.address_list>(STORIES, PART_CHANGERS_SPACE_ID, stories.address_list.decode, stories.address_list.encode, null);
  changers.remove(key);
  checkpoint();
}
function strikeCara(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-501", CARA, false));
}
function takedownDefault(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-501", new Uint8Array(0), false));
}

describe("RT-INS legacypad: the writer's free edits push a legacy-changed part past the version scan", () => {
  beforeEach(() => {
    reset(); configure();
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's own paragraph about the lighthouse keeper and his dog.");
    revise(CARA, gId, gSeq, CARA_TEXT);
    asOlderCodeLeftIt(gId, gSeq);
    // Bob toggles the last character: same length, free, a new version each time.
    for (let i = 0; i < 60; i++) {
      const s = segment(gId, gSeq).text!;
      const last = s.charAt(s.length - 1) == "." ? "!" : ".";
      ownerEdit(BOB, gId, gSeq, s.substring(0, s.length - 1) + last);
    }
  });

  it("the admin can still strike Cara, whose change is in the kept versions", () => {
    expect(segment(gId, gSeq).version_count).toBeGreaterThan(61, "harness: past LEGACY_MAX_VERSIONS");
    expect(strikeCara).not.toThrow("RT-INS legacypad 1: takedown refuses to strike Cara once Bob's free edits passed 61 versions");
    MockVM.commitTransaction();
    expect(strikes(CARA)).toBe(1, "RT-INS legacypad 1: Cara got no strike");
  });

  it("the default takedown does not strike Bob for Cara's change", () => {
    expect(takedownDefault).toThrow("RT-INS legacypad 2: the default takedown struck Bob automatically for Cara's pre-upgrade change");
    MockVM.rollbackTransaction();
    expect(strikes(BOB)).toBe(0, "RT-INS legacypad 2: Bob got a strike for Cara's text");
  });
});
