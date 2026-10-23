// Audit Bot red-team (Impersonator) attack test RT-IMP-NOOPBLAME (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack ("blamed for a change nobody made"): recordChanger runs even when nothing changes.
//  (a) submit_final_batch FINAL_EDITED with the part's own text unchanged (Stories.ts ~1043:
//      keepVersion is skipped when text == oldText, but recordChanger(key, seg, finalizer) is not).
//      The website sends mode 2 whenever the opener picks "Edit", even if they leave the text alone
//      (web/src/main.js ~3160). Result: the opener becomes a strikable "changer", last_edited_by is the
//      opener, there is NO version showing they changed nothing, and `deploy.js takedown` lists the
//      opener FIRST ("whoever last edited the text comes first") with "live text, last edited by <opener>".
//  (b) set_citation with the citation the part already has: same effect, by an opener or editor.
// Either way the writer's automatic strike is gone (edited_by_others = true), so a writer's alt wallet
// as opener/editor turns every takedown of the writer's parts into a manual call that points at the alt.
// Asserts the SAFE behaviour (a no-op records no changer): FAILS on the current code, PASSES once fixed.
// Copy into stories/assembly/__tests__/. Helpers from ./auditFixHelpers; chars() and the close setup
// are copied from Stories.audit-rt-ins-finaledit.spec.ts.
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, STORIES, USDT, COPYRIGHT, allowCalls, authorize, checkpoint, configure, openPublic, reset,
  segment, story, strikes, write,
} from "./auditFixHelpers";
import { reviewedTakedown } from "./reviewed";

let FILL_COUNTER: i32 = 0;
function chars(n: i32): string {
  FILL_COUNTER++;
  let tag = "";
  let c = FILL_COUNTER;
  while (c > 0) {
    tag += String.fromCharCode(98 + c % 25);
    c = c / 25;
  }
  if (tag.length >= n) return tag.substring(0, n);
  return tag + "a".repeat(n - tag.length);
}

const LINE = "Bob writes a scene for the final edit.";   // 38
const QUOTE = "Quoting a line from an old song";

function openerWrites(id: u64, text: string): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0));
  checkpoint();
}

let gId: u64 = 0;
let gSeq: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);
// Takedown with `gWho` as the strike (empty = the default: strike the writer of an unchanged part).
function takedownNaming(): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(gId, gSeq, COPYRIGHT, "notice 2026-077", gWho, false));
}

describe("RT-IMP-NOOPBLAME: a change that changes nothing still makes the actor a 'changer'", () => {
  beforeEach(() => { reset(); configure(); FILL_COUNTER = 0; });

  it("an unchanged FINAL_EDITED item does not record the opener as a changer of Bob's part", () => {
    const id = openPublic();                                   // part 1: 17 letters
    const seq = write(BOB, id, LINE);                          // part 2: 38
    for (let i = 0; i < 4; i++) openerWrites(id, chars(2000));
    openerWrites(id, chars(10000 - 17 - 38 - 8000));           // story locks at 10,000
    expect(story(id).status).toBe(stories.story_status.STATUS_LOCKED);
    authorize(ALICE);
    new Stories().close_story(new stories.close_story_arguments(ALICE, id));
    checkpoint();
    // The opener picks "Edit" on Bob's part and saves it without changing a letter.
    authorize(ALICE);
    allowCalls(1);
    new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, [
      new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED, "", 0),
      new stories.final_item(seq, stories.final_mode.FINAL_EDITED, LINE, <u64>LINE.length),
    ]));
    checkpoint();
    expect(segment(id, seq).text!).toBe(LINE);
    expect(segment(id, seq).edited_by_others).toBe(false,
      "RT-IMP-NOOPBLAME: an unchanged final edit marked Bob's part as changed by the opener (no version shows she changed nothing)");
    // The admin must not be able to strike the opener for words she never touched.
    gId = id; gSeq = seq; gWho = ALICE;
    expect(takedownNaming).toThrow("RT-IMP-NOOPBLAME: the admin could strike the opener for an unchanged final edit");
    MockVM.rollbackTransaction();
    expect(strikes(ALICE)).toBe(0);
  });

  it("re-setting the citation a part already has does not record the opener as a changer", () => {
    const id = openPublic();
    const seq = write(BOB, id, "Bob's part quotes an old song, with its citation.");
    authorize(BOB);
    new Stories().set_citation(new stories.set_citation_arguments(BOB, id, seq, QUOTE));
    checkpoint();
    // The opener (or Bob's alt wallet made editor) "sets" the same citation again.
    authorize(ALICE);
    new Stories().set_citation(new stories.set_citation_arguments(ALICE, id, seq, QUOTE));
    checkpoint();
    expect(segment(id, seq).citation).toBe(QUOTE);
    expect(segment(id, seq).edited_by_others).toBe(false,
      "RT-IMP-NOOPBLAME: re-setting the same citation recorded the opener as a changer of Bob's part");
    // So the default takedown still strikes the writer, and nobody else.
    gId = id; gSeq = seq; gWho = new Uint8Array(0);
    expect(takedownNaming).not.toThrow("RT-IMP-NOOPBLAME: the writer's automatic strike was lost to a no-op citation");
    checkpoint();
    expect(strikes(BOB)).toBe(1, "RT-IMP-NOOPBLAME: Bob, who wrote the part, was not struck by default");
    expect(strikes(ALICE)).toBe(0);
  });
});
