// Fixes for the third October fix check (AB-059 to AB-066, AB-046 residual) that the
// audit's proof tests don't cover in MockVM. Each `it` asserts the new rule.
//   AB-059: a takedown decides the strike first and reads no version text.
//   AB-060: get_versions returns at most 5 versions per call (from / count).
//   AB-061/062: only the admin unhides an admin hide; the admin takes over other hides
//           in place; a checker hide the checker undoes itself is refundable again.
//   AB-063: citation-only changers stop 12 beyond the paid changes.
//   AB-066: a current writer owns a live part.
import { Base58, MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, MALLORY, STORIES, authorize, checkpoint, configure, mintsTo, openPublic,
  ownerEdit, ownerRemove, reset, revise, segment, strikes, takedown, versions, write,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator = copy checker
const SEGMENTS_SPACE_ID: u32 = 3;
const VERSIONS_SPACE_ID: u32 = 26;
const LIVE_PARTS_SPACE_ID: u32 = 30;
const BOB_TEXT = "Bob writes a short scene in the harbour, draft 000";

// AssemblyScript has no closures: values for the expect() callbacks live here.
let gId: u64 = 0;
let gSeq: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);

function u64Key(value: u64): Uint8Array {
  const key = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    key[i] = <u8>(v & 0xff);
    v = v >> 8;
  }
  return key;
}
function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  for (let i = 0; i < b.length; i++) out[a.length + i] = b[i];
  return out;
}
function versionKey(id: u64, seq: u64, v: u32): Uint8Array {
  const n = new Uint8Array(4);
  n[0] = <u8>(v >> 24); n[1] = <u8>(v >> 16); n[2] = <u8>(v >> 8); n[3] = <u8>v;
  return join(join(u64Key(id), u64Key(seq)), n);
}
function draft(i: i32): string {
  const n = i.toString();
  return BOB_TEXT.slice(0, BOB_TEXT.length - n.length) + n;
}
function bobEdits(id: u64, seq: u64, count: i32): void {
  for (let i = 1; i <= count; i++) ownerEdit(BOB, id, seq, draft(i));
}
// A kept version by someone else that no flag knows about (the takedown must
// decide from the flags alone and never read versions, AB-059).
function plantVersion(id: u64, seq: u64, v: u32, by: Uint8Array): void {
  const kept = new Storage.Map<Uint8Array, stories.segment_version>(STORIES, VERSIONS_SPACE_ID,
    stories.segment_version.decode, stories.segment_version.encode, null);
  kept.put(versionKey(id, seq, v), new stories.segment_version(v, BOB, "someone else's words", 20, 1, 2, by, "", false));
  checkpoint();
}
function hide(actor: Uint8Array, hidden: bool): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, gId, gSeq, hidden, COPYRIGHT, "checked"));
  checkpoint();
}
function moderatorKey(): void {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
}
function autoTakedown(): void { takedown(gId, gSeq, new Uint8Array(0)); }
function strikeWho(): void { takedown(gId, gSeq, gWho); }
function blockedOpenerAddsEditor(): void {
  authorize(ALICE);
  new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, CARA, true));
}
function blockedOpenerAllows(): void {
  authorize(ALICE);
  new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, gId, [CARA], true));
}
function bobSummary(): void {
  authorize(BOB);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(BOB, gId, "Bob sums it up."));
}
function changers(id: u64, seq: u64): i32 {
  return new Stories().get_changers(new stories.get_changers_arguments(id, seq)).values.length;
}
function wallet(i: i32): Uint8Array {
  const w = new Uint8Array(25);
  for (let j = 0; j < 25; j++) w[j] = MALLORY[j];
  w[3] = <u8>(i + 1);
  w[4] = 0x6b;
  return w;
}

describe("AUDIT fix check 3 fixes", () => {
  beforeEach(() => { reset(); configure(); });

  it("AB-059: a takedown of a part past the old version limit never reads its versions", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    bobEdits(gId, gSeq, 69);
    expect(segment(gId, gSeq).version_count).toBe(70);
    // Only a scan of the version text could find this one.
    plantVersion(gId, gSeq, 2, CARA);
    expect(autoTakedown).not.toThrow("AB-059: the takedown read the writer's versions");
    expect(strikes(BOB)).toBe(1, "the writer of a part nobody else changed gets the strike");
  });

  it("AB-059: past the old limit a named changer is checked against the changer records alone", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    revise(CARA, gId, gSeq, BOB_TEXT + " Cara.");
    bobEdits(gId, gSeq, 61);
    expect(segment(gId, gSeq).version_count > 61).toBe(true);
    gWho = MALLORY;
    expect(strikeWho).toThrow("a wallet that never changed the part can't be struck");
    MockVM.rollbackTransaction();
    gWho = CARA;
    expect(strikeWho).not.toThrow("the recorded changer can be struck");
    expect(strikes(CARA)).toBe(1);
  });

  it("AB-060: get_versions returns at most 5 versions per call, from the version asked for", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    bobEdits(id, seq, 11);
    const c = new Stories();
    const first = c.get_versions(new stories.get_versions_arguments(id, seq)).values;
    expect(first.length).toBe(5);
    expect(first[0].version).toBe(1);
    const next = c.get_versions(new stories.get_versions_arguments(id, seq, 6, 0)).values;
    expect(next.length).toBe(5);
    expect(next[0].version).toBe(6);
    const last = c.get_versions(new stories.get_versions_arguments(id, seq, 11, 9)).values;
    expect(last.length).toBe(2);
    expect(last[1].version).toBe(12);
    const two = c.get_versions(new stories.get_versions_arguments(id, seq, 3, 2)).values;
    expect(two.length).toBe(2);
    expect(two[0].version).toBe(3);
    expect(versions(id, seq).length).toBe(12, "paging reads every version");
  });

  it("AB-046: a blocked opener can't add editors or change the allow-list", () => {
    gId = openPublic();
    authorize(STORIES);
    new Stories().set_blocked(new stories.set_blocked_arguments(ALICE, true, "repeated takedowns"));
    checkpoint();
    expect(blockedOpenerAddsEditor).toThrow("AB-046: a blocked opener added an editor");
    MockVM.rollbackTransaction();
    expect(blockedOpenerAllows).toThrow("AB-046: a blocked opener changed the allow-list");
    MockVM.rollbackTransaction();
  });

  it("AB-061: the admin can still unhide its own hide", () => {
    moderatorKey();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    hide(STORIES, true);
    expect(segment(gId, gSeq).hidden_by).toBe(3);
    hide(STORIES, false);
    expect(segment(gId, gSeq).hidden).toBe(false);
  });

  it("AB-062: a part the checker hid and unhid itself is refunded in full when removed", () => {
    moderatorKey();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    hide(BOT, true);
    hide(BOT, false);
    const before = mintsTo(BOB);
    ownerRemove(BOB, gId, gSeq);
    expect(mintsTo(BOB) - before).toBe(<u64>BOB_TEXT.length);
  });

  it("AB-062: after the opener restores a checker hide, a cut gives no Ink back either", () => {
    moderatorKey();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    authorize(ALICE);
    new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, BOB, true));
    checkpoint();
    hide(BOT, true);
    authorize(BOB);
    new Stories().restore_segment(new stories.restore_segment_arguments(BOB, gId, gSeq, "mine"));
    checkpoint();
    expect(segment(gId, gSeq).refund_forfeited).toBe(true);
    const before = mintsTo(BOB);
    ownerEdit(BOB, gId, gSeq, "Bob cuts it all down");
    ownerRemove(BOB, gId, gSeq);
    expect(mintsTo(BOB) - before).toBe(0, "AB-062: a cut refunded Ink after the writer undid the checker's hide");
  });

  it("AB-062: the admin takes over a hide writer reports made, and removal then refunds nothing", () => {
    moderatorKey();
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    write(CARA, gId, "Cara writes the next part of the tale.");
    write(MALLORY, gId, "Mallory writes another part of the tale.");
    const reporters: Uint8Array[] = [ALICE, CARA, MALLORY];
    for (let i = 0; i < reporters.length; i++) {
      authorize(reporters[i]);
      new Stories().report_segment(new stories.report_segment_arguments(reporters[i], gId, gSeq, COPYRIGHT, "copied"));
      checkpoint();
    }
    expect(segment(gId, gSeq).hidden_by).toBe(1, "precondition: writer reports hid it");
    hide(STORIES, true);
    expect(segment(gId, gSeq).hidden_by).toBe(3);
    const before = mintsTo(BOB);
    ownerRemove(BOB, gId, gSeq);
    expect(mintsTo(BOB) - before).toBe(0);
  });

  it("AB-063: citation-only changers stop 12 beyond the paid changes; a paid changer is still recorded", () => {
    const id = openPublic();
    const seq = write(BOB, id, BOB_TEXT);
    for (let i = 0; i < 15; i++) {
      const w = wallet(i);
      authorize(ALICE);
      new Stories().set_editor(new stories.set_editor_arguments(ALICE, id, w, true));
      checkpoint();
      authorize(w);
      new Stories().set_citation(new stories.set_citation_arguments(w, id, seq, "Quoted from source " + i.toString()));
      checkpoint();
      authorize(ALICE);
      new Stories().set_editor(new stories.set_editor_arguments(ALICE, id, w, false));
      checkpoint();
    }
    expect(changers(id, seq)).toBe(12);
    revise(CARA, id, seq, BOB_TEXT + " Cara.");
    expect(changers(id, seq)).toBe(13, "a paid changer always fits");
    expect(segment(id, seq).edited_by_others).toBe(true);
  });

  it("AB-066: a writer keeps summary rights while a part of theirs is live, and loses them after", () => {
    gId = openPublic();
    gSeq = write(BOB, gId, BOB_TEXT);
    expect(bobSummary).not.toThrow("a writer with a live part may update the summary");
    checkpoint();
    ownerRemove(BOB, gId, gSeq);
    expect(bobSummary).toThrow("AB-066: no part of Bob's is left in the story");
    MockVM.rollbackTransaction();
  });
});
