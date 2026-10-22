// =====================================================================
// Red-team (Saboteur) attack test, SwarmTales fix check @ 00eec36.
// RT-SAB-C1: partChangers (space 29, get_changers) is said to be bounded:
// "changers other than the opener, editors and the finalizer each made a
// paid change" (Stories.ts ~line 281), i.e. at most paid_changes + opener +
// MAX_EDITORS (10) + the admin finalizer. But editors rotate: the opener
// adds an editor, the editor sets a citation on someone else's part
// (set_citation records them as a changer, any status but FINALIZED), the
// opener removes the editor and adds the next one. Every rotation adds a
// wallet to the writer's changer list for the price of three transactions'
// mana, with no Ink and no paid change. The list grows without limit: every
// takedown of the part lists dozens or thousands of strike candidates (the
// deploy.js takedown tool prints get_changers), each new recordChanger reads
// and rewrites the whole list (an admin finalizer's first FINAL_EDITED on
// the part pays for it), and get_changers eventually exceeds read limits.
// Asserts the SAFE behaviour (the documented bound): FAILS while the attack works.
// Copy into stories/assembly/__tests__/ and run with as-pect.
// =====================================================================
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, MALLORY,
  reset, configure, openPublic, write, segment, authorize, checkpoint,
} from "./auditFixHelpers";

const BOB_TEXT = "Bob writes a short scene in the harbour.";
const ROTATIONS: i32 = 25;
const MAX_EDITORS: i32 = 10;

// A distinct 25-byte wallet per index (the contract only checks the length).
function wallet(i: i32): Uint8Array {
  const w = new Uint8Array(25);
  for (let j = 0; j < 25; j++) w[j] = MALLORY[j];
  w[3] = <u8>(i + 1);
  w[4] = 0x5a;
  return w;
}

function setEditor(id: u64, who: Uint8Array, allowed: bool): void {
  authorize(ALICE);
  new Stories().set_editor(new stories.set_editor_arguments(ALICE, id, who, allowed));
  checkpoint();
}

describe("RT-SAB-C1: editor rotation grows a writer's changer list without limit", () => {
  beforeEach(() => { reset(); configure(); });

  it("get_changers stays within paid changes + opener + 10 editors + finalizer", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    for (let i = 0; i < ROTATIONS; i++) {
      const w = wallet(i);
      setEditor(id, w, true);
      authorize(w);
      new Stories().set_citation(new stories.set_citation_arguments(w, id, seq, "Quoted from source number " + i.toString()));
      checkpoint();
      setEditor(id, w, false);
    }
    const s = segment(id, seq);
    expect(s.paid_changes).toBe(0);
    const count = new Stories().get_changers(new stories.get_changers_arguments(id, seq)).values.length;
    const bound = <i32>s.paid_changes + 1 + MAX_EDITORS + 1;
    expect(count <= bound).toBe(true,
      "RT-SAB-C1: " + count.toString() + " changers recorded on Bob's part with no paid change (bound " + bound.toString() +
      "): the opener rotates editors who each set a citation");
  });
});
