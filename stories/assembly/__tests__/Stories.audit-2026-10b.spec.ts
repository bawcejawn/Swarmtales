// Tests for the re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md), Stories:
//   L-2  a story's opening text can't be longer than the story itself
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { ALICE, PUBLIC, USDT, allowCalls, authorize, checkpoint, configure, reset } from "./auditFixHelpers";

const POEM = stories.story_kind.KIND_POEM;

// AssemblyScript has no closures: the expect() callbacks read these.
let gText: string = "";

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function openPoem(): void {
  authorize(ALICE);
  allowCalls(3);
  new Stories().open_story(new stories.open_story_arguments(
    ALICE, POEM, "A Small Poem", 50, 1, 0, PUBLIC, 0, 0, gText, false, <u64>gText.length, USDT, true, 0, 0
  ));
}

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
