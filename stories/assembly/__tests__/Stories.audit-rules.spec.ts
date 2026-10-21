// The rules decided after the October 2026 fix check (audit-fixes-2):
//   1. A private story's pool pays only for new text (contribute), never for
//      revise_part; the person making the change always pays.
//   2. Changing someone else's part keeps its price: 2x the letters added and
//      removed, at least 10, doubling with each paid change.
//   3. A writer's own part (edit_segment): rewording is free, letters beyond the
//      current length cost the normal rate, shortening is always allowed and
//      refunds only Ink the writer (or the pool) paid; once someone else changed
//      the part, a cut refunds nothing (removing it still does). A writer never
//      uses revise_part on their own part.
//   4. The Ink address can be set once and never changed.
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { MockVM } from "@koinos/sdk-as";
import {
  ALICE, BOB, CARA, INK, MALLORY, PRIVATE, SHOP, STORIES, USDT, authorize, burnsFrom, changePrice, checkpoint, configure,
  invite, mintsTo, openAs, openPublic, ownerEdit, ownerRemove, reset, results, revise, segment, story, versions,
  write, writerMonth, okCall,
} from "./auditFixHelpers";

const BOBS = "Bob wrote every one of these words himself.";   // 43
const ADDED = " Cara paid to add this sentence.";               // 32

let fId: u64 = 0;
let fSeq: u64 = 0;
let fWho: Uint8Array = new Uint8Array(0);
let fText = "";
function tryRevise(): void {
  const s = segment(fId, fSeq);
  authorize(fWho);
  results([writerMonth(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(
    fWho, fId, fSeq, fText, changePrice(s.text!, fText, s.paid_changes), true, 0, "", false));
}
function rollback(): void {
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}

describe("Rule 1: the pool pays only for new text", () => {
  beforeEach(() => { reset(); configure(); });

  it("a change to someone else's part is paid by the changer, never by the pool", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    invite(id, CARA, true);
    const seq = write(BOB, id, BOBS);
    expect(segment(id, seq).fund_paid).toBe(true);          // contribute: the pool pays
    const pool = story(id).fund;
    const cara = burnsFrom(CARA);
    revise(CARA, id, seq, BOBS + ADDED);
    expect(story(id).fund).toBe(pool, "the pool paid for a change");
    expect(burnsFrom(CARA) - cara).toBe(<u64>ADDED.length * 2);
  });

  it("letters a writer adds to their own pool-paid part are paid by the writer", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    const seq = write(BOB, id, BOBS);
    const pool = story(id).fund;
    const bob = burnsFrom(BOB);
    ownerEdit(BOB, id, seq, BOBS + " And thirty more letters, ok.");   // +29
    expect(story(id).fund).toBe(pool);
    expect(burnsFrom(BOB) - bob).toBe(29);
    expect(segment(id, seq).own_paid).toBe(29);
  });
});

describe("Rule 2: the change price is unchanged", () => {
  beforeEach(() => { reset(); configure(); });

  it("charges 2x the letters (at least 10), doubling per paid change; the writer's edits don't count", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    const cara = burnsFrom(CARA);
    revise(CARA, id, seq, BOBS + "!");                       // 1 letter -> 10 x 2
    expect(burnsFrom(CARA) - cara).toBe(20);
    ownerEdit(BOB, id, seq, BOBS + "?");                      // free reword, not a paid change
    expect(segment(id, seq).paid_changes).toBe(1);
    const mallory = burnsFrom(MALLORY);
    revise(MALLORY, id, seq, BOBS + "?" + ADDED);              // 32 letters x 4
    expect(burnsFrom(MALLORY) - mallory).toBe(<u64>ADDED.length * 4);
    expect(segment(id, seq).paid_changes).toBe(2);
  });
});

describe("Rule 3: the writer's own part", () => {
  beforeEach(() => { reset(); configure(); });

  it("rewording is free, growth costs the normal rate, shortening refunds exactly", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    const burned = burnsFrom(BOB);
    const minted = mintsTo(BOB);
    ownerEdit(BOB, id, seq, BOBS.replace("Bob", "Rob"));            // same length
    expect(burnsFrom(BOB)).toBe(burned);
    expect(mintsTo(BOB)).toBe(minted);
    ownerEdit(BOB, id, seq, BOBS + " Ten more!");                    // +10
    expect(burnsFrom(BOB) - burned).toBe(10);
    expect(segment(id, seq).charged).toBe(53);
    ownerEdit(BOB, id, seq, "Bob wrote this.");                      // 53 -> 15
    expect(mintsTo(BOB) - minted).toBe(38);
    expect(segment(id, seq).charged).toBe(15);
  });

  it("shortening is always allowed, even after others added more than the old allowance (AB-040)", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    revise(CARA, id, seq, BOBS + ADDED + ADDED);                     // +64, far past any allowance
    const long = segment(id, seq).text!;
    ownerEdit(BOB, id, seq, long.replace("Bob", "Rob"));             // a typo fix at full length
    ownerEdit(BOB, id, seq, "Rob wrote it.");                        // and a big cut
    expect(segment(id, seq).text!).toBe("Rob wrote it.");
  });

  // Updated for AB-044: after someone else's change a cut still refunds the writer, but only
  // what they paid beyond the new length (charged never holds Cara's letters).
  it("after someone else's change, a cut refunds only what the writer paid; removing it refunds the rest", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    revise(CARA, id, seq, BOBS + ADDED);
    const minted = mintsTo(BOB);
    ownerEdit(BOB, id, seq, BOBS + "!");                            // 75 -> 44: Cara's letters, no refund
    expect(mintsTo(BOB)).toBe(minted, "the writer was refunded for letters Cara paid for");
    ownerEdit(BOB, id, seq, "Bob cut it all down.");                 // 44 -> 20
    expect(mintsTo(BOB) - minted).toBe(<u64>BOBS.length - 20, "the writer should get back his own cut letters");
    expect(segment(id, seq).charged).toBe(20);
    ownerRemove(BOB, id, seq);
    expect(mintsTo(BOB) - minted).toBe(<u64>BOBS.length);
    expect(story(id).total_refunded <= story(id).total_burned).toBe(true);
  });

  it("in a pool-paid part, shortening refunds the writer's own paid letters first, then the pool", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    const seq = write(BOB, id, BOBS);                                 // 43 from the pool
    ownerEdit(BOB, id, seq, BOBS + " And thirty more letters, ok.");  // Bob pays 29
    const pool = story(id).fund;
    const minted = mintsTo(BOB);
    ownerEdit(BOB, id, seq, BOBS.substring(0, 33));                   // 72 -> 33: 39 back
    expect(mintsTo(BOB) - minted).toBe(29, "the writer got back more or less than he paid himself");
    expect(story(id).fund - pool).toBe(10);
    expect(segment(id, seq).own_paid).toBe(0);
    expect(segment(id, seq).charged).toBe(33);
  });

  it("a writer can't use revise_part on their own part", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    fId = id; fSeq = seq; fWho = BOB; fText = BOBS + ADDED;
    expect(() => { tryRevise(); }).toThrow();
    rollback();
    expect(segment(id, seq).text!).toBe(BOBS);
  });

  it("every edit is a version naming who made it; past the writer's room the writer still edits and paid changes still fit", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    revise(CARA, id, seq, BOBS + "!");
    for (let i = 0; i < 101; i++) ownerEdit(BOB, id, seq, "Bob edit number " + i.toString() + ".");
    const kept = versions(id, seq);
    expect(kept.length).toBe(99);
    expect(kept[0].kind).toBe(1);
    expect(kept[1].kind).toBe(2);
    expect(kept[98].kind).toBe(4);
    expect(kept[98].text!).toBe(segment(id, seq).text!);
    expect(kept[98].by!).toStrictEqual(BOB);
    // Updated for AB-047: the writer's edits never use up the room paid changes need.
    revise(MALLORY, id, seq, "Mallory's change.");
    const after = versions(id, seq);
    expect(after.length).toBe(100);
    expect(after[99].kind).toBe(2);
    expect(after[99].by!).toStrictEqual(MALLORY);
  });
});

describe("Rule 4: the Ink address is set once (and Shop too, AB-050)", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses a second Ink address and a second Shop address; the same pair is fine", () => {
    authorize(STORIES);
    expect(() => {
      authorize(STORIES);
      new Stories().set_addresses(new stories.set_addresses_arguments(USDT, SHOP));
    }).toThrow();
    rollback();
    expect(() => {
      authorize(STORIES);
      new Stories().set_addresses(new stories.set_addresses_arguments(INK, ALICE));
    }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("STORIES: the Shop address is already set and can never be changed");
    rollback();
    authorize(STORIES);
    new Stories().set_addresses(new stories.set_addresses_arguments(INK, SHOP));
    checkpoint();
    const cfg = new Stories().get_config(new stories.get_config_arguments());
    expect(cfg.ink!).toStrictEqual(INK);
    expect(cfg.shop!).toStrictEqual(SHOP);
  });
});
