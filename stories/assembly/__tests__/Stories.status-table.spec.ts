// Mirrors the "What works at each stage" table in docs/ADMIN_POWERS.md
// (audit 2026-10, longer-term recommendation). Every action is tried in a story
// at each stage: Open, Locked, Editing, Finished, Archived. A ✘ cell must fail
// with that action's stage message. A ✔ cell must either succeed or fail on a
// later check (`later`), which proves the stage check let it through. If the
// code and the table ever disagree, a test here fails: change both together.
import { MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, DAY, MALLORY, START, STORIES, allowCalls, authorize, checkpoint, configure, okCall,
  openPublic, reset, results, setTime, write, writerMonth,
} from "./auditFixHelpers";
import { ownEditArgs, reviewedTakedown } from "./reviewed";

const BOT = MALLORY;   // the moderator key
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const Y = true;
const N = false;

// The five stories, one per stage, and the clock.
let OPEN: u64 = 0;
let LOCKED: u64 = 0;
let EDITING: u64 = 0;
let FINISHED: u64 = 0;
let ARCHIVED: u64 = 0;
let now: u64 = START;

function part(tag: string, n: i32): string {
  let out = tag;
  while (out.length < n) out += "a";
  return out;
}
const BOB_PART = part("Bob's part two ", 1996);

function at(t: u64): void { now = t; setTime(t); }
function createInvite(id: u64): void {
  authorize(ALICE);
  new Stories().create_invite(new stories.create_invite_arguments(ALICE, id, CARA, 5, now + 300 * DAY));
  checkpoint();
}
// Parts 2..6, exactly to the 10,000-character size: the story locks.
function fillToLock(id: u64): void {
  write(BOB, id, BOB_PART);
  for (let i = 0; i < 3; i++) write(BOB, id, part("Bob's filler " + i.toString() + " ", 1996));
  write(BOB, id, part("Bob's last part ", 1999));
}
function close(id: u64): void {
  authorize(ALICE);
  new Stories().close_story(new stories.close_story_arguments(ALICE, id));
  checkpoint();
}
function setup(): void {
  reset();
  configure();
  authorize(STORIES);
  const c = new Stories();
  c.set_limits(new stories.set_limits_arguments(2000, 1000, 10, 60, 30, 10, 4));
  c.set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
  at(START);
  ARCHIVED = openPublic();
  write(BOB, ARCHIVED, BOB_PART);
  createInvite(ARCHIVED);
  at(START + 61 * DAY);
  new Stories().archive_if_stale(new stories.archive_if_stale_arguments(ARCHIVED));
  checkpoint();

  OPEN = openPublic();
  write(BOB, OPEN, BOB_PART);
  createInvite(OPEN);
  LOCKED = openPublic();
  createInvite(LOCKED);
  fillToLock(LOCKED);
  EDITING = openPublic();
  createInvite(EDITING);
  fillToLock(EDITING);
  close(EDITING);
  FINISHED = openPublic();
  createInvite(FINISHED);
  fillToLock(FINISHED);
  close(FINISHED);
  const items: stories.final_item[] = [];
  for (let s: u64 = 1; s <= 6; s++) items.push(new stories.final_item(s, stories.final_mode.FINAL_UNCHANGED));
  authorize(ALICE);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, FINISHED, items));
  checkpoint();
  authorize(ALICE);
  new Stories().finalize(new stories.finalize_arguments(ALICE, FINISHED, "https://swarmtales.example/b/5", new Uint8Array(32)));
  checkpoint();
}

// ---------- the actions (no closures in AssemblyScript: globals pick them) ----------

const CONTRIBUTE = 0;
const EDIT = 1;
const REMOVE = 2;
const REVISE = 3;
const TOP_UP = 4;
const ARCHIVE = 5;
const CITATION = 6;
const REPORT = 7;
const RESTORE = 8;
const UPDATE = 9;
const EDITOR = 10;
const ALLOW = 11;
const SUMMARY = 12;
const INVITE = 13;
const JOIN = 14;
const REVOKE = 15;
const REQUEST = 16;
const CLOSE = 17;
const TAKE_OVER = 18;
const FINAL_BATCH = 19;
const ADVANCE = 20;
const FINALIZE = 21;
const REVIVE = 22;
const REPLACE_PDF = 23;
const HIDE = 24;
const NOTE = 25;
const TAKEDOWN = 26;
const READING = 27;

let gAction: i32 = 0;
let gStory: u64 = 0;

function act(): void {
  const id = gStory;
  const s = new Stories();
  if (gAction == CONTRIBUTE) {
    authorize(CARA);
    results([writerMonth(), okCall()]);
    const t = "Cara adds a new part.";
    s.contribute(new stories.contribute_arguments(CARA, id, t, false, false, <u64>t.length, true, 0));
  } else if (gAction == EDIT) {
    authorize(BOB);
    allowCalls(1);
    const t = BOB_PART.slice(0, BOB_PART.length - 1) + "b";
    s.edit_segment(ownEditArgs(BOB, id, 2, t, <u64>t.length, 0));
  } else if (gAction == REMOVE) {
    authorize(BOB);
    allowCalls(1);
    s.remove_segment(new stories.remove_segment_arguments(BOB, id, 2));
  } else if (gAction == REVISE) {
    authorize(CARA);
    results([writerMonth(), okCall(), okCall()]);
    const t = BOB_PART.slice(0, BOB_PART.length - 1) + "c";
    s.revise_part(new stories.revise_part_arguments(CARA, id, 2, t, 20, true, 0, "", false));
  } else if (gAction == TOP_UP) {
    authorize(ALICE);
    allowCalls(1);
    s.top_up_fund(new stories.top_up_fund_arguments(ALICE, id, 100));
  } else if (gAction == ARCHIVE) {
    s.archive_if_stale(new stories.archive_if_stale_arguments(id));
  } else if (gAction == CITATION) {
    authorize(BOB);
    s.set_citation(new stories.set_citation_arguments(BOB, id, 2, "From a book Bob names"));
  } else if (gAction == REPORT) {
    authorize(CARA);
    s.report_segment(new stories.report_segment_arguments(CARA, id, 2, COPYRIGHT, "copied"));
  } else if (gAction == RESTORE) {
    authorize(ALICE);
    s.restore_segment(new stories.restore_segment_arguments(ALICE, id, 2, ""));
  } else if (gAction == UPDATE) {
    authorize(ALICE);
    s.update_story(new stories.update_story_arguments(ALICE, id, "My Tale", 1, 0, PUBLIC, 0));
  } else if (gAction == EDITOR) {
    authorize(ALICE);
    s.set_editor(new stories.set_editor_arguments(ALICE, id, CARA, true));
  } else if (gAction == ALLOW) {
    authorize(ALICE);
    s.set_allowed(new stories.set_allowed_arguments(ALICE, id, [CARA], true));
  } else if (gAction == SUMMARY) {
    authorize(ALICE);
    s.set_story_summary(new stories.set_story_summary_arguments(ALICE, id, "So far, a harbour and a storm."));
  } else if (gAction == INVITE) {
    authorize(ALICE);
    s.create_invite(new stories.create_invite_arguments(ALICE, id, CARA, 5, now + 30 * DAY));
  } else if (gAction == JOIN) {
    authorize(CARA);
    s.join_with_invite(new stories.join_with_invite_arguments(CARA, id, 1, new Uint8Array(65)));
  } else if (gAction == REVOKE) {
    authorize(ALICE);
    s.revoke_invite(new stories.revoke_invite_arguments(ALICE, id, 1));
  } else if (gAction == REQUEST) {
    authorize(ALICE);
    s.request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, id, true));
  } else if (gAction == CLOSE) {
    authorize(ALICE);
    s.close_story(new stories.close_story_arguments(ALICE, id));
  } else if (gAction == TAKE_OVER) {
    authorize(STORIES);
    s.admin_take_over(new stories.admin_take_over_arguments(id));
  } else if (gAction == FINAL_BATCH) {
    authorize(ALICE);
    s.submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, [new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED)]));
  } else if (gAction == ADVANCE) {
    s.advance_final_cursor(new stories.advance_final_cursor_arguments(id));
  } else if (gAction == FINALIZE) {
    authorize(ALICE);
    s.finalize(new stories.finalize_arguments(ALICE, id, "https://swarmtales.example/b/9", new Uint8Array(32)));
  } else if (gAction == REVIVE) {
    authorize(ALICE);
    s.revive(new stories.revive_arguments(ALICE, id));
  } else if (gAction == REPLACE_PDF) {
    authorize(STORIES);
    s.replace_pdf(new stories.replace_pdf_arguments(id, "https://swarmtales.example/b/new", new Uint8Array(32)));
  } else if (gAction == HIDE) {
    authorize(STORIES);
    s.set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, 2, true, COPYRIGHT, "checked"));
  } else if (gAction == NOTE) {
    authorize(BOT);
    s.set_source_note(new stories.set_source_note_arguments(BOT, id, 2, "Also appears in a 1901 book"));
  } else if (gAction == TAKEDOWN) {
    authorize(STORIES);
    s.takedown_segment(reviewedTakedown(id, 2, COPYRIGHT, "notice", BOB));
  } else if (gAction == READING) {
    authorize(BOB);
    s.set_reading_place(new stories.set_reading_place_arguments(BOB, id, 1, 1, 5));
  }
}

function hidePart(id: u64): void {
  authorize(BOT);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, id, 2, true, COPYRIGHT, "checked"));
  checkpoint();
}
function request(id: u64): void {
  authorize(ALICE);
  new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, id, true));
  checkpoint();
}

// One row of the table. `allowed` is Open, Locked, Editing, Finished, Archived.
// A ✔ cell succeeds, or fails with `later` when it is set (a check after the stage check).
function row(action: i32, allowed: bool[], stage: string, later: string): void {
  const ids: u64[] = [OPEN, LOCKED, EDITING, FINISHED, ARCHIVED];
  const names: string[] = ["Open", "Locked", "Editing", "Finished", "Archived"];
  gAction = action;
  for (let i = 0; i < 5; i++) {
    gStory = ids[i];
    if (allowed[i] && later.length == 0) {
      expect(act).not.toThrow(names[i] + " should be allowed");
      checkpoint();
    } else {
      expect(act).toThrow(names[i]);
      expect(MockVM.getErrorMessage()).toBe(allowed[i] ? later : stage, names[i]);
      MockVM.rollbackTransaction();
    }
  }
}

describe("docs/ADMIN_POWERS.md: what works at each stage", () => {
  beforeEach(() => { setup(); });

  it("write a new part", () => { row(CONTRIBUTE, [Y, N, N, N, N], "STORIES: story is not open for writing", ""); });
  it("edit own part", () => { row(EDIT, [Y, N, N, N, N], "STORIES: text can only be edited while the story is open", ""); });
  it("remove a part", () => { row(REMOVE, [Y, N, N, N, N], "STORIES: text can only be removed while the story is open", ""); });
  it("paid change", () => { row(REVISE, [Y, N, N, N, N], "STORIES: parts can only be changed while the story is open", ""); });
  it("add to the pool (these stories are public, so the Open cell stops at the next check)", () => {
    row(TOP_UP, [Y, N, N, N, N], "STORIES: a fund can only be topped up while the story is open", "STORIES: only private stories have a fund");
  });
  it("archive", () => {
    at(now + 61 * DAY);
    row(ARCHIVE, [Y, N, N, N, N], "STORIES: only an open story can be archived", "");
  });
  it("citation", () => { row(CITATION, [Y, Y, Y, N, Y], "STORIES: a finalized story cannot be changed", ""); });
  it("report a part", () => { row(REPORT, [Y, Y, Y, N, Y], "STORIES: finished books are reported to the SwarmTales team, not on-chain", ""); });
  it("restore a hidden part", () => {
    hidePart(OPEN); hidePart(LOCKED); hidePart(EDITING); hidePart(FINISHED); hidePart(ARCHIVED);
    row(RESTORE, [Y, Y, Y, N, Y], "STORIES: a finalized story cannot be changed", "");
  });
  it("story settings", () => { row(UPDATE, [Y, Y, Y, N, Y], "STORIES: a finalized story cannot be changed", ""); });
  it("editors", () => { row(EDITOR, [Y, Y, Y, N, Y], "STORIES: a finalized story cannot be changed", ""); });
  it("allow-list", () => { row(ALLOW, [Y, Y, Y, N, Y], "STORIES: a finalized story cannot be changed", ""); });
  it("summary", () => { row(SUMMARY, [Y, Y, Y, N, N], "STORIES: the summary can't change once the story is finalized or archived", ""); });
  it("create an invite", () => { row(INVITE, [Y, Y, Y, N, N], "STORIES: story is not accepting new writers", ""); });
  it("join with an invite (a blank signature stops at the next check)", () => {
    row(JOIN, [Y, Y, Y, N, N], "STORIES: story is not accepting new writers", "STORIES: invite link rejected");
  });
  it("revoke an invite", () => { row(REVOKE, [Y, Y, Y, Y, Y], "", ""); });
  it("ask the admin to finish", () => { row(REQUEST, [Y, Y, Y, N, N], "STORIES: story is not active", ""); });
  it("close (the Open story is not long enough yet)", () => {
    row(CLOSE, [N, Y, N, N, N], "STORIES: story cannot be closed yet", "");
  });
  it("admin take-over (the Open story is not long enough yet)", () => {
    request(OPEN); request(LOCKED); request(EDITING);
    row(TAKE_OVER, [N, Y, Y, N, N], "STORIES: story is not ready for an admin finalize", "");
  });
  it("final edit batch", () => { row(FINAL_BATCH, [N, N, Y, N, N], "STORIES: story is not in the final edit", ""); });
  it("advance the final edit (nothing to skip yet)", () => {
    row(ADVANCE, [N, N, Y, N, N], "STORIES: story is not in the final edit", "STORIES: nothing to skip; the next segment still needs the finalizer");
  });
  it("finish (parts still to process)", () => {
    row(FINALIZE, [N, N, Y, N, N], "STORIES: story is not in the final edit", "STORIES: some segments are not processed yet");
  });
  it("revive", () => { row(REVIVE, [N, N, N, N, Y], "STORIES: story is not archived", ""); });
  it("replace the book link after a takedown", () => {
    gAction = TAKEDOWN; gStory = FINISHED;
    act();
    checkpoint();
    row(REPLACE_PDF, [N, N, N, Y, N], "STORIES: this story does not need a new PDF", "");
  });
  it("hide", () => { row(HIDE, [Y, Y, Y, Y, Y], "", ""); });
  it("source note", () => { row(NOTE, [Y, Y, Y, Y, Y], "", ""); });
  it("take down", () => { row(TAKEDOWN, [Y, Y, Y, Y, Y], "", ""); });
  it("save a reading place", () => { row(READING, [Y, Y, Y, Y, Y], "", ""); });
});

function paused(action: i32, id: u64): void {
  gAction = action;
  gStory = id;
  expect(act).toThrow();
  expect(MockVM.getErrorMessage()).toBe("STORIES: stories are paused");
  MockVM.rollbackTransaction();
}
function works(action: i32, id: u64): void {
  gAction = action;
  gStory = id;
  expect(act).not.toThrow();
  checkpoint();
}

describe("docs/ADMIN_POWERS.md: the Paused column", () => {
  beforeEach(() => {
    setup();
    request(LOCKED);
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
  });

  it("every user write, archiving and the admin take-over wait out a pause", () => {
    paused(CONTRIBUTE, OPEN); paused(EDIT, OPEN); paused(REMOVE, OPEN); paused(REVISE, OPEN); paused(TOP_UP, OPEN);
    paused(ARCHIVE, OPEN); paused(CITATION, OPEN); paused(REPORT, OPEN); paused(RESTORE, OPEN); paused(UPDATE, OPEN);
    paused(EDITOR, OPEN); paused(ALLOW, OPEN); paused(SUMMARY, OPEN); paused(INVITE, OPEN); paused(JOIN, OPEN);
    paused(REVOKE, OPEN); paused(REQUEST, OPEN); paused(CLOSE, LOCKED); paused(TAKE_OVER, LOCKED);
    paused(FINAL_BATCH, EDITING); paused(ADVANCE, EDITING); paused(FINALIZE, EDITING); paused(REVIVE, ARCHIVED);
    paused(READING, OPEN);
  });

  it("moderation and the book-link replacement still work", () => {
    works(HIDE, OPEN);
    works(NOTE, LOCKED);
    works(TAKEDOWN, FINISHED);
    works(REPLACE_PDF, FINISHED);
  });
});
