// Tests for the planted bugs the October 2026 mutation run missed (AB-058), and for
// the new rules of the fix (AB-047 version room, AB-048 changer list, AB-049 max_ink,
// AB-053 who hid a part, AB-056 final-edit limit). Each mutant named below makes
// at least one assertion here fail.
//
// M0011 (Shop's reentrancy lock removed) is not covered here: MockVM does not run
// other contracts, so nothing can call back into Shop mid-call. Covering it needs
// a token on the local chain that calls back; the lock is unchanged since the
// audit that last read it.
import { Base58, MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, MALLORY, STORIES, USDT, allowCalls, authorize, changePrice, checkpoint, configure, mintsTo,
  okCall, openPublic, ownerEdit, ownerRemove, reset, results, revise, segment, story, takedown, versions, write, writerMonth,
} from "./auditFixHelpers";

const SEGMENTS_SPACE_ID: u32 = 3;
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)

// AssemblyScript has no closures: values for the expect() callbacks live here.
let gId: u64 = 0;
let gSeq: u64 = 0;
let gText: string = "";
let gInk: u64 = 0;
let gMax: u64 = 0;

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

function u64Key(value: u64): Uint8Array {
  const key = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    key[i] = <u8>(v & 0xff);
    v = v >> 8;
  }
  return key;
}
function pairKey(a: u64, b: u64): Uint8Array {
  const out = new Uint8Array(16);
  const ka = u64Key(a);
  const kb = u64Key(b);
  for (let i = 0; i < 8; i++) { out[i] = ka[i]; out[8 + i] = kb[i]; }
  return out;
}
function setPaidChanges(id: u64, seq: u64, n: u32): void {
  const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
  const seg = segs.get(pairKey(id, seq))!;
  seg.paid_changes = n;
  segs.put(pairKey(id, seq), seg);
  checkpoint();
}

function caraRevises(): void {
  authorize(CARA);
  results([writerMonth(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(CARA, gId, gSeq, gText, gInk, true, 0, "", false));
}
function bobEdits(): void {
  authorize(BOB);
  results([writerMonth(), okCall()]);
  new Stories().edit_segment(new stories.edit_segment_arguments(BOB, gId, gSeq, gText, <u64>gText.length, gMax));
}
function aliceWrites(id: u64, text: string): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0));
  checkpoint();
}
function fillAndClose(id: u64): void {
  for (let i = 0; i < 4; i++) aliceWrites(id, letters(2000));
  const st = story(id);
  aliceWrites(id, letters(<i32>(st.max_chars - st.used_chars)));
  expect(story(id).status).toBe(stories.story_status.STATUS_LOCKED);
  authorize(ALICE);
  new Stories().close_story(new stories.close_story_arguments(ALICE, id, USDT));
  checkpoint();
}
function finalEdit(): void {
  authorize(ALICE);
  allowCalls(2);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, gId, [
    new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED, "", 0),
    new stories.final_item(gSeq, stories.final_mode.FINAL_EDITED, gText, <u64>gText.length),
  ]));
}
function finalPastRemoved(): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, gId, [
    new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED, "", 0),
    new stories.final_item(gSeq, stories.final_mode.FINAL_UNCHANGED, "", 0),
  ]));
}
function aliceRestores(): void {
  authorize(ALICE);
  new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, ""));
}
function hideAs(actor: Uint8Array): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, gId, gSeq, true, COPYRIGHT, "checking"));
  checkpoint();
}
function total(id: u64, who: Uint8Array): u64 {
  return new Stories().get_contributor_total(new stories.get_contributor_total_arguments(id, who)).value;
}
function sameBytes(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null || a.length != b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] != b[i]) return false;
  return true;
}

describe("AB-058: revise_part limits (M0010, M0003, M0022, M0029)", () => {
  beforeEach(() => { reset(); configure(); FILL = 0; });

  it("refuses a change once the part had 60 paid changes, even at a wrapped-around price (M0010)", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's part, changed far too often by now.");
    setPaidChanges(gId, gSeq, 60);
    gText = "Bob's part, changed far too often by now!";
    gInk = 10; // what 10 units times (1 << 61) would be if the shift wrapped
    expect(caraRevises).toThrow("M0010: a 61st paid change was accepted");
    expect(MockVM.getErrorMessage()).toBe("STORIES: changing this part again would cost more Ink than exists");
    MockVM.rollbackTransaction();
    // Without the cap, (1 << 64) wraps to 1 in wasm, so change 64 would cost 10 Ink.
    setPaidChanges(gId, gSeq, 63);
    expect(caraRevises).toThrow("M0010: a change past the cap cost 10 Ink because the price wrapped");
    MockVM.rollbackTransaction();
  });

  it("a change may make the part exactly the per-submission cap, not one letter more (M0003, M0022)", () => {
    gId = openPublic();
    const base = "Bob's opening line of a short part.";
    gSeq = write(BOB, gId, base);
    gText = base + "x".repeat(2001 - base.length);           // cap is 2,000 (configure)
    gInk = changePrice(base, gText, 0);
    expect(caraRevises).toThrow("M0003: a change made the part longer than the cap");
    expect(MockVM.getErrorMessage()).toBe("STORIES: text is over the per-submission cap");
    MockVM.rollbackTransaction();
    gText = base + "x".repeat(2000 - base.length);
    gInk = changePrice(base, gText, 0);
    expect(caraRevises).not.toThrow("M0022: a change to exactly the cap was refused");
    checkpoint();
    expect(segment(gId, gSeq).current_cost).toBe(2000);
  });

  it("a new wallet's first paid change counts it once as a contributor (M0029)", () => {
    const id = openPublic();
    const seq = write(BOB, id, "Bob's part, which Mallory will add to.");
    const before = story(id).contributor_count;
    revise(MALLORY, id, seq, "Bob's part, which Mallory will add to. Mallory did.");
    expect(story(id).contributor_count).toBe(before + 1);
    revise(MALLORY, id, seq, "Bob's part, which Mallory will add to. Mallory did, twice.");
    expect(story(id).contributor_count).toBe(before + 1);
  });
});

describe("AB-058: edit_segment and the final edit (M0014, M0035, M0026)", () => {
  beforeEach(() => { reset(); configure(); FILL = 0; });

  it("the writer can grow their part to exactly the cap, not one letter more (M0014)", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob starts small.");
    gText = "Bob starts small." + "y".repeat(2001 - 17);
    gMax = 2001 - 17;
    expect(bobEdits).toThrow("M0014: the writer's edit went over the cap");
    expect(MockVM.getErrorMessage()).toBe("STORIES: text is over the per-submission cap");
    MockVM.rollbackTransaction();
    gText = "Bob starts small." + "y".repeat(2000 - 17);
    gMax = 2000 - 17;
    expect(bobEdits).not.toThrow();
    checkpoint();
    expect(segment(gId, gSeq).current_cost).toBe(2000);
  });

  it("a shortening final edit lowers charged by the refund (M0035)", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "b".repeat(100));
    fillAndClose(gId);
    const before = mintsTo(BOB);
    gText = "c".repeat(90);
    finalEdit();
    checkpoint();
    expect(segment(gId, gSeq).charged).toBe(90);
    expect(segment(gId, gSeq).surviving).toBe(90);
    expect(mintsTo(BOB) - before).toBe(10);
  });

  it("the final edit folds in at most 50 removed parts per call (M0026)", () => {
    gId = openPublic();
    for (let i = 0; i < 52; i++) {
      const seq = write(BOB, gId, letters(5));
      ownerRemove(BOB, gId, seq);
    }
    fillAndClose(gId);
    gSeq = 54; // the first of Alice's filling parts, after 52 removed ones
    expect(finalPastRemoved).toThrow("M0026: one call folded in more than 50 removed parts");
    expect(MockVM.getErrorMessage()).toBe("STORIES: a long run of removed text is next; call advance_final_cursor first");
    MockVM.rollbackTransaction();
    // Part 1 alone: the call then folds in 50 removed parts, and stops there.
    authorize(ALICE);
    new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, gId, [
      new stories.final_item(1, stories.final_mode.FINAL_UNCHANGED, "", 0),
    ]));
    checkpoint();
    expect(story(gId).final_cursor).toBe(51);
    authorize(ALICE);
    new Stories().advance_final_cursor(new stories.advance_final_cursor_arguments(gId));
    checkpoint();
    expect(story(gId).final_cursor).toBe(53);
  });
});

describe("AB-058: takedown totals (M0030)", () => {
  beforeEach(() => { reset(); configure(); });

  it("a takedown lowers the writer's contributor total by the part", () => {
    const id = openPublic();
    const kept = "Bob keeps this first part of his.";
    const gone = "Bob's second part, the one taken down.";
    write(BOB, id, kept);
    const seq = write(BOB, id, gone);
    expect(total(id, BOB)).toBe(<u64>(kept.length + gone.length));
    takedown(id, seq, BOB);
    expect(total(id, BOB)).toBe(<u64>kept.length);
  });
});

describe("AB-049: max_ink binds what the writer's edit may burn", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses an edit that costs more than the writer agreed to", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, "B".repeat(600));
    revise(CARA, gId, gSeq, "B".repeat(20));   // Cara cuts while Bob's page still shows 600
    gText = "b".repeat(600);
    gMax = 0;                                     // the page showed "Free."
    expect(bobEdits).toThrow("AB-049: the edit burned 580 Ink the page never showed");
    expect(MockVM.getErrorMessage()).toBe("STORIES: this edit now costs more Ink than you agreed to; reload the part and try again");
    MockVM.rollbackTransaction();
    gMax = 580;                                   // reloaded: the page shows the real price
    expect(bobEdits).not.toThrow();
    checkpoint();
    expect(segment(gId, gSeq).current_cost).toBe(600);
  });
});

describe("AB-056: the final edit's limit follows the live length", () => {
  beforeEach(() => { reset(); configure(); FILL = 0; });

  it("lets the finalizer trim a part others grew far past the allowance", () => {
    gId = openPublic();
    const base = "Bob's short part.";
    gSeq = write(BOB, gId, base);                                  // charged 17
    revise(CARA, gId, gSeq, base + " " + "Cara adds a long passage. ".repeat(20));
    fillAndClose(gId);
    const live = <i32>segment(gId, gSeq).current_cost;
    gText = segment(gId, gSeq).text!.substring(0, live - 5);       // shorter, yet far above charged + allowance
    expect(finalEdit).not.toThrow("AB-056: a shortening final edit was refused");
    checkpoint();
    expect(segment(gId, gSeq).current_cost).toBe(<u64>(live - 5));
  });
});

describe("AB-047: the writer's edits after the version room", () => {
  beforeEach(() => { reset(); configure(); });

  it("answers a paid change with one new version, then replaces its own newest", () => {
    gId = openPublic();
    const a = "Bob writes a short scene in the harbour.";
    const b = "Bob writes a short scene in the harbour!";
    gSeq = write(BOB, gId, a);
    for (let i = 0; i < 98; i++) ownerEdit(BOB, gId, gSeq, i % 2 == 0 ? b : a);
    expect(segment(gId, gSeq).version_count).toBe(99);
    revise(CARA, gId, gSeq, "Cara writes a short scene in the harbour.");
    expect(segment(gId, gSeq).version_count).toBe(100);
    ownerEdit(BOB, gId, gSeq, a);                   // answers Cara: a new version
    expect(segment(gId, gSeq).version_count).toBe(101);
    ownerEdit(BOB, gId, gSeq, b);                   // replaces his own newest
    expect(segment(gId, gSeq).version_count).toBe(101);
    const vs = versions(gId, gSeq);
    expect(vs[99].kind).toBe(2, "Cara's change stays on record");
    expect(vs[100].text!).toBe(b);
  });
});

describe("AB-048, AB-053: the changer list and who hid a part", () => {
  beforeEach(() => { reset(); configure(); });

  it("get_changers lists a citation-only changer once, and a paid changer", () => {
    const id = openPublic();
    const seq = write(BOB, id, "Bob's part, which quotes a song.");
    authorize(ALICE);
    new Stories().set_citation(new stories.set_citation_arguments(ALICE, id, seq, "An old song"));
    checkpoint();
    authorize(ALICE);
    new Stories().set_citation(new stories.set_citation_arguments(ALICE, id, seq, "An old song, verse 2"));
    checkpoint();
    revise(CARA, id, seq, "Bob's part, which quotes a song. Cara adds.");
    const list = new Stories().get_changers(new stories.get_changers_arguments(id, seq)).values;
    expect(list.length).toBe(2);
    expect(sameBytes(list[0], ALICE)).toBe(true);
    expect(sameBytes(list[1], CARA)).toBe(true);
  });

  it("records who hid a part; the opener can restore the checker's hide, not the admin's", () => {
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
    gSeq = write(BOB, gId, "Bob's part that the checker flags.");
    hideAs(BOT);
    expect(segment(gId, gSeq).hidden_by).toBe(2);
    expect(aliceRestores).not.toThrow("AB-053: the opener could not restore a part the checker hid");
    checkpoint();
    expect(segment(gId, gSeq).hidden_by).toBe(0);
    hideAs(STORIES);
    expect(segment(gId, gSeq).hidden_by).toBe(3);
    expect(aliceRestores).toThrow("AB-053: the opener restored a part the admin hid");
    MockVM.rollbackTransaction();
    // The moderator may unhide it.
    authorize(BOT);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, gId, gSeq, false, COPYRIGHT, "cleared"));
    checkpoint();
    expect(segment(gId, gSeq).hidden).toBe(false);
  });
});
