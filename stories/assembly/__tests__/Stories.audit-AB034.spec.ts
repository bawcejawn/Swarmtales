// Audit Bot attack test for AB-034 (Swarmtales main @ 42f6af9).
// Attack: the story summary (1,500 characters, shown on the story page) sits outside
// moderation: it works while paused, a writer removed from a private story keeps the
// right to rewrite it, and the admin has no way to clear it.
// Asserts the SAFE behaviour: FAILS before the fix (proof), PASSES after (regression test).
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, PRIVATE, STORIES, authorize, checkpoint, configure, invite, openAs, openPublic, reset, story, write,
} from "./auditFixHelpers";

let ID: u64 = 0;
let WHO: Uint8Array = new Uint8Array(0);
function setSummary(): void {
  authorize(WHO);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(WHO, ID, "Defaced summary text."));
}
function refused(): bool {
  let threw = false;
  expect(() => { setSummary(); }).toThrow();
  threw = true;
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
  return threw;
}

describe("AUDIT AB-034: the story summary is outside pause and moderation", () => {
  beforeEach(() => { reset(); configure(); });

  it("pause stops summary changes", () => {
    ID = openPublic();
    WHO = ALICE;
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    expect(() => { setSummary(); }).toThrow("AB-034: the summary changed while the contract was paused");
  });

  it("a writer removed from a private story can no longer rewrite its summary", () => {
    ID = openAs(PRIVATE, 10000); // a private story needs a pool of at least 10,000
    invite(ID, BOB, true);
    write(BOB, ID, "Bob writes one part while invited.");
    invite(ID, BOB, false);
    WHO = BOB;
    expect(() => { setSummary(); }).toThrow("AB-034: a writer removed from the story rewrote its summary");
  });

  it("the admin can clear an abusive summary", () => {
    ID = openPublic();
    WHO = ALICE;
    setSummary();
    checkpoint();
    WHO = STORIES; // the admin (the contract's own account until set_admin)
    expect(() => {
      authorize(STORIES);
      new Stories().set_story_summary(new stories.set_story_summary_arguments(STORIES, ID, ""));
    }).not.toThrow("AB-034: the admin has no way to clear a story summary");
    expect(story(ID).summary!.length).toBe(0);
  });
});
