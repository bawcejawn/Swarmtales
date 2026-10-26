// Tests for the re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md), Stories:
//   L-1  a writer taken off a private story's list can't set a citation
//        (clearing one stays allowed, as for a blocked wallet)
//   L-2  a story's opening text can't be longer than the story itself
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { ALICE, BOB, PRIVATE, PUBLIC, USDT, allowCalls, authorize, checkpoint, configure, invite, openAs, reset, segment, write } from "./auditFixHelpers";

const POEM = stories.story_kind.KIND_POEM;

// AssemblyScript has no closures: the expect() callbacks read these.
let gId: u64 = 0;
let gSeq: u64 = 0;
let gText: string = "";

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function citeAsBob(): void {
  authorize(BOB);
  new Stories().set_citation(new stories.set_citation_arguments(BOB, gId, gSeq, gText));
}

function openPoem(): void {
  authorize(ALICE);
  allowCalls(3);
  new Stories().open_story(new stories.open_story_arguments(
    ALICE, POEM, "A Small Poem", 50, 1, 0, PUBLIC, 0, 0, gText, false, <u64>gText.length, USDT, true, 0, 0
  ));
}

describe("L-1: a writer taken off a private story's list", () => {
  beforeEach(() => { reset(); configure(); });

  it("can't set a citation on their part any more, but can still clear it", () => {
    gId = openAs(PRIVATE, 10000);
    invite(gId, BOB, true);
    gSeq = write(BOB, gId, "Bob writes in the private story.");
    gText = "A source Bob quotes";
    citeAsBob();
    checkpoint();
    invite(gId, BOB, false);
    gText = "Another source, after removal";
    expect(citeAsBob).toThrow();
    errorIs("STORIES: you are no longer on this private story's list of writers; you can still remove your parts");
    expect(segment(gId, gSeq).citation).toBe("A source Bob quotes");
    gText = "";
    citeAsBob();
    checkpoint();
    expect(segment(gId, gSeq).citation).toBe("");
  });
});

describe("L-2: the opening text fits the story", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses a Poem whose opening is longer than its own size", () => {
    gText = "";
    while (gText.length < 51) gText += "a";
    expect(openPoem).toThrow();
    errorIs("STORIES: the opening text is longer than the story");
    gText = "";
    while (gText.length < 50) gText += "b";
    openPoem();
    checkpoint();
  });
});
