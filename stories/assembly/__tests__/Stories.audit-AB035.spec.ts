// Audit Bot attack test for AB-035 (Swarmtales main @ 42f6af9).
// Attack: Cara pays to add words to Bob's part; then someone cuts exactly Cara's words.
// revise_part refunds min(removed, charged) to the part's writer, so Bob is paid back for
// letters he never paid for while all of his own text stays. In an invite-only story the
// pool pays both changes, so the writer turns the opener's pool into personal Ink.
// Asserts the SAFE behaviour: FAILS before the fix (proof), PASSES after (regression test).
import {
  BOB, CARA, MALLORY, PRIVATE, configure, invite, mintsTo, openAs, openPublic, reset, revise, segment, story, write,
} from "./auditFixHelpers";

const BOBS = "Bob wrote every one of these words himself.";
const ADDED = " Cara paid to add this sentence.";

describe("AUDIT AB-035: refunds for removed letters go to the writer even when someone else paid for them", () => {
  beforeEach(() => { reset(); configure(); });

  it("public story: cutting another changer's added words refunds nothing to the writer", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOBS);
    revise(CARA, id, seq, BOBS + ADDED);
    const before = mintsTo(BOB);
    revise(MALLORY, id, seq, BOBS);
    expect(segment(id, seq).text!).toBe(BOBS);
    expect(mintsTo(BOB) - before).toBe(0, "AB-035: Bob was refunded for letters Cara paid for, and his own text is all still there");
    expect(segment(id, seq).charged).toBe(<u64>BOBS.length, "AB-035: Bob's paid-for text is now marked as unpaid");
  });

  // Updated for rules 1 and 3: the pool never pays for revise_part, and the
  // writer can't revise their own part. The add-then-cut is done by two other
  // invited writers; neither the writer nor the pool may gain from it.
  it("invite-only story: an add-then-cut by others neither refunds the writer nor touches the pool", () => {
    const id = openAs(PRIVATE, 10000);
    invite(id, BOB, true);
    invite(id, CARA, true);
    invite(id, MALLORY, true);
    const seq = write(BOB, id, BOBS); // the pool pays for Bob's new part
    const pool = story(id).fund;
    const before = mintsTo(BOB);
    revise(CARA, id, seq, BOBS + ADDED);
    revise(MALLORY, id, seq, BOBS);
    expect(segment(id, seq).text!).toBe(BOBS);
    expect(mintsTo(BOB) - before).toBe(0, "AB-035: the writer was minted Ink for letters someone else paid for");
    expect(story(id).fund).toBe(pool, "AB-035: the opener's pool paid for changes or was refunded for them");
    expect(segment(id, seq).charged).toBe(<u64>BOBS.length);
  });
});
