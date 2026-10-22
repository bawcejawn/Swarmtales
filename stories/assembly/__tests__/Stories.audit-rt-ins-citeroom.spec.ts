// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ d82364b.
// Role: the story's opener.
// Claim (docs/ADMIN_POWERS.md, takedowns): once anyone else changed a part
// ("... or a citation someone else set") the admin "must name who gets the
// strike (the writer or any wallet that changed the part)", and
// `deploy.js takedown` prints "every wallet the contract recorded as changing
// it (citation-only ones too)".
// Code (AB-063, Stories.ts recordChanger ~2069): a citation-only changer is
// recorded only while partChangers.length < paid_changes + 12. The comment
// says the 12 are "the opener, 10 editors and the finalizer", but the opener
// can rotate set_editor freely: she adds a sock editor, the sock sets a
// citation, she removes it, 12 times. The list is full, and HER OWN bogus
// citation (which makes the copy checker treat the copied text as cited,
// "clean") is not recorded: edited_by_others is set, so no automatic strike,
// and the admin can no longer name her: "strike the part's writer or a
// wallet that changed it". get_changers (what deploy.js shows) omits her.
// Asserts the SAFE behaviour (the opener who set a citation is strikable and
// listed). FAILS while the attack works. Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, COPYRIGHT, STORIES, authorize, checkpoint, configure, openPublic, reset, strikes, write,
} from "./auditFixHelpers";

const BASE = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
let gId: u64 = 0;
let gSeq: u64 = 0;

function sock(i: i32): Uint8Array {
  const a = new Uint8Array(BASE.length);
  for (let j = 0; j < BASE.length; j++) a[j] = BASE[j];
  // Fix (audit-fixes-2): the varied bytes are plain ASCII. XOR-ed bytes of 0x80
  // or more made MockVM store every sock under the same key, so only the first
  // sock was ever recorded and the harness line below failed before any fix.
  a[5] = <u8>(0x30 + i);
  a[6] = <u8>0x5a;
  return a;
}
function setEditor(who: Uint8Array, on: bool): void {
  authorize(ALICE);
  new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, who, on));
  checkpoint();
}
function cite(who: Uint8Array, text: string): void {
  authorize(who);
  new Stories().set_citation(new stories.set_citation_arguments(who, gId, gSeq, text));
  checkpoint();
}
function strikeAlice(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(gId, gSeq, COPYRIGHT, "notice 2026-777", ALICE, false));
}
function inList(list: Uint8Array[], who: Uint8Array): bool {
  for (let i = 0; i < list.length; i++) {
    if (list[i].length != who.length) continue;
    let same = true;
    for (let j = 0; j < who.length; j++) if (list[i][j] != who[j]) { same = false; break; }
    if (same) return true;
  }
  return false;
}

describe("RT-INS citeroom: the opener crowds herself out of the changer list with rotating sock editors", () => {
  beforeEach(() => {
    reset(); configure();
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob quotes a long passage from a published novel here, without naming it.");
    for (let i = 0; i < 12; i++) {
      const s = sock(i);
      setEditor(s, true);
      cite(s, "source guess " + i.toString());
      setEditor(s, false);
    }
    // Alice's own (bogus) citation: the checker now skips the quote as cited.
    cite(ALICE, "From The Night Circus by Erin Morgenstern");
  });

  it("the opener who set a citation is still listed as a changer", () => {
    const list = new Stories().get_changers(new stories.get_changers_arguments(gId, gSeq)).values;
    expect(list.length).toBeGreaterThanOrEqual(12, "harness: the 12 sock editors are recorded");
    expect(inList(list, ALICE)).toBe(true,
      "RT-INS citeroom 1: get_changers (what deploy.js takedown prints) leaves out the opener who set the citation");
  });

  it("the admin can strike the opener for her citation", () => {
    expect(strikeAlice).not.toThrow("RT-INS citeroom 2: takedown refuses to strike the opener: her citation was never recorded");
    MockVM.commitTransaction();
    expect(strikes(ALICE)).toBe(1, "RT-INS citeroom 2: the opener got no strike");
  });
});
