// Audit Bot attack test (Swarmtales, branch audit-fixes-2 @ e5255c6): rule 3 and the AB-035/AB-040 fixes.
// Attack: try to earn Ink, or move pool Ink to a writer, with the writer's own free edits:
// shrink-then-regrow, rewording, edits split into many small steps, and a sock wallet's paid change.
// Asserts the SAFE behaviour: no wallet is ever minted more than it burned, and the pool never
// ends above what the opener put in. Fails if a loophole exists, passes if none does.
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, PRIVATE, burnsFrom, configure, invite, mintsTo, openAs, openPublic, ownerEdit, ownerRemove,
  reset, revise, segment, story, write,
} from "./auditFixHelpers";

function chars(n: i32, c: string = "a"): string { return c.repeat(n); }

// Mints to `who` never exceed what `who` burned.
function noProfit(who: Uint8Array, label: string): void {
  expect(mintsTo(who) <= burnsFrom(who)).toBe(true, label + ": minted " + mintsTo(who).toString() + " > burned " + burnsFrom(who).toString());
}

describe("AUDIT rule 3: no Ink from the writer's own edits", () => {
  beforeEach(() => { reset(); configure(); });

  it("public story: shrink then regrow, five times, earns nothing", () => {
    const id = openPublic();
    const seq = write(BOB, id, chars(100));
    for (let i = 0; i < 5; i++) {
      ownerEdit(BOB, id, seq, chars(10, i % 2 == 0 ? "b" : "c"));
      ownerEdit(BOB, id, seq, chars(100, i % 2 == 0 ? "d" : "e"));
      noProfit(BOB, "shrink/regrow round " + i.toString());
    }
    expect(burnsFrom(BOB) - mintsTo(BOB)).toBe(100, "Bob's net spend should equal the 100 letters he has");
    ownerRemove(BOB, id, seq);
    expect(burnsFrom(BOB) - mintsTo(BOB)).toBe(0);
    expect(story(id).total_refunded <= story(id).total_burned).toBe(true);
  });

  it("public story: many one-letter growths then one cut, and the reverse, earn nothing", () => {
    const id = openPublic();
    const seq = write(BOB, id, chars(50));
    for (let n = 51; n <= 60; n++) ownerEdit(BOB, id, seq, chars(n, n % 2 == 0 ? "x" : "y"));
    ownerEdit(BOB, id, seq, chars(20, "z"));
    for (let n = 19; n >= 10; n--) ownerEdit(BOB, id, seq, chars(n, n % 2 == 0 ? "p" : "q"));
    noProfit(BOB, "split edits");
    expect(burnsFrom(BOB) - mintsTo(BOB)).toBe(<u64>segment(id, seq).current_cost);
  });

  it("pool story: rewording, regrowing and cutting never moves pool Ink to the writer", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    const pool0 = story(id).fund;
    const seq = write(BOB, id, chars(100));            // pool pays 100
    expect(segment(id, seq).fund_paid).toBe(true);
    ownerEdit(BOB, id, seq, chars(100, "r"));          // free reword
    ownerEdit(BOB, id, seq, chars(10, "s"));           // cut 90: back to the pool
    ownerEdit(BOB, id, seq, chars(300, "t"));          // Bob pays 290
    ownerEdit(BOB, id, seq, chars(5, "u"));            // cut 295: Bob gets <= 290 back
    ownerEdit(BOB, id, seq, chars(200, "v"));          // Bob pays 195
    noProfit(BOB, "pool part edits");
    ownerRemove(BOB, id, seq);
    noProfit(BOB, "pool part removal");
    expect(story(id).fund).toBe(pool0, "the pool should be whole again after the part is removed");
    expect(burnsFrom(BOB)).toBe(mintsTo(BOB), "Bob should get back exactly what he paid himself");
  });

  it("sock wallet: a first paid change that cuts, then the writer regrows and removes, earns the pair nothing", () => {
    const id = openPublic();
    const seq = write(BOB, id, chars(100));
    revise(CARA, id, seq, chars(10));                  // Cara (Bob's sock) cuts 90 as the first change
    ownerEdit(BOB, id, seq, chars(100, "w"));          // Bob regrows
    ownerEdit(BOB, id, seq, chars(10, "k"));           // cut after a change: refunds nothing
    ownerRemove(BOB, id, seq);
    const minted = mintsTo(BOB) + mintsTo(CARA);
    const burned = burnsFrom(BOB) + burnsFrom(CARA);
    expect(minted <= burned).toBe(true, "Bob + sock minted more than they burned");
    noProfit(BOB, "writer alone");
  });

  it("pool + sock: the writer's own growth is cut by a sock; the pool is not drained into the writer", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    invite(id, CARA, true);
    const pool0 = story(id).fund;
    const seq = write(BOB, id, chars(100));            // pool pays 100
    ownerEdit(BOB, id, seq, chars(600, "g"));          // Bob pays 500 (own_paid 500)
    revise(CARA, id, seq, chars(100, "g"));            // sock cuts 500: first change, cut refund
    ownerRemove(BOB, id, seq);
    noProfit(BOB, "pool + sock");
    expect(story(id).fund <= pool0).toBe(true, "pool above what the opener put in");
    expect(story(id).fund).toBe(pool0, "pool lost Ink to the writer");
  });
});
