// Wave 3: the story keeps the sum of every writer's surviving total, which
// the Editions contract uses to split Collector's Edition sales.
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, allowCalls, authorize, checkpoint, configure, openPublic, reset, story, takedown, write,
} from "./auditFixHelpers";

let FILL: i32 = 0;
function letters(n: i32): string {
  FILL++;
  let tag = "";
  let c = FILL;
  while (c > 0) {
    tag += String.fromCharCode(98 + c % 25);
    c = c / 25;
  }
  return tag + "a".repeat(n - tag.length);
}

function aliceWrites(id: u64, text: string): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0));
  checkpoint();
}

function surviving(id: u64, who: Uint8Array): u64 {
  return new Stories().get_surviving_total(new stories.get_surviving_total_arguments(id, who)).value;
}

describe("surviving sum (Wave 3)", () => {
  it("adds up every writer's surviving text and drops a later takedown", () => {
    reset();
    configure();
    const id = openPublic();
    const bobSeq = write(BOB, id, letters(120));
    for (let i = 0; i < 4; i++) aliceWrites(id, letters(2000));
    const st = story(id);
    aliceWrites(id, letters(<i32>(st.max_chars - st.used_chars)));
    authorize(ALICE);
    new Stories().close_story(new stories.close_story_arguments(ALICE, id));
    checkpoint();
    expect(story(id).surviving_sum).toBe(0);

    const count = story(id).segment_count;
    const items: stories.final_item[] = [];
    for (let seq: u64 = 1; seq <= count; seq++) items.push(new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0));
    authorize(ALICE);
    allowCalls(20);
    new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, items));
    checkpoint();

    const alice = surviving(id, ALICE);
    const bob = surviving(id, BOB);
    expect(bob).toBe(120);
    expect(alice > 0).toBe(true);
    expect(story(id).surviving_sum).toBe(alice + bob);

    authorize(ALICE);
    new Stories().finalize(new stories.finalize_arguments(ALICE, id, "https://example.com/book.pdf", new Uint8Array(32)));
    checkpoint();
    expect(story(id).status).toBe(stories.story_status.STATUS_FINALIZED);

    takedown(id, bobSeq, BOB);
    expect(surviving(id, BOB)).toBe(0);
    expect(story(id).surviving_sum).toBe(alice);
    expect(story(id).needs_new_pdf).toBe(true);
  });
});
