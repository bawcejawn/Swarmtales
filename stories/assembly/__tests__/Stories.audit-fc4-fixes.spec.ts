// Fourth October fix check: get_versions' size budget (AB-070), the copy
// checker taking over a writer-reports hide (AB-071), and the rules the
// mutation run found untested (AB-075: M1136, M0988, M0065, M0333, M0589).
import { Base58, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, COPYRIGHT, MALLORY, PUBLIC, SHORT, STORIES, USDT, allowCalls, authorize, checkpoint, configure, openPublic,
  ownerEdit, ownerRemove, reset, segment, takedown, write,
} from "./auditFixHelpers";

const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const SEGMENTS_SPACE_ID: u32 = 3;
const CONTRIBUTOR_TOTALS_SPACE_ID: u32 = 7;
const LIVE_PARTS_SPACE_ID: u32 = 30;

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

// What a part and its writer look like when written before parts were counted (AB-066).
function makePreUpgrade(id: u64, seq: u64, who: Uint8Array): void {
  const segs = new Storage.Map<Uint8Array, stories.segment>(STORIES, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
  const key = join(u64Key(id), u64Key(seq));
  const seg = segs.get(key)!;
  seg.live_counted = false;
  segs.put(key, seg);
  const live = new Storage.Map<Uint8Array, stories.uint32>(STORIES, LIVE_PARTS_SPACE_ID, stories.uint32.decode, stories.uint32.encode, null);
  live.remove(join(u64Key(id), who));
  checkpoint();
}
function setTotal(id: u64, who: Uint8Array, value: u64): void {
  const totals = new Storage.Map<Uint8Array, stories.uint64>(STORIES, CONTRIBUTOR_TOTALS_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
  totals.put(join(u64Key(id), who), new stories.uint64(value));
  checkpoint();
}
function summarize(who: Uint8Array, id: u64): void {
  authorize(who);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(who, id, "Bob's lighthouse keeper meets the fog."));
  checkpoint();
}
function moderator(): void {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
}
function report(who: Uint8Array, id: u64, seq: u64): void {
  authorize(who);
  new Stories().report_segment(new stories.report_segment_arguments(who, id, seq, COPYRIGHT, "copied"));
  checkpoint();
}
function hideAs(actor: Uint8Array, id: u64, seq: u64): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, id, seq, true, COPYRIGHT, "copied text"));
  checkpoint();
}

let gId: u64 = 0;
let gSeq: u64 = 0;

describe("get_versions stops at a size budget and says where to go on (AB-070)", () => {
  it("returns two 30,000-byte versions per page, then the rest", () => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(10000, 1000, 3, 60, 30));
    checkpoint();
    authorize(ALICE);
    allowCalls(3);
    const opening = "Once upon a time.";
    gId = new Stories().open_story(new stories.open_story_arguments(
      ALICE, SHORT, "A Long Tale", 50000, 1, 0, PUBLIC, 0, 0, opening, false, <u64>opening.length, USDT, true, 0, 0
    )).value;
    checkpoint();
    // 10,000 three-byte characters: the most bytes a part can hold.
    const base = "中".repeat(9999);
    gSeq = write(BOB, gId, base + "a");
    ownerEdit(BOB, gId, gSeq, base + "b");
    ownerEdit(BOB, gId, gSeq, base + "c");
    ownerEdit(BOB, gId, gSeq, base + "d");
    expect(segment(gId, gSeq).version_count).toBe(4);
    const c = new Stories();
    const first = c.get_versions(new stories.get_versions_arguments(gId, gSeq, 1, 5));
    expect(first.values.length).toBe(2, "60,000 bytes fit, a third version would not");
    expect(first.values[0].version).toBe(1);
    expect(first.next).toBe(3);
    const rest = c.get_versions(new stories.get_versions_arguments(gId, gSeq, first.next, 5));
    expect(rest.values.length).toBe(2);
    expect(rest.values[1].version).toBe(4);
    expect(rest.next).toBe(0, "nothing left");
  });

  it("returns short versions 5 at a time, and always at least one", () => {
    reset(); configure();
    gId = openPublic();
    gSeq = write(BOB, gId, "A short part, version one.");
    for (let i = 2; i <= 7; i++) ownerEdit(BOB, gId, gSeq, "A short part, version " + i.toString() + ".");
    const c = new Stories();
    const page = c.get_versions(new stories.get_versions_arguments(gId, gSeq, 1, 0));
    expect(page.values.length).toBe(5);
    expect(page.next).toBe(6);
    const one = c.get_versions(new stories.get_versions_arguments(gId, gSeq, 7, 1));
    expect(one.values.length).toBe(1);
    expect(one.values[0].version).toBe(7);
    expect(one.next).toBe(0);
  });
});

describe("the copy checker takes over a writer-reports hide (AB-071)", () => {
  beforeEach(() => {
    reset(); configure(); moderator();
    gId = openPublic();
    gSeq = write(BOB, gId, "A copied page that sock writers reported before the checker ran.");
    write(CARA, gId, "Cara's own part of the story.");
    write(MALLORY, gId, "Mallory's own part of the story.");
    report(ALICE, gId, gSeq);
    report(CARA, gId, gSeq);
    report(MALLORY, gId, gSeq);
    expect(segment(gId, gSeq).hidden_by).toBe(1, "precondition: hidden by writer reports");
  });

  it("becomes the checker's hide in place: no refund on removal, and restoring it forfeits the refund", () => {
    hideAs(BOT, gId, gSeq);
    const seg = segment(gId, gSeq);
    expect(seg.hidden).toBe(true);
    expect(seg.hidden_by).toBe(2);
    expect(seg.hidden_by_reports).toBe(false, "removing it refunds nothing now");
    authorize(ALICE);
    new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "I think it is fine"));
    checkpoint();
    expect(segment(gId, gSeq).refund_forfeited).toBe(true);
  });

  it("the moderator still can't take over its own hide or the admin's", () => {
    hideAs(BOT, gId, gSeq);
    expect(() => { hideAs(BOT, gId, gSeq); }).toThrow("its own hide");
    hideAs(STORIES, gId, gSeq);
    expect(segment(gId, gSeq).hidden_by).toBe(3);
    expect(() => { hideAs(BOT, gId, gSeq); }).toThrow("the admin's hide");
  });
});

describe("rules the mutation run found untested (AB-075)", () => {
  beforeEach(() => {
    reset(); configure();
    gId = openPublic();
  });

  it("a citation someone else set stops the automatic strike (M1136)", () => {
    gSeq = write(BOB, gId, "Bob's part, which the opener cites as a quote.");
    authorize(ALICE);
    new Stories().set_citation(new stories.set_citation_arguments(ALICE, gId, gSeq, "From a book Alice named"));
    checkpoint();
    const s = segment(gId, gSeq);
    expect(s.paid_changes).toBe(0, "precondition: no paid change");
    expect(s.other_version).toBe(false, "precondition: no other version");
    expect(() => { takedown(gId, gSeq, new Uint8Array(0)); }).toThrow("the citation by someone else must stop the automatic strike");
  });

  it("a writer with two parts who removes one keeps the summary right (M0988)", () => {
    write(BOB, gId, "Bob's first part.");
    gSeq = write(BOB, gId, "Bob's second part.");
    ownerRemove(BOB, gId, gSeq);
    expect(() => { summarize(BOB, gId); }).not.toThrow("Bob still has a live part");
  });

  it("a pre-upgrade writer with a new part keeps the right after removing an old one (M0065)", () => {
    const old = write(BOB, gId, "Bob's part from before the upgrade.");
    makePreUpgrade(gId, old, BOB);
    write(BOB, gId, "Bob's part after the upgrade.");
    ownerRemove(BOB, gId, old);
    expect(() => { summarize(BOB, gId); }).not.toThrow("Bob's new part is still live");
  });

  it("a pre-upgrade writer goes by an Ink total of at least 1 (M0333, M0589)", () => {
    const old = write(BOB, gId, "Bob's part from before the upgrade.");
    makePreUpgrade(gId, old, BOB);
    setTotal(gId, BOB, 1);
    expect(() => { summarize(BOB, gId); }).not.toThrow("a total of 1 counts");
    setTotal(gId, BOB, 0);
    expect(() => { summarize(BOB, gId); }).toThrow("a total of 0 does not count");
  });
});
