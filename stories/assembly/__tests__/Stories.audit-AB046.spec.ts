// Audit Bot attack test for AB-046 (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack (cheap bypass of the AB-036 fix): a wallet blocked under the repeat-infringer policy can
// no longer edit, but set_citation has no block check. The blocked writer (or a blocked opener,
// on every part of their story) keeps putting up to 200 characters of visible text under parts.
// Asserts the SAFE behaviour: FAILS on the current code (proof), PASSES once fixed.
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, STORIES, authorize, checkpoint, configure, openPublic, reset, segment, write,
} from "./auditFixHelpers";

let gId: u64 = 0;
let gSeq: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);
function blockedCites(): void {
  authorize(gWho);
  new Stories().set_citation(new stories.set_citation_arguments(gWho, gId, gSeq, "Anything a blocked wallet wants shown here"));
}
function block(who: Uint8Array): void {
  authorize(STORIES);
  new Stories().set_blocked(new stories.set_blocked_arguments(who, true, "repeat infringer"));
  checkpoint();
}

describe("AUDIT AB-046: blocked wallets can still set citations", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses a citation from a blocked writer on their own part", () => {
    const id = openPublic();
    const seq = write(BOB, id, "Bob wrote this part before he was blocked.");
    block(BOB);
    gId = id; gSeq = seq; gWho = BOB;
    expect(blockedCites).toThrow("AB-046: a blocked writer set a citation");
    MockVM.rollbackTransaction();
    expect(segment(id, seq).citation).toBe("");
  });

  it("refuses a citation from a blocked opener on someone else's part", () => {
    const id = openPublic();
    const seq = write(BOB, id, "Bob's part, in Alice's story.");
    block(ALICE);
    gId = id; gSeq = seq; gWho = ALICE;
    expect(blockedCites).toThrow("AB-046: a blocked opener set a citation on Bob's part");
    MockVM.rollbackTransaction();
    expect(segment(id, seq).citation).toBe("");
  });
});
