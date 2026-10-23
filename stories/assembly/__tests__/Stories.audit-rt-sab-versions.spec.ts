// =====================================================================
// Red-team (Saboteur) attack tests, SwarmTales fix check @ 42f6af9.
// Version history vs takedown, unversioned text changes, blocked/hidden
// edits, and the story summary. Each test asserts the SAFE behaviour: it
// FAILS while the attack works.
// Setup helpers (imports through strikeAs) copied unchanged from
// Stories.audit-strike.spec.ts lines 20-129.
// Copy into stories/assembly/__tests__/ and run with as-pect.
// =====================================================================
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { reviewedTakedown, ownEditArgs } from "./reviewed";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // another writer
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52"); // a second other writer

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;
const NEEDS_CHOICE = "STORIES: someone other than the writer changed this part; name who gets the strike, or choose no strike";
const NOT_A_CHANGER = "STORIES: strike the part's writer or a wallet that changed it";

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function directly(): void { MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode)); }
function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
function membership(tier: u32, paidUntil: u64): system_calls.exit_arguments {
  const m = new stories.shop_membership(tier, paidUntil, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}
function writer(): system_calls.exit_arguments { return membership(2, START + 365 * DAY); }
function results(list: system_calls.exit_arguments[]): void { MockVM.setCallContractResults(list); }
function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  results(list);
}
function segment(id: u64, seq: u64): stories.segment { return new Stories().get_segment(new stories.get_segment_arguments(id, seq)); }
function strikes(who: Uint8Array): u32 { return new Stories().get_account_status(new stories.get_account_status_arguments(who)).strikes; }

function configure(): void {
  authorize(STORIES);
  const c = new Stories();
  c.set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c.set_min_contribution(new stories.set_min_contribution_arguments(1));
  c.set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  c.add_category(new stories.add_category_arguments("Fantasy"));
  checkpoint();
}
function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  directly();
  checkpoint();
}
function openShort(): u64 {
  authorize(ALICE);
  allowCalls(2);
  const text = "Once upon a time.";
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "My Tale", 10000, 1, 0, PUBLIC, 0, 0, text, false, <u64>text.length, USDT, true, 0
  )).value;
  checkpoint();
  return id;
}
function writeAsWriter(who: Uint8Array, id: u64, text: string): u64 {
  authorize(who);
  results([writer(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}
// What revise_part charges: everything between the common start and the
// common end counts, at least 10, times 2, doubling with every change.
function changePrice(oldText: string, newText: string, paidChanges: u32): u64 {
  let pre = 0;
  const maxPre = min<i32>(oldText.length, newText.length);
  while (pre < maxPre && oldText.charCodeAt(pre) == newText.charCodeAt(pre)) pre++;
  let suf = 0;
  const maxSuf = min<i32>(oldText.length, newText.length) - pre;
  while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) == newText.charCodeAt(newText.length - 1 - suf)) suf++;
  const changed = <u64>(oldText.length - pre - suf + newText.length - pre - suf);
  const units: u64 = changed < 10 ? 10 : changed;
  const changes: u32 = paidChanges; // doubles per earlier paid change
  return units * ((<u64>1) << (<u64>changes + 1));
}
// Someone else changes a part: the paid revise_part.
function change(as: Uint8Array, id: u64, seq: u64, text: string): void {
  const s = segment(id, seq);
  const price = changePrice(s.text != null ? s.text! : "", text, s.paid_changes);
  authorize(as);
  results([writer(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(as, id, seq, text, price, true, 0, "", false));
  checkpoint();
}
function takedownStriking(id: u64, seq: u64, who: Uint8Array): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(id, seq, COPYRIGHT, "notice 2026-002", who));
  checkpoint();
}
function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}

function versions(id: u64, seq: u64): stories.segment_version[] {
  return new Stories().get_versions(new stories.get_versions_arguments(id, seq)).values;
}
function anyVersionHas(id: u64, seq: u64, needle: string): bool {
  const vs = versions(id, seq);
  for (let i = 0; i < vs.length; i++) {
    const t = vs[i].text;
    if (t != null && t!.includes(needle)) return true;
  }
  return false;
}
function ownRemove(as: Uint8Array, id: u64, seq: u64): void {
  authorize(as); allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(as, id, seq));
  checkpoint();
}
function ownEdit(as: Uint8Array, id: u64, seq: u64, text: string): void {
  authorize(as);
  // Growing the part reads the Writer membership and burns the added letters.
  if (<u64>text.length > segment(id, seq).current_cost) results([writer(), okCall()]);
  else allowCalls(1);
  new Stories().edit_segment(ownEditArgs(as, id, seq, text, <u64>text.length));
  checkpoint();
}
function takedownNoStrike(id: u64, seq: u64): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(id, seq, COPYRIGHT, "notice 2026-009", new Uint8Array(0), true));
  checkpoint();
}
// Same length as `like`, so a writer's free light edit always fits.
function sameLength(base: string, like: string): string {
  let out = base;
  while (out.length < like.length) out += ".";
  return out.substring(0, like.length);
}
// Closures cannot capture locals in AssemblyScript: tests pass values through these.
let ID: u64 = 0;
let SEQ: u64 = 0;
let TXT: string = "";

const PLANT = "COPIED NOVEL PAGE: It was the best of times, it was the worst of times";

// ---------------------------------------------------------------------
// RT-SAB-1: taken-down text stays readable through get_versions when the
// part was already removed. takedown_segment wipes versions only inside
// `if (seg.status == SEGMENT_ACTIVE)`; clearSegment keeps version_count,
// and get_versions reads 1..version_count of a removed part.
// ---------------------------------------------------------------------
describe("RT-SAB-1: takedown of a removed part leaves its versions readable", () => {
  beforeEach(() => { reset(); configure(); });

  it("planter's text in a version, then the writer removes the part: the takedown must wipe it", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest paragraph about his town.");
    change(MALLORY, id, seq, PLANT);
    ownRemove(BOB, id, seq);                // Bob cleans up the vandalised part
    expect(anyVersionHas(id, seq, "best of times")).toBe(true);
    takedownStriking(id, seq, MALLORY);     // the notice arrives: the admin takes it down
    expect(segment(id, seq).taken_down).toBe(true);
    expect(anyVersionHas(id, seq, "best of times")).toBe(false,
      "RT-SAB-1: taken-down text is still served by get_versions after a takedown of a removed part");
    expect(versions(id, seq).length).toBe(0, "RT-SAB-1: kept versions survive the takedown");
  });

  it("the planter removes the part herself with an empty revise: the takedown must still wipe the planted version", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest paragraph about his town.");
    change(MALLORY, id, seq, PLANT);
    change(MALLORY, id, seq, "");           // removes the part, keeps v1..v3
    expect(segment(id, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
    takedownNoStrike(id, seq);
    expect(anyVersionHas(id, seq, "best of times")).toBe(false,
      "RT-SAB-1: a planter makes text takedown-proof by removing the part before the notice");
  });
});

// ---------------------------------------------------------------------
// RT-SAB-2: the writer's free edit_segment after someone else's paid change
// is not kept as a version, so the history the admin compares (get_versions,
// printed by deploy.js takedown) ends on the honest changer's clean version
// while the live copied text was put there by the writer.
// ---------------------------------------------------------------------
describe("RT-SAB-2: versions miss the writer's own edit after a revise", () => {
  beforeEach(() => { reset(); configure(); });

  it("the newest kept version matches the live text and names who wrote it", () => {
    const id = openShort();
    const clean = "Bob writes teh calm opening of his own story about the sea.";
    const seq = writeAsWriter(BOB, id, clean);
    // Cara, honest, fixes one typo for Ink.
    change(CARA, id, seq, clean.replace("teh", "the"));
    // Bob swaps the whole part for copied text with a free light edit.
    const bad = sameLength("COPIED: It was the best of times, the worst", clean);
    ownEdit(BOB, id, seq, bad);
    expect(segment(id, seq).text).toBe(bad);
    const vs = versions(id, seq);
    expect(vs.length > 0).toBe(true);
    const last = vs[vs.length - 1];
    expect(last.text).toBe(bad,
      "RT-SAB-2: live text is missing from the version history; the admin sees Cara's clean change last");
    expect(Base58.encode(last.by!)).toBe(Base58.encode(BOB),
      "RT-SAB-2: the last kept version credits Cara for text Bob wrote");
  });
});

// ---------------------------------------------------------------------
// RT-SAB-3: a blocked wallet (strike limit or manual block) still rewrites
// its parts: edit_segment has no requireNotBlocked.
// ---------------------------------------------------------------------
describe("RT-SAB-3: a blocked writer keeps editing", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses edit_segment from a blocked wallet", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes a short scene in the harbour.");
    authorize(STORIES);
    new Stories().set_blocked(new stories.set_blocked_arguments(BOB, true, "repeat infringer"));
    checkpoint();
    ID = id; SEQ = seq; TXT = "Bob writes a short scene in the harbour!";
    expect(() => {
      authorize(BOB); allowCalls(1);
      new Stories().edit_segment(ownEditArgs(BOB, ID, SEQ, TXT, <u64>TXT.length));
    }).toThrow("RT-SAB-3: a blocked wallet can still change its text");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
  });
});

// ---------------------------------------------------------------------
// RT-SAB-4: the writer swaps the text of a part the admin/moderator hid as
// copied, so the evidence (and the takedown fingerprint) is gone before the
// admin acts. edit_segment has no `!seg.hidden` check (revise_part does).
// ---------------------------------------------------------------------
describe("RT-SAB-4: editing a hidden part", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses the writer's free edit while the part is hidden for checking", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes the first page of a novel.");
    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, seq, true, COPYRIGHT, "matched a book"));
    checkpoint();
    ID = id; SEQ = seq; TXT = "Bob writes his own first page, honest.";
    expect(() => {
      authorize(BOB); allowCalls(1);
      new Stories().edit_segment(ownEditArgs(BOB, ID, SEQ, TXT, <u64>TXT.length));
    }).toThrow("RT-SAB-4: the writer rewrites a part hidden as copied before the admin sees it");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
  });
});

// ---------------------------------------------------------------------
// RT-SAB-5: the story summary is outside every moderation tool. Any wallet
// that ever wrote in the story (even one whose only part was taken down:
// its contributorTotals entry stays, at 0) keeps summary rights in every
// status, and the admin cannot clear it.
// ---------------------------------------------------------------------
describe("RT-SAB-5: the story summary", () => {
  beforeEach(() => { reset(); configure(); });

  it("a wallet whose only part was taken down cannot republish it as the summary", () => {
    const id = openShort();
    const seq = writeAsWriter(MALLORY, id, PLANT);
    takedownStriking(id, seq, MALLORY);
    ID = id; TXT = PLANT;
    expect(() => {
      authorize(MALLORY);
      new Stories().set_story_summary(new stories.set_story_summary_arguments(MALLORY, ID, TXT));
    }).toThrow("RT-SAB-5: taken-down text goes straight back on-chain as the story summary");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
  });

  it("the admin can clear a defaced summary", () => {
    const id = openShort();
    writeAsWriter(MALLORY, id, "Mallory writes one honest line here.");
    authorize(MALLORY);
    new Stories().set_story_summary(new stories.set_story_summary_arguments(MALLORY, id, PLANT));
    checkpoint();
    ID = id;
    expect(() => {
      authorize(STORIES);
      new Stories().set_story_summary(new stories.set_story_summary_arguments(STORIES, ID, ""));
    }).not.toThrow("RT-SAB-5: no admin path removes infringing or defaming summary text");
    expect(new Stories().get_story(new stories.get_story_arguments(id)).summary).toBe("",
      "RT-SAB-5: the summary stays readable");
  });
});
