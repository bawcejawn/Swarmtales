// Audit Bot attack test for AB-036 (Swarmtales main @ 42f6af9).
// Attack: a wallet blocked under the repeat-infringer policy keeps changing text with
// edit_segment (no block check), including rewriting a part the moderator has hidden.
// Asserts the SAFE behaviour: FAILS before the fix (proof), PASSES after (regression test).
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, openPublic, reset, write,
} from "./auditFixHelpers";
import { ownEditArgs } from "./reviewed";

let ID: u64 = 0;
let SEQ: u64 = 0;
function editAsBob(): void {
  const text = "Bob swaps the words for something else.";
  authorize(BOB);
  allowCalls(1);
  new Stories().edit_segment(ownEditArgs(BOB, ID, SEQ, text, <u64>text.length));
}

describe("AUDIT AB-036: blocked wallets and hidden parts can still be edited", () => {
  beforeEach(() => { reset(); configure(); });

  it("a blocked wallet cannot edit its parts", () => {
    ID = openPublic();
    SEQ = write(BOB, ID, "Bob writes a part of forty letters ok.");
    authorize(STORIES);
    new Stories().set_blocked(new stories.set_blocked_arguments(BOB, true, "repeat infringer"));
    checkpoint();
    expect(() => { editAsBob(); }).toThrow("AB-036: a blocked wallet changed its text");
  });

  it("a part hidden by the admin for copyright cannot be rewritten by its writer before review", () => {
    ID = openPublic();
    SEQ = write(BOB, ID, "Bob writes a part of forty letters ok.");
    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, ID, SEQ, true, COPYRIGHT, "notice"));
    checkpoint();
    expect(() => { editAsBob(); }).toThrow("AB-036: the writer rewrote a part hidden for review, replacing the evidence");
  });
});
