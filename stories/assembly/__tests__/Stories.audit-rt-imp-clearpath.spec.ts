// Audit Bot red-team (Impersonator) attack test RT-IMP-CLEARPATH (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack: set_story_summary's new clear path (Stories.ts ~1299:
// `summary.length == 0 && isModeratorOrAdmin(account)` -> requireModeratorOrAdmin) skips the pause,
// status, block and membership checks. Try to ride it in someone else's name:
//   1. a stranger passes account = the admin (empty summary) with only their own signature;
//   2. a stranger passes account = the moderator;
//   3. the admin's own signature, but the call arrives through another contract;
//   4. the moderator tries to WRITE a summary (more than "clear") in a story it has no part in;
//   5. the moderator tries the admin-only takedown;
//   6. a wallet with no part in the story clears the summary (not admin/moderator -> normal path).
// Asserts the SAFE behaviour; expected to PASS (all blocked). Copy into stories/assembly/__tests__/.
import { Base58, MockVM, chain } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, MALLORY, STORIES, COPYRIGHT, authorize, checkpoint, configure, directly, openPublic, reset, story, write,
} from "./auditFixHelpers";
import { reviewedTakedown } from "./reviewed";

const MOD = Base58.decode("1FCjNjhaLnEDSUM3RhoVpfzET8mSaQapiF");
const EVIL_APP = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");
const SUMMARY = "Alice's tale so far: a lantern, a river, a door.";

let gId: u64 = 0;
let gAccount: Uint8Array = new Uint8Array(0);
let gSigner: Uint8Array = new Uint8Array(0);
let gText: string = "";
function summaryCall(): void {
  authorize(gSigner);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(gAccount, gId, gText));
}
function viaEvilApp(): void {
  MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode));
  authorize(STORIES);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(STORIES, gId, ""));
}
function modTakedown(): void {
  authorize(MOD);
  new Stories().takedown_segment(reviewedTakedown(gId, 2, COPYRIGHT, "mod", BOB, false));
}

function setup(): u64 {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(MOD, 3, 5));
  checkpoint();
  const id = openPublic();
  write(BOB, id, "Bob's part of the tale, which the moderator cannot touch.");
  authorize(ALICE);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(ALICE, id, SUMMARY));
  checkpoint();
  gId = id;
  return id;
}
function attempt(account: Uint8Array, signer: Uint8Array, text: string, message: string): void {
  gAccount = account; gSigner = signer; gText = text;
  expect(summaryCall).toThrow(message);
  MockVM.rollbackTransaction();
  directly();
  expect(story(gId).summary).toBe(SUMMARY, message);
}

describe("RT-IMP-CLEARPATH: nobody rides the admin/moderator summary clear path", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses a stranger clearing in the admin's name", () => {
    setup();
    attempt(STORIES, MALLORY, "", "RT-IMP-CLEARPATH: Mallory cleared the summary as the admin");
  });

  it("refuses a stranger clearing in the moderator's name", () => {
    setup();
    attempt(MOD, MALLORY, "", "RT-IMP-CLEARPATH: Mallory cleared the summary as the moderator");
  });

  it("refuses the admin's signature arriving through another contract", () => {
    setup();
    expect(viaEvilApp).toThrow("RT-IMP-CLEARPATH: an app contract cleared the summary in the admin's name");
    MockVM.rollbackTransaction();
    directly();
    expect(story(gId).summary).toBe(SUMMARY);
  });

  it("lets the moderator only clear: writing a summary is refused", () => {
    setup();
    attempt(MOD, MOD, "The moderator's own version of the story.", "RT-IMP-CLEARPATH: the moderator wrote a summary into a story it has no part in");
  });

  it("refuses the moderator a takedown (admin only)", () => {
    setup();
    expect(modTakedown).toThrow("RT-IMP-CLEARPATH: the moderator took a part down and struck its writer");
    MockVM.rollbackTransaction();
  });

  it("refuses an outsider clearing through the normal path", () => {
    setup();
    attempt(MALLORY, MALLORY, "", "RT-IMP-CLEARPATH: a wallet with no part in the story cleared its summary");
  });

  it("the moderator's own clear works and names the moderator, not the opener", () => {
    setup();
    authorize(MOD);
    new Stories().set_story_summary(new stories.set_story_summary_arguments(MOD, gId, ""));
    checkpoint();
    expect(story(gId).summary).toBe("");
    const by = story(gId).summary_by!;
    expect(Base58.encode(by)).toBe(Base58.encode(MOD), "RT-IMP-CLEARPATH: the clear was credited to the wrong wallet");
  });
});
