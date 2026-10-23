// Audit Bot red-team (Thief) attack test, SwarmTales branch audit-fixes-2 @ e5255c6.
// Three ways to get Ink back without paying for it, each asserting the SAFE behaviour
// (a test FAILS if the attack works):
//  1. CUT-THEN-REGROW IN THE FINAL EDIT: the writer cuts their part while the story is open
//     (the cut is refunded), then the final edit regrows it to the original text. The final
//     edit's limit (newCost <= charged + allowance) must use what is still paid for.
//  2. POOL CYCLE: archive (pool back to the opener) -> revive -> the writer removes a pool-paid
//     part -> archive again. The opener never gets back more than they put in, and the
//     writer never gets the pool's share of their part.
//  3. TAKEDOWN THEN REFUND: after a takedown the writer cannot remove or edit the part to
//     get its Ink back.
// Copied into stories/assembly/__tests__/ at run time.
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, DAY, PRIVATE, START, USDT, allowCalls, authorize, burnsFrom, checkpoint, configure, invite,
  mintsTo, openAs, openPublic, ownerEdit, ownerRemove, reset, segment, setTime, story, takedown, write,
} from "./auditFixHelpers";
import { ownEditArgs } from "./reviewed";

function aliceWrites(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);   // the opener needs no Writer month: only the burn
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}
function keep(seq: u64): stories.final_item {
  return new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0);
}

let gId: u64 = 0;
let gSeq: u64 = 0;
let gText: string = "";
function finalRegrow(): void {
  authorize(ALICE);
  allowCalls(2);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, gId, [
    keep(1), new stories.final_item(gSeq, stories.final_mode.FINAL_EDITED, gText, <u64>gText.length),
  ]));
}
function writerRemoves(): void {
  authorize(BOB);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(BOB, gId, gSeq));
}
function writerEdits(): void {
  authorize(BOB);
  allowCalls(2);
  new Stories().edit_segment(ownEditArgs(BOB, gId, gSeq, gText, <u64>gText.length));
}

describe("RT-THIEF cycle: Ink back without paying", () => {
  beforeEach(() => { reset(); configure(); });

  it("1: the final edit can't regrow for free the letters a cut already refunded", () => {
    const id = openPublic();                                  // seq 1: 17 letters
    const original = "b".repeat(200);
    const seq = write(BOB, id, original);                     // Bob burns 200
    ownerEdit(BOB, id, seq, "b".repeat(20));                  // cut: 180 refunded
    expect(mintsTo(BOB)).toBe(180);
    aliceWrites(id, "a".repeat(2000));
    aliceWrites(id, "c".repeat(2000));
    aliceWrites(id, "d".repeat(2000));
    aliceWrites(id, "e".repeat(2000));
    aliceWrites(id, "f".repeat(10000 - 37 - 8000));           // story locks at 10,000
    expect(story(id).status).toBe(stories.story_status.STATUS_LOCKED);
    authorize(ALICE);
    new Stories().close_story(new stories.close_story_arguments(ALICE, id));
    checkpoint();

    gId = id;
    gSeq = seq;
    gText = original;                                         // back to the full 200 letters
    expect(() => { finalRegrow(); }).toThrow("RT-THIEF finalcut: the final edit restored 180 refunded letters for free");
    MockVM.rollbackTransaction();
    expect(segment(id, seq).current_cost).toBe(20);
    expect(mintsTo(BOB) <= burnsFrom(BOB)).toBe(true, "RT-THIEF finalcut: Bob was minted more Ink than he burned");
  });

  it("2: archive, revive, remove a pool-paid part, archive again: nobody gets back more than they paid", () => {
    const id = openAs(PRIVATE, 10000);                        // Alice burns 17 + 10,000 into the pool
    invite(id, BOB, true);
    const seq = write(BOB, id, "b".repeat(100));              // paid by the pool
    expect(story(id).fund).toBe(9900);
    ownerEdit(BOB, id, seq, "b".repeat(150));                 // Bob pays 50 himself (own_paid)
    expect(burnsFrom(BOB)).toBe(50);

    setTime(START + 61 * DAY);
    allowCalls(1);
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(id));
    checkpoint();
    expect(mintsTo(ALICE)).toBe(9900);

    authorize(ALICE);
    new Stories().revive(new stories.revive_arguments(ALICE, id));
    checkpoint();
    ownerRemove(BOB, id, seq);                                // 150 back: 50 to Bob, 100 to the pool

    setTime(START + 122 * DAY);
    allowCalls(1);
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(id));
    checkpoint();

    expect(mintsTo(BOB)).toBe(50, "RT-THIEF poolcycle: Bob got the pool's share of his removed part");
    expect(mintsTo(ALICE) <= 10000).toBe(true, "RT-THIEF poolcycle: the opener got more back than the pool held");
    const st = story(id);
    expect(st.total_refunded <= st.total_burned).toBe(true, "RT-THIEF poolcycle: refunds passed the Ink burned");
    expect(st.fund).toBe(0);
  });

  it("3: after a takedown the writer can't remove or edit the part to get its Ink back", () => {
    const id = openPublic();
    const seq = write(BOB, id, "b".repeat(200));
    ownerEdit(BOB, id, seq, "b".repeat(100));                 // 100 refunded, 100 still paid
    takedown(id, seq, BOB);
    gId = id;
    gSeq = seq;
    expect(() => { writerRemoves(); }).toThrow("RT-THIEF takedown: the writer removed a taken-down part for a refund");
    MockVM.rollbackTransaction();
    gText = "b".repeat(5);
    expect(() => { writerEdits(); }).toThrow("RT-THIEF takedown: the writer edited a taken-down part for a refund");
    MockVM.rollbackTransaction();
    expect(mintsTo(BOB)).toBe(100, "RT-THIEF takedown: Ink came back after the takedown");
  });
});
