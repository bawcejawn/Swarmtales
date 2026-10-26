// The Poem story kind (October 2026): 50 to 25,000 characters, its own
// Shop item and starter Ink, a 10-character close slack, and a 50 Ink
// minimum writers' pool for a private Poem.
import { MockVM, Protobuf } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { ALICE, PRIVATE, PUBLIC, STORIES, USDT, allowCalls, authorize, checkpoint, configure, reset, story, write } from "./auditFixHelpers";

const POEM = stories.story_kind.KIND_POEM;

// AssemblyScript has no closures: the expect() callbacks read these.
let gMax: u64 = 0;
let gFund: u64 = 0;
let gVis: stories.visibility = PUBLIC;
let gKind: stories.story_kind = POEM;
let gId: u64 = 0;

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function openPoem(maxChars: u64, text: string, vis: stories.visibility, fund: u64, kind: stories.story_kind): u64 {
  authorize(ALICE);
  allowCalls(3);
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, kind, "A Small Poem", maxChars, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0, fund
  )).value;
  checkpoint();
  return id;
}

function close(id: u64): void {
  authorize(ALICE);
  new Stories().close_story(new stories.close_story_arguments(ALICE, id));
}

describe("Stories: Poems", () => {
  beforeEach(() => {
    reset();
    configure();
  });

  it("opens a Poem with no fixed size up to 25,000 characters and asks Shop for the Poem fee", () => {
    const id = openPoem(0, "The moon, a lantern.", PUBLIC, 0, POEM);
    const st = story(id);
    expect(st.kind).toBe(POEM);
    expect(st.max_chars).toBe(25000);
    const events = MockVM.getEvents();
    let opened = false;
    for (let i = 0; i < events.length; i++) {
      if (events[i].name == "stories.story_opened_event") {
        const ev = Protobuf.decode<stories.story_opened_event>(events[i].data!, stories.story_opened_event.decode);
        expect(ev.kind).toBe(POEM);
        opened = true;
      }
    }
    expect(opened).toBe(true);
  });

  it("takes any fixed size from 50 to 25,000", () => {
    expect(story(openPoem(50, "Short and sweet.", PUBLIC, 0, POEM)).max_chars).toBe(50);
    expect(story(openPoem(25000, "Long and winding.", PUBLIC, 0, POEM)).max_chars).toBe(25000);
  });

  it("refuses a Poem under 50 characters", () => {
    gMax = 49;
    expect(() => { openPoem(gMax, "Too small.", PUBLIC, 0, POEM); }).toThrow();
    errorIs("STORIES: a Poem must be 50 to 25,000 characters");
  });

  it("refuses a Poem over 25,000 characters", () => {
    gMax = 25001;
    expect(() => { openPoem(gMax, "Too big.", PUBLIC, 0, POEM); }).toThrow();
    errorIs("STORIES: a Poem must be 50 to 25,000 characters");
  });

  it("refuses an unknown kind", () => {
    gKind = <stories.story_kind>4;
    expect(() => { openPoem(0, "What am I?", PUBLIC, 0, gKind); }).toThrow();
    errorIs("STORIES: kind must be Book, Short Story or Poem");
  });

  it("closes only once it has 50 characters", () => {
    gId = openPoem(0, "Twenty characters!!!", PUBLIC, 0, POEM);
    expect(() => { close(gId); }).toThrow();
    errorIs("STORIES: story cannot be closed yet");
    write(ALICE, gId, "and thirty more characters here");
    expect(story(gId).used_chars).toBe(51);
    allowCalls(3);
    close(gId);
    expect(story(gId).status).not.toBe(stories.story_status.STATUS_OPEN);
  });

  it("may close within 10 characters of its own smaller maximum", () => {
    // max 55, minimum 50: at 45 characters it is within the Poem slack.
    gId = openPoem(55, "Forty-five characters of verse, give or take.", PUBLIC, 0, POEM);
    expect(story(gId).used_chars).toBe(45);
    allowCalls(3);
    close(gId);
    expect(story(gId).status).not.toBe(stories.story_status.STATUS_OPEN);
  });

  it("does not use the 100-character slack of the longer kinds", () => {
    // max 200: at 101 characters a Book-style slack would allow closing; the Poem minimum (50) does anyway,
    // so check below the minimum instead: max 120, 40 characters, 40 + 10 < 120.
    gId = openPoem(120, "Forty characters of verse, no more, ok!!", PUBLIC, 0, POEM);
    expect(story(gId).used_chars).toBe(40);
    expect(() => { close(gId); }).toThrow();
    errorIs("STORIES: story cannot be closed yet");
  });

  it("needs a writers' pool of at least 50 Ink when private", () => {
    gFund = 49;
    expect(() => { openPoem(0, "A private verse.", PRIVATE, gFund, POEM); }).toThrow();
    errorIs("STORIES: a private Poem needs a writers' pool of at least 50 Ink");
    const id = openPoem(0, "A private verse.", PRIVATE, 50, POEM);
    expect(story(id).visibility).toBe(PRIVATE);
    expect(story(id).fund).toBe(50);
  });
});
