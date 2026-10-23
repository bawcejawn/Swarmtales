// =====================================================================
// Red-team (Saboteur) attack tests, SwarmTales fix check @ e5255c6.
// Version limit (MAX_VERSIONS 100, revise_part only while version_count < 98)
// now that the writer's free edits are versions, and a takedown that reopens
// a LOCKED story. Each test asserts the SAFE behaviour: it FAILS while the
// attack works (RT-SAB-L3 is a regression check expected to PASS).
// Copy into stories/assembly/__tests__/ and run with as-pect.
// =====================================================================
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, MALLORY, START, DAY, USDT,
  reset, configure, openPublic, write, revise, segment, story, versions, takedown,
  authorize, allowCalls, checkpoint, setTime, directly,
} from "./auditFixHelpers";
import { ownEditArgs } from "./reviewed";

// Closures cannot capture locals in AssemblyScript: tests pass values through these.
let ID: u64 = 0;
let SEQ: u64 = 0;

const BOB_TEXT = "Bob writes a short scene in the harbour.";
const BOB_A    = "Aob writes a short scene in the harbour.";
const BOB_B    = "Bob writes a short scene in the harbour!";

// Distinct filler (the same exact text cannot go into one story twice).
let FILL: i32 = 0;
function letters(n: i32): string {
  FILL++;
  return String.fromCharCode(98 + FILL) + "a".repeat(n - 1);
}

// The writer's free, same-length rewording: no Ink moves, no external call.
function freeEdit(id: u64, seq: u64, text: string): void {
  authorize(BOB);
  new Stories().edit_segment(ownEditArgs(BOB, id, seq, text, <u64>text.length));
  checkpoint();
}
// `count` free edits alternating two texts; version_count ends at count + 1.
function freeEdits(id: u64, seq: u64, count: i32): void {
  for (let i = 0; i < count; i++) freeEdit(id, seq, i % 2 == 0 ? BOB_A : BOB_B);
}
// Cara fills the rest of the story (4 x 2,000 + the remainder): it auto-locks.
function fillAndLock(id: u64): void {
  for (let i = 0; i < 4; i++) write(CARA, id, letters(2000));
  const st = story(id);
  write(CARA, id, letters(<i32>(st.max_chars - st.used_chars)));
}

// ---------------------------------------------------------------------
// RT-SAB-L1: the writer freezes their own part for free. Paid changes stop at
// version_count 98 "leaving room for the writer's edit and the final edit",
// but the writer's free edit_segment now keeps a version too (rule 3). 97
// same-length rewordings (zero Ink, mana only) push version_count to 98, and
// from then on nobody (other writers, the opener, an editor) can change the
// part with revise_part, not even remove it with empty text. A spam or
// vandal part in someone else's story becomes untouchable except through
// the moderator/admin.
// ---------------------------------------------------------------------
describe("RT-SAB-L1: free writer edits use up the paid-change room", () => {
  beforeEach(() => { reset(); configure(); });

  it("a paid removal still works after the writer's 97 free rewordings", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    freeEdits(id, seq, 97);
    expect(segment(id, seq).version_count).toBe(98);
    expect(segment(id, seq).paid_changes).toBe(0);
    ID = id; SEQ = seq;
    expect(() => { revise(CARA, ID, SEQ, ""); }).not.toThrow(
      "RT-SAB-L1: the writer made their part un-removable by paying nothing (97 free edits filled the version room)");
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED,
      "RT-SAB-L1: the paid removal did not remove the part");
  });

  it("a first paid change still works after the writer's 97 free rewordings", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    freeEdits(id, seq, 97);
    ID = id; SEQ = seq;
    expect(() => { revise(CARA, ID, SEQ, "Bob writes a short scene in the harbor."); }).not.toThrow(
      "RT-SAB-L1: no paid change was ever made, yet nobody may change the part: the writer's free edits used up the 98");
    expect(segment(id, seq).paid_changes).toBe(1);
  });
});

// ---------------------------------------------------------------------
// RT-SAB-L2: a takedown reopens a LOCKED story (used_chars < max_chars)
// but leaves last_activity_at where it was. A full book whose opener has not
// closed it yet sits LOCKED (archive_if_stale only touches OPEN stories);
// after the takedown it is OPEN with a stale activity time, so any wallet
// archives it in the same block: the fund goes back, the open slot is freed,
// admin_take_over no longer applies, and if the opener's one free revive was
// already used the book can never be finished.
// ---------------------------------------------------------------------
describe("RT-SAB-L2: takedown reopens a long-locked story that anyone can archive", () => {
  beforeEach(() => { reset(); configure(); });

  it("archive_if_stale refuses a story the takedown has just reopened", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    fillAndLock(id);
    expect(story(id).status).toBe(stories.story_status.STATUS_LOCKED);
    // The opener has not closed the full book for 61 days (archive_days = 60).
    setTime(START + 61 * DAY);
    takedown(id, seq, BOB);
    expect(story(id).status).toBe(stories.story_status.STATUS_OPEN);
    ID = id;
    expect(() => {
      directly();
      authorize(MALLORY);
      new Stories().archive_if_stale(new stories.archive_if_stale_arguments(ID));
    }).toThrow("RT-SAB-L2: a saboteur archives a full book right after a takedown reopened it");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    expect(story(id).status).not.toBe(stories.story_status.STATUS_ARCHIVED,
      "RT-SAB-L2: the story was archived");
  });
});

// ---------------------------------------------------------------------
// RT-SAB-L3 (regression, expected to PASS): the writer cannot use the version
// limit to block the final edit. With version_count at 99 (98 free edits),
// the final edit still keeps version 100, and a later takedown wipes all 100.
// ---------------------------------------------------------------------
describe("RT-SAB-L3: the final edit at the version limit", () => {
  beforeEach(() => { reset(); configure(); });

  it("the finalizer's FINAL_EDITED still fits after the writer filled 99 versions", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    freeEdits(id, seq, 98);                    // v1 + 98 edits = 99
    freeEdit(id, seq, BOB_TEXT);               // at the limit: replaces v99
    expect(segment(id, seq).version_count).toBe(99);
    fillAndLock(id);
    authorize(ALICE); allowCalls(1);
    new Stories().close_story(new stories.close_story_arguments(ALICE, id));
    checkpoint();
    const fixed = "Bob writes a short scene in the harbor.."; // same length
    authorize(ALICE); allowCalls(2);
    new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, [
      new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED, "", 0),
      new stories.final_item(seq, stories.final_mode.FINAL_EDITED, fixed, <u64>fixed.length),
    ]));
    checkpoint();
    expect(segment(id, seq).text).toBe(fixed, "RT-SAB-L3: the final edit was blocked by the version limit");
    const vs = versions(id, seq);
    expect(vs.length).toBe(100);
    expect(vs[99].kind).toBe(5, "RT-SAB-L3: the final edit is not kept as version 100");
    takedown(id, seq, BOB);
    expect(segment(id, seq).version_count).toBe(0);
    expect(versions(id, seq).length).toBe(0, "RT-SAB-L3: the takedown left kept versions");
  });
});
