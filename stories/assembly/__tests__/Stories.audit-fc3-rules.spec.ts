// Audit Bot fix-check tests (Swarmtales, branch audit-fixes-2 @ 00eec36). Copy into stories/assembly/__tests__/.
// Five sides of AB-050 (Stories half), AB-053 and AB-044, plus question 5 (a changer's total).
// Each `it` asserts the SAFE behaviour.
//   setonce-*   expected PASS (the fix holds)
//   cut-*       expected PASS (no refund above what the writer paid)
//   modunhide   probe: the moderator (copy checker key) unhiding a part the ADMIN hid
//   changer-total probe: a changer whose added letters are removed with the part
import { Base58, MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, INK, MALLORY, PRIVATE, SHOP, STORIES, COPYRIGHT, allowCalls, authorize, burnsFrom, checkpoint, configure,
  invite, mintsTo, openAs, openPublic, ownerEdit, ownerRemove, reset, revise, segment, story, write,
} from "./auditFixHelpers";

const OTHER = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");   // a 25-byte address (Mallory's)
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt");     // moderator = copy checker
let gId: u64 = 0;
let gSeq: u64 = 0;
function chars(n: i32, c: string = "a"): string { return c.repeat(n); }

function swapShop(): void { authorize(STORIES); new Stories().set_addresses(new stories.set_addresses_arguments(INK, OTHER)); }
function swapInk(): void { authorize(STORIES); new Stories().set_addresses(new stories.set_addresses_arguments(OTHER, SHOP)); }
function botUnhide(): void {
  authorize(BOT);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, false, stories.moderation_reason.REASON_UNSPECIFIED, "source cited"));
}
function caraSummary(): void {
  authorize(CARA);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(CARA, gId, "Cara rewrites the summary."));
}

describe("AUDIT fix check 3: set-once addresses, cuts, unhide, changer totals", () => {
  beforeEach(() => { reset(); configure(); });

  it("setonce-shop: the admin can't re-point Stories' Shop (AB-050)", () => {
    expect(swapShop).toThrow("AB-050: Stories' Shop was changed after it was set");
    MockVM.rollbackTransaction();
  });

  it("setonce-ink: the admin can't re-point Stories' Ink (AB-037)", () => {
    expect(swapInk).toThrow("AB-037: Stories' Ink was changed after it was set");
    MockVM.rollbackTransaction();
  });

  it("setonce-legit: setting the same addresses again still works", () => {
    authorize(STORIES);
    new Stories().set_addresses(new stories.set_addresses_arguments(INK, SHOP));
    checkpoint();
    expect(true).toBe(true);
  });

  it("cut-others: cutting only the letters someone else added refunds nothing; cutting the writer's own refunds them", () => {
    const id = openPublic();
    const seq = write(BOB, id, chars(100));                 // Bob pays 100
    revise(CARA, id, seq, chars(100) + chars(100, "c"));     // Cara adds 100
    const m0 = mintsTo(BOB);
    ownerEdit(BOB, id, seq, chars(100));                     // Bob cuts Cara's 100
    expect(mintsTo(BOB) - m0).toBe(0, "AB-044: Bob was refunded for letters Cara paid for");
    ownerEdit(BOB, id, seq, chars(40));                      // Bob cuts 60 of his own
    expect(mintsTo(BOB) - m0).toBe(60, "AB-044: Bob's own cut letters are refunded");
    ownerEdit(BOB, id, seq, chars(100, "d"));                // regrow 60
    ownerRemove(BOB, id, seq);
    expect(mintsTo(BOB) <= burnsFrom(BOB)).toBe(true, "AB-044: Bob got back more than he burned");
    expect(mintsTo(CARA)).toBe(0, "AB-044: the changer was refunded");
  });

  it("cut-sock: a sock wallet's paid cut, then the writer's regrowth and removal, never nets Ink", () => {
    const id = openPublic();
    const seq = write(BOB, id, chars(200));
    revise(MALLORY, id, seq, chars(20));                     // sock cut: Bob refunded 180
    ownerEdit(BOB, id, seq, chars(200, "e"));                // Bob regrows 180
    revise(MALLORY, id, seq, "");                            // sock removes: Bob refunded 200
    const bobNet = <i64>mintsTo(BOB) - <i64>burnsFrom(BOB);
    const sockNet = <i64>mintsTo(MALLORY) - <i64>burnsFrom(MALLORY);
    expect(bobNet <= 0).toBe(true, "AB-044: Bob earned Ink");
    expect(bobNet + sockNet < 0).toBe(true, "AB-044: Bob and his sock together earned Ink");
  });

  it("cut-pool: in a pool-paid part, a cut after someone else's change pays the writer only what they paid", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true); invite(id, CARA, true);
    const seq = write(BOB, id, chars(100));                  // the pool pays 100
    expect(segment(id, seq).fund_paid).toBe(true);
    ownerEdit(BOB, id, seq, chars(150));                     // Bob pays 50 (own_paid 50)
    revise(CARA, id, seq, chars(150) + "z");                 // Cara changes it
    const fund0 = story(id).fund;
    const m0 = mintsTo(BOB);
    ownerEdit(BOB, id, seq, chars(20));                      // cut 130 of 150 paid
    expect(mintsTo(BOB) - m0).toBe(50, "AB-044: Bob should get back his own 50, no more");
    expect(story(id).fund - fund0).toBe(80, "the pool gets its 80 back");
  });

  it("modunhide: the moderator (copy checker key) can't unhide a part the admin hid (AB-053)", () => {
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    gSeq = write(BOB, gId, "A page Bob copied from somebody else's novel.");
    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, gId, gSeq, true, COPYRIGHT, "notice 2026-031"));
    checkpoint();
    expect(segment(gId, gSeq).hidden_by).toBe(3);
    expect(botUnhide).toThrow("AB-053: the copy checker's key undid the admin's hide");
    MockVM.rollbackTransaction();
    expect(segment(gId, gSeq).hidden).toBe(true);
  });

  it("changer-total: a changer whose letters went with a removed part is no longer a current writer", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, chars(100));
    revise(CARA, gId, gSeq, chars(100) + chars(50, "c"));    // Cara adds 50: her total is 50
    ownerRemove(BOB, gId, gSeq);                             // Bob removes the part: Cara's letters are gone
    // Changed by the fixer: the owner chose the report's other fix (AB-066), "a current
    // writer owns a live part", so Cara's Ink total (what she paid in) stays 50 on purpose.
    // The summary right, the only thing the total decided, is what this test checks.
    expect(caraSummary).toThrow("Q5: Cara still has summary rights in a story where none of her writing remains");
    MockVM.rollbackTransaction();
  });
});
