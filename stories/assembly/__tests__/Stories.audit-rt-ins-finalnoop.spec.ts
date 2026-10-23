// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ e5255c6.
// Attack: in submit_final_batch, a FINAL_EDITED item whose text is IDENTICAL
// to the part keeps no version (keepVersion is inside `if (text != oldText)`)
// but still calls recordChanger (Stories.ts ~1043). The finalizer (the
// opener, or the admin after admin_take_over) changes nothing and yet:
//   - the part is marked edited_by_others, so a takedown no longer strikes
//     its writer automatically ("someone other than the writer changed this
//     part; name who gets the strike"): an opener shields a copying friend's
//     parts in their own book for free, one no-op item per part;
//   - the finalizer becomes a "wallet that changed the part" and can be
//     struck for text it never touched, with no version to show for it.
// Claims: ADMIN_POWERS.md "A part nobody else changed is a strike against
// its writer" and "The admin cannot strike a wallet that never changed the part".
// Asserts the SAFE behaviour. FAILS on the current code.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, openPublic, reset, segment, story, strikes,
  versions, write,
} from "./auditFixHelpers";
import { reviewedTakedown } from "./reviewed";

const LINE = "Bob's own scene, which nobody else ever touches.";
let gId: u64 = 0;
let gSeq: u64 = 0;

function openerWrites(id: u64, text: string): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0));
  checkpoint();
}

// Bob writes one part; Alice fills the story to 10,000 (it locks) and closes it.
function closedStoryWithBobsPart(): void {
  gId = openPublic();
  gSeq = write(BOB, gId, LINE);
  const letters: string[] = ["a", "b", "c", "d"];
  for (let i = 0; i < letters.length; i++) openerWrites(gId, letters[i].repeat(2000));
  const st = story(gId);
  openerWrites(gId, "e".repeat(<i32>(st.max_chars - st.used_chars)));
  expect(story(gId).status).toBe(stories.story_status.STATUS_LOCKED);
  authorize(ALICE);
  new Stories().close_story(new stories.close_story_arguments(ALICE, gId));
  checkpoint();
  expect(story(gId).status).toBe(stories.story_status.STATUS_EDITING);
}

// Alice "edits" Bob's part to exactly the same text.
function noOpFinalEdit(): void {
  authorize(ALICE);
  allowCalls(2);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, gId, [
    new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED, "", 0),
    new stories.final_item(gSeq, stories.final_mode.FINAL_EDITED, LINE, <u64>LINE.length),
  ]));
  checkpoint();
}

function takedownStrikingAlice(): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(gId, gSeq, COPYRIGHT, "notice 2026-301", ALICE, false));
}
function takedownDefault(): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(gId, gSeq, COPYRIGHT, "notice 2026-302", new Uint8Array(0), false));
}

describe("RT-INS final no-op: an unchanged 'final edit' marks the part as changed by others", () => {
  beforeEach(() => { reset(); configure(); closedStoryWithBobsPart(); noOpFinalEdit(); });

  it("does not record the finalizer as a changer when the text is identical", () => {
    expect(segment(gId, gSeq).text!).toBe(LINE);
    expect(versions(gId, gSeq).length).toBe(0, "precondition: no version was kept, so nothing changed");
    expect(segment(gId, gSeq).edited_by_others).toBe(false,
      "RT-INS finalnoop: a no-op final edit marked Bob's untouched part as changed by someone else");
  });

  it("refuses to strike the opener, who changed nothing", () => {
    expect(takedownStrikingAlice).toThrow("RT-INS finalnoop: the admin struck Alice for a part whose text she never changed");
  });

  it("still strikes the writer automatically for his own untouched text", () => {
    expect(takedownDefault).not.toThrow(
      "RT-INS finalnoop: a no-op item in the final edit shields the writer from the automatic strike");
    checkpoint();
    expect(strikes(BOB)).toBe(1, "RT-INS finalnoop: Bob's untouched part was taken down without his strike");
  });
});
