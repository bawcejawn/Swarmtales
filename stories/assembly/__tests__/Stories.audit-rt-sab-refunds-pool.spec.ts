// =====================================================================
// Audit Bot fc4: the vault copy opened a 5,000-Ink pool, which the contract now refuses (minimum 10,000), so it never ran; this copy uses 10,000.
// Red-team (Saboteur) tests, SwarmTales fix check @ 00eec36.
// Can another wallet make a writer's remove or cut abort on the
// SafeMath.sub in applyRefund / settleRefund (contributorTotals underflow),
// or make the writer's edits always fail through max_ink?
// RT-SAB-R1/R2/R3 are regression checks expected to PASS: each FAILS if the
// saboteur's sequence locks the writer out of removing or cutting their part.
// Copy into stories/assembly/__tests__/ and run with as-pect.
// =====================================================================
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, MALLORY, STORIES, PRIVATE, COPYRIGHT,
  reset, configure, openAs, openPublic, invite, write, revise, ownerEdit, ownerRemove, segment, story,
  authorize, allowCalls, checkpoint, results, writerMonth, okCall,
} from "./auditFixHelpers";

let ID: u64 = 0;
let SEQ: u64 = 0;
let TEXT: string = "";
let MAXINK: u64 = 0;

const BOB_40 = "Bob writes a short scene in the harbour.";
const BOB_60 = "Bob writes a short scene in the harbour, gulls overhead now.";
const CUT_15 = "Bob writes a sh";
const BOB_30 = "Bob writes a short scene again";
const SPAM = " and Mallory adds a long tail of words to this part that Bob never wrote at all";

function contributorTotal(id: u64, who: Uint8Array): u64 {
  return new Stories().get_contributor_total(new stories.get_contributor_total_arguments(id, who)).value;
}

function adminHide(id: u64, seq: u64): void {
  authorize(STORIES);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, seq, true, COPYRIGHT, "checking"));
  checkpoint();
}

describe("RT-SAB-R1: pool part, writer growth, a cut by someone else, then an admin-hidden removal", () => {
  beforeEach(() => { reset(); configure(); });

  it("no step aborts and the writer's total ends at zero", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    invite(id, CARA, true);
    const seq = write(BOB, id, BOB_40);              // pool pays 40
    expect(segment(id, seq).fund_paid).toBe(true);
    ownerEdit(BOB, id, seq, BOB_60);                 // Bob pays 20 (own_paid 20)
    revise(CARA, id, seq, CUT_15);                   // refund 45: 20 to Bob, 25 to the pool
    expect(segment(id, seq).charged).toBe(15);
    ownerEdit(BOB, id, seq, BOB_30);                 // Bob pays 15 more
    expect(contributorTotal(id, BOB)).toBe(segment(id, seq).charged);
    adminHide(id, seq);
    ID = id; SEQ = seq;
    expect(() => { ownerRemove(BOB, ID, SEQ); }).not.toThrow(
      "RT-SAB-R1: the writer's removal of an admin-hidden part aborted (dropTotal / settleRefund underflow)");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
    expect(contributorTotal(id, BOB)).toBe(0);
  });

  it("a paid removal of a pool part after the writer's growth does not abort", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    invite(id, CARA, true);
    const seq = write(BOB, id, BOB_40);
    ownerEdit(BOB, id, seq, BOB_60);
    revise(CARA, id, seq, CUT_15);
    ID = id; SEQ = seq;
    expect(() => { revise(CARA, ID, SEQ, ""); }).not.toThrow(
      "RT-SAB-R1: a paid removal of a pool part aborted on the writer's total");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
    expect(story(id).total_refunded <= story(id).total_burned).toBe(true);
  });
});

describe("RT-SAB-R2: someone else grows the part, then the writer cuts and removes it", () => {
  beforeEach(() => { reset(); configure(); });

  it("the writer's cut and removal both succeed", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_40);
    revise(MALLORY, id, seq, BOB_40 + SPAM);         // Mallory pays; charged stays 40
    expect(segment(id, seq).charged).toBe(40);
    ID = id; SEQ = seq;
    TEXT = "Bob only";
    expect(() => { ownerEdit(BOB, ID, SEQ, TEXT); }).not.toThrow("RT-SAB-R2: the writer's cut aborted");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    expect(segment(id, seq).text).toBe("Bob only");
    expect(() => { ownerRemove(BOB, ID, SEQ); }).not.toThrow("RT-SAB-R2: the writer's removal aborted");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
  });
});

// max_ink: the writer agrees to a growth price; a saboteur who shortens the
// part first makes that exact edit cost more and fail. The writer reloads and
// pays the new price, or rewords for free. Each shortening costs the saboteur
// a doubling paid change (59 at most), so it cannot lock the writer out.
describe("RT-SAB-R3: max_ink cannot lock the writer out", () => {
  beforeEach(() => { reset(); configure(); });

  it("after a saboteur's cut, the writer's re-priced edit and a free rewording both work", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_40);
    revise(MALLORY, id, seq, "Bob writes a short scene");  // cut 16
    // The writer's page still shows the old 40-letter part: growth 20 agreed.
    ID = id; SEQ = seq; TEXT = BOB_60; MAXINK = 20;
    expect(() => {
      authorize(BOB);
      results([writerMonth(), okCall()]);
      new Stories().edit_segment(new stories.edit_segment_arguments(BOB, ID, SEQ, TEXT, <u64>TEXT.length, MAXINK));
    }).toThrow("max_ink must refuse an edit that now costs more");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    ownerEdit(BOB, id, seq, BOB_60);                         // re-priced: 36
    expect(segment(id, seq).text).toBe(BOB_60, "RT-SAB-R3: the writer could not edit at the new price");
    authorize(BOB);
    new Stories().edit_segment(new stories.edit_segment_arguments(BOB, id, seq,
      "Bob writes a short scene in the harbour, gulls overhead now!", 60, 0));
    checkpoint();
    expect(segment(id, seq).text).toBe("Bob writes a short scene in the harbour, gulls overhead now!",
      "RT-SAB-R3: a free rewording with max_ink 0 was refused");
  });
});
