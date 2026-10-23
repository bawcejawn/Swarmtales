// Tests for the fixes from the 2026-10 mainnet audit (main @ 16de9dc).
// Each `it` asserts the fixed rule; most would fail on 16de9dc.
//   M-1  a pause stops the inactivity clocks; admin_take_over waits out a pause
//   M-2  open_story passes the opener's minimum starter Ink to Shop
//   M-3  no reports on finished books; an admin hide there still can't be restored
//   M-4  a writer taken off a private story's list can't edit, only remove
//   M-5  get_segments stops at a byte budget and says where to go on
//   F-03 the same text can't be edited or changed into a story twice
//   F-04 own-part edits need the rights confirmation and the current Terms
//   F-05 an opener removes only report-hidden parts; the writer keeps the refund
//   F-06 a removal keeps the removed text as a version, and a takedown wipes it
//   F-08 a blocked finalizer removes only hidden parts in the final edit
//   F-09 a blocked wallet can't revive or join with an invite
//   S2-03 a free revive only while the next project is at the normal price
//   S2-05 a lowered cap still lets a writer trim an over-cap part
//   S2-06 a story its opener still manages isn't archived
//   Info: set_reading_place waits out a pause; a used-up trial can't make paid
//         cuts; a takedown is bound to the reviewed text; the cap is 6,000
import { MockVM, Protobuf, System, chain, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, DAY, MALLORY, PRIVATE, START, STORIES, allowCalls, authorize, checkpoint, configure,
  membership, mintsTo, okCall, openAs, openPublic, ownerEdit, ownerRemove, reset, results, revise, segment, setTime,
  story, takedown, USDT, write, writerMonth,
} from "./auditFixHelpers";
import { ownEditArgs, reviewedTakedown } from "./reviewed";

const BOT = MALLORY;                      // the moderator key (copy checker) in these tests
const SHOP_OPEN_FEE_ENTRY: u32 = 547545118;
const UNCHANGED = stories.final_mode.FINAL_UNCHANGED;
const REMOVED = stories.final_mode.FINAL_REMOVED;

// AssemblyScript has no closures: the expect() callbacks read these.
let gId: u64 = 0;
let gSeq: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);
let gText: string = "";
let gArgs: stories.takedown_segment_arguments = new stories.takedown_segment_arguments();

function text(tag: string, n: i32): string {
  let out = tag;
  while (out.length < n) out += "a";
  return out;
}
function cjk(tag: string, n: i32): string {
  let out = tag;
  while (out.length < n) out += "界";
  return out;
}
function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}
function pause(on: bool): void {
  authorize(STORIES);
  new Stories().set_paused(new stories.set_paused_arguments(on));
  checkpoint();
}
function limits(cap: u32, openLimit: u32): void {
  authorize(STORIES);
  new Stories().set_limits(new stories.set_limits_arguments(cap, 1000, openLimit, 60, 30));
  checkpoint();
}
function moderatorKey(): void {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
}
function block(who: Uint8Array): void {
  authorize(STORIES);
  new Stories().set_blocked(new stories.set_blocked_arguments(who, true, "repeat"));
  checkpoint();
}
function hideAs(actor: Uint8Array, id: u64, seq: u64): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, id, seq, true, COPYRIGHT, "copied"));
  checkpoint();
}
function reportHide(id: u64, seq: u64): void {
  const reporters: Uint8Array[] = [ALICE, CARA, MALLORY];
  for (let i = 0; i < reporters.length; i++) {
    authorize(reporters[i]);
    new Stories().report_segment(new stories.report_segment_arguments(reporters[i], id, seq, COPYRIGHT, ""));
    checkpoint();
  }
}
// Bob fills a 10,000-character short story to closing size (parts 2..6).
function fillToClose(id: u64): void {
  for (let i = 0; i < 5; i++) write(BOB, id, text("Part " + i.toString() + " ", 1977));
}
function closeAndKeepAll(id: u64): void {
  authorize(ALICE);
  new Stories().close_story(new stories.close_story_arguments(ALICE, id));
  checkpoint();
  const items: stories.final_item[] = [];
  const count = story(id).segment_count;
  for (let s: u64 = 1; s <= count; s++) items.push(new stories.final_item(s, UNCHANGED));
  authorize(ALICE);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, items));
  checkpoint();
}
function finalize(id: u64): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().finalize(new stories.finalize_arguments(ALICE, id, "https://swarmtales.example/b/1", new Uint8Array(32)));
  checkpoint();
}
function ageDays(days: u64): void { setTime(START + days * DAY); }
function archive(): void {
  allowCalls(1);
  new Stories().archive_if_stale(new stories.archive_if_stale_arguments(gId));
}
function takeOver(): void {
  authorize(STORIES);
  new Stories().admin_take_over(new stories.admin_take_over_arguments(gId));
}
function editAs(): void {
  authorize(gWho);
  allowCalls(1);
  new Stories().edit_segment(ownEditArgs(gWho, gId, gSeq, gText, <u64>gText.length, 0));
}
function removeAs(): void {
  authorize(gWho);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(gWho, gId, gSeq));
}
function reviveAs(): void {
  authorize(gWho);
  new Stories().revive(new stories.revive_arguments(gWho, gId));
}
function readingPlace(): void {
  authorize(BOB);
  new Stories().set_reading_place(new stories.set_reading_place_arguments(BOB, gId, 1, 1, 10));
}
function staleTakedown(): void {
  authorize(STORIES);
  new Stories().takedown_segment(gArgs);
}
function reportBook(): void {
  authorize(CARA);
  new Stories().report_segment(new stories.report_segment_arguments(CARA, gId, gSeq, COPYRIGHT, "copied"));
}
function restoreAsAlice(): void {
  authorize(ALICE);
  new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, ""));
}
function joinAs(): void {
  authorize(gWho);
  new Stories().join_with_invite(new stories.join_with_invite_arguments(gWho, gId, 1, new Uint8Array(65)));
}

describe("M-1: a pause stops the inactivity clocks", () => {
  beforeEach(() => { reset(); configure(); });

  it("a 70-day pause doesn't make a story archivable; 60 active days after it do", () => {
    gId = openPublic();
    ageDays(1);
    pause(true);
    ageDays(71);
    pause(false);
    expect(new Stories().get_config(new stories.get_config_arguments()).paused_seconds).toBe(70 * DAY);
    expect(archive).toThrow("archived the moment a long pause ended");
    errorIs("STORIES: story has been active recently");
    ageDays(71 + 59);
    expect(archive).toThrow();
    errorIs("STORIES: story has been active recently");
    ageDays(71 + 61);
    expect(archive).not.toThrow("60 active days after the pause must archive it");
    expect(story(gId).status).toBe(stories.story_status.STATUS_ARCHIVED);
  });

  it("admin_take_over is refused while paused, and the opener's clock stops too", () => {
    gId = openPublic();
    fillToClose(gId);
    ageDays(1);
    pause(true);
    ageDays(40);
    expect(takeOver).toThrow();
    errorIs("STORIES: stories are paused");
    pause(false);
    expect(takeOver).toThrow("the pause counted as the opener's inactivity");
    errorIs("STORIES: the opener has not asked and has not been inactive long enough");
    ageDays(40 + 31);
    expect(takeOver).not.toThrow("30 active days of opener silence after the pause");
  });

  it("a second pause adds to the first, and pausing twice changes nothing", () => {
    gId = openPublic();
    pause(true);
    ageDays(2);
    pause(true);
    ageDays(3);
    pause(false);
    ageDays(10);
    pause(true);
    ageDays(14);
    pause(false);
    const cfg = new Stories().get_config(new stories.get_config_arguments());
    expect(cfg.paused_seconds).toBe(7 * DAY);
    expect(cfg.paused_at).toBe(0);
  });
});

function shopFeeCall(): stories.shop_fee_call {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let out = new stories.shop_fee_call();
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point == SHOP_OPEN_FEE_ENTRY) out = Protobuf.decode<stories.shop_fee_call>(ev.payload!, stories.shop_fee_call.decode);
  }
  return out;
}

describe("M-2: the opener's minimum starter Ink goes to Shop", () => {
  beforeEach(() => { reset(); configure(); });

  it("open_story passes min_ink (and max_price) in the open-fee call", () => {
    authorize(ALICE);
    allowCalls(2);
    const opening = "Once upon a time.";
    new Stories().open_story(new stories.open_story_arguments(
      ALICE, stories.story_kind.KIND_SHORT, "My Tale", 10000, 1, 0, stories.visibility.VISIBILITY_PUBLIC, 0, 0, opening,
      false, <u64>opening.length, USDT, true, 0, 0, null, 77, 10000
    ));
    checkpoint();
    const fee = shopFeeCall();
    expect(fee.min_ink).toBe(10000);
    expect(fee.max_price).toBe(77);
  });
});

describe("M-3: reports on finished books", () => {
  beforeEach(() => { reset(); configure(); });

  it("are refused, and an admin hide on a finished book still can't be restored by the opener", () => {
    gId = openPublic();
    fillToClose(gId);
    closeAndKeepAll(gId);
    finalize(gId);
    gSeq = 2;
    expect(reportBook).toThrow();
    errorIs("STORIES: finished books are reported to the SwarmTales team, not on-chain");
    hideAs(STORIES, gId, 2);
    expect(restoreAsAlice).toThrow();
    errorIs("STORIES: a finalized story cannot be changed");
  });
});

describe("M-4: a writer taken off a private story's list", () => {
  beforeEach(() => { reset(); configure(); });

  it("can't edit their part any more, even at the same length, but can still remove it", () => {
    gId = openAs(PRIVATE, 10000);
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, gId, [BOB], true));
    checkpoint();
    gSeq = write(BOB, gId, "Bob writes in the private story.");
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, gId, [BOB], false));
    checkpoint();
    gWho = BOB;
    gText = "Bob rewrote it, same size: abcde";
    expect(gText.length).toBe(32);
    expect(editAs).toThrow();
    errorIs("STORIES: you are no longer on this private story's list of writers; you can still remove your parts");
    expect(removeAs).not.toThrow("the removed writer can still withdraw their part");
  });

  it("control: an invited writer still edits", () => {
    gId = openAs(PRIVATE, 10000);
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, gId, [BOB], true));
    checkpoint();
    gSeq = write(BOB, gId, "Bob writes in the private story.");
    gWho = BOB;
    gText = "Bob rewrote it, same size: abcde";
    expect(editAs).not.toThrow();
  });
});

describe("M-5: get_segments stops at a byte budget", () => {
  beforeEach(() => { reset(); configure(); });

  it("returns three 18 KB parts, then the rest, and says where to go on", () => {
    limits(6000, 3);
    gId = openPublic();
    for (let i = 0; i < 4; i++) write(BOB, gId, cjk(i.toString(), 6000));
    const first = new Stories().get_segments(new stories.get_segments_arguments(gId, 2, 10));
    expect(first.values.length).toBe(3);
    expect(first.next).toBe(5);
    const rest = new Stories().get_segments(new stories.get_segments_arguments(gId, first.next, 10));
    expect(rest.values.length).toBe(1);
    expect(rest.next).toBe(0);
    const short = new Stories().get_segments(new stories.get_segments_arguments(gId, 1, 2));
    expect(short.values.length).toBe(2);
    expect(short.next).toBe(3);
  });

  it("the per-submission cap can't go above 6,000", () => {
    expect(() => { limits(6001, 3); }).toThrow();
    errorIs("STORIES: per-submission cap must be 100 to 6000");
  });
});

describe("F-03: the same text can't be in one story twice", () => {
  beforeEach(() => { reset(); configure(); });

  it("an edit can't copy another part's text; edited-away text is free again", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's original words here.");
    write(CARA, gId, "Cara's words for the story.");
    gWho = BOB;
    gText = "Cara's words for the story.";
    expect(editAs).toThrow();
    errorIs("STORIES: this exact text is already in this story");
    ownerEdit(BOB, gId, gSeq, "Bob's new words here, edited.");
    expect(() => { write(CARA, gId, "Bob's original words here."); }).not.toThrow("text that left the story may be written again");
  });

  it("a paid change can't copy another part's text either", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's original words here.");
    write(CARA, gId, "Cara's words for the story.");
    expect(() => { revise(MALLORY, gId, 2, "Cara's words for the story."); }).toThrow();
    errorIs("STORIES: this exact text is already in this story");
  });

  it("text that was taken down stays blocked; text its writer removed while visible doesn't", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Copied words from a famous novel.");
    takedown(gId, gSeq, BOB);
    expect(() => { write(CARA, gId, "Copied words from a famous novel."); }).toThrow();
    errorIs("STORIES: this exact text is already in this story");
    const seq = write(BOB, gId, "Bob's honest words, later removed.");
    ownerRemove(BOB, gId, seq);
    expect(() => { write(CARA, gId, "Bob's honest words, later removed."); }).not.toThrow();
  });
});

function editNoRights(): void {
  authorize(BOB);
  allowCalls(1);
  const a = ownEditArgs(BOB, gId, gSeq, gText, <u64>gText.length, 0);
  a.rights_confirmed = false;
  new Stories().edit_segment(a);
}
function editOldTerms(): void {
  authorize(BOB);
  allowCalls(1);
  const a = ownEditArgs(BOB, gId, gSeq, gText, <u64>gText.length, 0);
  a.terms_version = a.terms_version + 1;
  new Stories().edit_segment(a);
}

describe("F-04: own-part edits are new text", () => {
  beforeEach(() => { reset(); configure(); });

  it("need the rights confirmation and the current Terms", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's original words here.");
    gText = "Bob's words, reworded a bit";
    expect(editNoRights).toThrow();
    errorIs("STORIES: confirm that you wrote this text or have the right to use it");
    expect(editOldTerms).toThrow();
    errorIs("STORIES: the Terms of Use have changed; reload the page and accept the current version");
  });
});

describe("F-05: who removes a hidden part", () => {
  beforeEach(() => { reset(); configure(); moderatorKey(); });

  it("the opener can't remove a part the checker hid; its writer can", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's part the checker flags.");
    hideAs(BOT, gId, gSeq);
    gWho = ALICE;
    expect(removeAs).toThrow();
    errorIs("STORIES: only the part's writer may remove it for free; others can remove it for Ink");
    gWho = BOB;
    expect(removeAs).not.toThrow();
  });

  it("the opener removes a part writer reports hid, and its writer gets the refund", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's honest part, wrongly reported.");
    write(CARA, gId, "Cara writes a line.");
    write(MALLORY, gId, "Mallory writes a line.");
    reportHide(gId, gSeq);
    expect(segment(gId, gSeq).hidden_by).toBe(1);
    const before = mintsTo(BOB);
    gWho = ALICE;
    expect(removeAs).not.toThrow();
    checkpoint();
    expect(mintsTo(BOB) - before).toBe(<u64>"Bob's honest part, wrongly reported.".length);
  });
});

describe("F-06: a removal keeps the removed text", () => {
  beforeEach(() => { reset(); configure(); });

  it("as the version before a 'removed' version, until a takedown wipes them", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's words that he later removes.");
    ownerRemove(BOB, gId, gSeq);
    const seg = segment(gId, gSeq);
    expect(seg.version_count).toBe(2);
    const kept = new Stories().get_versions(new stories.get_versions_arguments(gId, gSeq, 1, 5)).values;
    expect(kept[0].text!).toBe("Bob's words that he later removes.");
    expect(kept[1].kind).toBe(3);
    expect(kept[1].text!).toBe("");
    takedown(gId, gSeq, BOB);
    expect(segment(gId, gSeq).version_count).toBe(0);
    expect(new Stories().get_versions(new stories.get_versions_arguments(gId, gSeq, 1, 5)).values.length).toBe(0);
  });
});

let finalItems: stories.final_item[] = [];
function finalBatch(): void {
  authorize(ALICE);
  allowCalls(2);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, gId, finalItems));
}

describe("F-08: a blocked finalizer in the final edit", () => {
  beforeEach(() => { reset(); configure(); moderatorKey(); });

  it("may remove a hidden part to finish, but not a visible one", () => {
    gId = openPublic();
    fillToClose(gId);                  // parts 2..6 are Bob's
    hideAs(BOT, gId, 3);
    authorize(ALICE);
    new Stories().close_story(new stories.close_story_arguments(ALICE, gId));
    checkpoint();
    block(ALICE);
    finalItems = [new stories.final_item(1, UNCHANGED), new stories.final_item(2, REMOVED)];
    expect(finalBatch).toThrow();
    errorIs("STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
    finalItems = [new stories.final_item(1, UNCHANGED), new stories.final_item(2, UNCHANGED), new stories.final_item(3, REMOVED)];
    expect(finalBatch).not.toThrow("removing a hidden part is how a blocked opener finishes the book");
  });
});

describe("F-09 and S2-03: revive and join", () => {
  beforeEach(() => { reset(); configure(); });

  it("a blocked wallet can't join with an invite", () => {
    gId = openAs(PRIVATE, 10000);
    block(BOB);
    gWho = BOB;
    expect(joinAs).toThrow();
    errorIs("STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
  });

  it("a blocked opener can't revive", () => {
    gId = openPublic();
    ageDays(61);
    expect(archive).not.toThrow();
    checkpoint();
    block(ALICE);
    gWho = ALICE;
    expect(reviveAs).toThrow();
    errorIs("STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
  });

  it("reviving is free only while the next project would be at the normal price", () => {
    limits(2000, 10);
    gId = openPublic();
    ageDays(61);
    expect(archive).not.toThrow();
    checkpoint();
    openPublic();
    openPublic();
    openPublic();                      // 3 open: the next one would cost 2x
    gWho = ALICE;
    expect(reviveAs).toThrow();
    errorIs("STORIES: reviving is free only while your next project would be at the normal price; finish or archive another one first");
  });

  it("control: a revive at the normal price works", () => {
    gId = openPublic();
    ageDays(61);
    expect(archive).not.toThrow();
    checkpoint();
    gWho = ALICE;
    expect(reviveAs).not.toThrow();
    expect(story(gId).status).toBe(stories.story_status.STATUS_OPEN);
  });
});

describe("S2-05: a lowered cap", () => {
  beforeEach(() => { reset(); configure(); });

  it("still lets the writer trim an over-cap part, but not grow it", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, text("Bob's long part ", 2000));
    limits(1000, 3);
    gWho = BOB;
    gText = text("Bob's trimmed part ", 1500);
    expect(editAs).not.toThrow("trimming an over-cap part");
    checkpoint();
    gText = text("Bob's regrown part ", 1600);
    expect(() => { ownerEdit(BOB, gId, gSeq, gText); }).toThrow();
    errorIs("STORIES: text is over the per-submission cap");
  });
});

describe("S2-06: a managed story isn't archived", () => {
  beforeEach(() => { reset(); configure(); });

  it("while its opener is active, even with no new text", () => {
    gId = openPublic();
    ageDays(50);
    authorize(ALICE);
    new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, CARA, true));
    checkpoint();
    ageDays(61);
    expect(archive).toThrow();
    errorIs("STORIES: story has been active recently");
    ageDays(111);
    expect(archive).not.toThrow();
  });
});

function promo(on: bool): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(new stories.uint64(on ? 1 : 0), stories.uint64.encode)));
}
function trialCut(): void {
  const s = segment(gId, gSeq);
  authorize(CARA);
  results([membership(0, 0), promo(true), okCall(), okCall()]);
  // Cara cuts 10 letters from Bob's part: 10 units x 2.
  const cut = s.text!.slice(0, s.text!.length - 10);
  new Stories().revise_part(new stories.revise_part_arguments(CARA, gId, gSeq, cut, 20, true, 0, "", false));
}

describe("Info: pause, trial, takedown review", () => {
  beforeEach(() => { reset(); configure(); });

  it("set_reading_place waits out a pause", () => {
    gId = openPublic();
    pause(true);
    expect(readingPlace).toThrow();
    errorIs("STORIES: stories are paused");
    pause(false);
    expect(readingPlace).not.toThrow();
  });

  it("a promo wallet whose trial is used up can't make paid cuts", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's part that someone will cut down.");
    authorize(CARA);
    results([membership(0, 0), promo(true), okCall()]);
    const t = text("Cara's trial part ", 1000);
    new Stories().contribute(new stories.contribute_arguments(CARA, gId, t, false, false, <u64>t.length, true, 0));
    checkpoint();
    expect(trialCut).toThrow();
    errorIs("STORIES: trial writing limit reached");
  });

  it("a takedown is refused when the part changed after the review", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's part as the admin reviewed it.");
    gArgs = reviewedTakedown(gId, gSeq, COPYRIGHT, "notice", BOB);
    ownerEdit(BOB, gId, gSeq, "Bob's part after he changed it again.");
    expect(staleTakedown).toThrow();
    errorIs("STORIES: the part changed since you reviewed it; review it again");
    gArgs = reviewedTakedown(gId, gSeq, COPYRIGHT, "notice", BOB);
    expect(staleTakedown).not.toThrow();
  });

  it("the default cap for a new Stories is 6,000", () => {
    reset();
    expect(new Stories().get_config(new stories.get_config_arguments()).contribution_cap).toBe(6000);
  });
});

// Keep the imported helpers referenced (some are used only in a few tests).
export function _unused(): void { writerMonth(); }
