// Audit Bot attack test for AB-047 (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack (new surface from the AB-033 fix): every free edit by the writer is now a version, and
// paid changes stop at MAX_VERSIONS - 2 = 98 kept versions. A writer makes 97 free one-letter
// edits to their own part; after that nobody (not even the opener of a private story) can change
// it with revise_part, although it has had no paid change at all (the 60-change limit is untouched).
// Asserts the SAFE behaviour: FAILS on the current code (proof), PASSES once free edits can't use
// up the room paid changes need.
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, CARA, authorize, changePrice, configure, okCall, openPublic, ownerEdit, reset, results, segment, write, writerMonth,
} from "./auditFixHelpers";

let gId: u64 = 0;
let gSeq: u64 = 0;
function caraChanges(): void {
  const s = segment(gId, gSeq);
  const text = s.text! + " Cara.";
  authorize(CARA);
  results([writerMonth(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(CARA, gId, gSeq, text, changePrice(s.text!, text, s.paid_changes), true, 0, "", false));
}

describe("AUDIT AB-047: free edits use up the versions paid changes need", () => {
  beforeEach(() => { reset(); configure(); });

  it("lets others change a part that has had no paid change, after the writer's free edits", () => {
    const id = openPublic();
    const base = "Bob's part that he keeps touching up, again and again: ";
    const seq = write(BOB, id, base + "A");
    const letters = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < 97; i++) ownerEdit(BOB, id, seq, base + letters.charAt(i % 25) + (i % 2 == 0 ? "x" : "y"));
    expect(segment(id, seq).paid_changes).toBe(0);
    expect(segment(id, seq).version_count).toBe(98);
    gId = id; gSeq = seq;
    expect(caraChanges).not.toThrow("AB-047: the writer's free edits blocked every paid change to the part");
  });
});
