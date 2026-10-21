// Audit Bot attack test for AB-044 (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack (inverse of the AB-035 fix): any wallet that may write in the story pays the 20-Ink
// minimum for a one-letter change to Bob's part. From then on Bob's own cuts refund nothing,
// and growing back charges him again for letters he already paid for.
// Asserts the SAFE behaviour (Bob never pays for more letters than his part holds, unless he
// removes it): FAILS on the current code (proof), PASSES once cuts after a change are handled.
import {
  BOB, CARA, burnsFrom, configure, mintsTo, openPublic, ownerEdit, reset, revise, segment, write,
} from "./auditFixHelpers";

function chars(n: i32, c: string = "a"): string { return c.repeat(n); }

describe("AUDIT AB-044: one paid change freezes the writer's cut refunds", () => {
  beforeEach(() => { reset(); configure(); });

  it("Bob trims and regrows his own part after a one-letter change by someone else", () => {
    const id = openPublic();
    const seq = write(BOB, id, chars(100));                 // Bob pays 100
    revise(CARA, id, seq, chars(99) + "b");                 // Cara: 1 letter, 20 Ink
    ownerEdit(BOB, id, seq, chars(10, "c"));                // Bob trims to 10
    // Repo note: the audit's line here was `expect(mintsTo(BOB)).toBe(0)`, which encodes the
    // other fix the report offered (free regrowth up to `charged`). The owner chose "a cut
    // refunds only Ink the writer paid, also after someone else's change", so the trim returns
    // the 90 letters Bob paid for and no more. The assertions below are unchanged.
    expect(mintsTo(BOB)).toBe(90, "AB-044: Bob's trim should return exactly the 90 letters he paid for");
    ownerEdit(BOB, id, seq, chars(100, "d"));               // Bob grows back: pays 90 again
    const net = burnsFrom(BOB) - mintsTo(BOB);
    const has = segment(id, seq).current_cost;
    expect(segment(id, seq).charged).toBe(has,
      "AB-044: Bob's part holds " + has.toString() + " letters but he has paid for " + segment(id, seq).charged.toString());
    expect(net <= has).toBe(true, "AB-044: Bob paid " + net.toString() + " Ink net for a " + has.toString() + "-letter part");
  });
});
