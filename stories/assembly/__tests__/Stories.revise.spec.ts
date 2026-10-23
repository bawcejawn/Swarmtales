// =====================================================================
// Writing over parts (price doubles each time), versions, and summaries.
// =====================================================================

import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { LINK_ADDRESSES, inviteSig } from "./linkFixtures";

function linkKey(key: i32): Uint8Array {
  return Base58.decode(LINK_ADDRESSES[key]);
}

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // editor
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const ADMIN = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const BURN_ENTRY: u32 = 2241834181;
const MINT_ENTRY: u32 = 3698268091;
const OPEN_FEE_ENTRY: u32 = 547545118;
const CLOSE_FEE_ENTRY: u32 = 3080983189;

const SHORT = stories.story_kind.KIND_SHORT;
const BOOK = stories.story_kind.KIND_BOOK;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const UNLISTED = stories.visibility.VISIBILITY_UNLISTED;
const PRIVATE = stories.visibility.VISIBILITY_PRIVATE;

// ---------- call setup ----------

function checkpoint(): void {
  MockVM.commitTransaction();
}

function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([
    new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true),
  ]);
}

function setTime(at: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0));
}

function okCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0)));
}

function trueCall(): system_calls.exit_arguments {
  const encoded = new Uint8Array(2);
  encoded[0] = 8;
  encoded[1] = 1;
  return new system_calls.exit_arguments(0, new chain.result(encoded));
}

function falseCall(): system_calls.exit_arguments {
  const encoded = new Uint8Array(2);
  encoded[0] = 8;
  encoded[1] = 0;
  return new system_calls.exit_arguments(0, new chain.result(encoded));
}

// A called contract that reverts (exit code 1).
function errorCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(1, new chain.result(null, new chain.error_data("rejected")));
}

// A called contract that succeeds but returns no object at all.
function nullCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(null));
}

function membership(tier: u32, paidUntil: u64): system_calls.exit_arguments {
  const m = new stories.shop_membership(tier, paidUntil, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}

function promo(claimed: bool): system_calls.exit_arguments {
  const m = new stories.uint64(claimed ? 1 : 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.uint64.encode)));
}

function writer(): system_calls.exit_arguments {
  return membership(2, START + 365 * DAY);
}

function results(list: system_calls.exit_arguments[]): void {
  MockVM.setCallContractResults(list);
}

function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  results(list);
}

function calls(): stories.external_call_event[] {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  const out: stories.external_call_event[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].name == "stories.external_call_event") {
      out.push(Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode));
    }
  }
  return out;
}

function callsTo(entry: u32): stories.external_call_event[] {
  const list = calls();
  const out: stories.external_call_event[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].entry_point == entry) out.push(list[i]);
  }
  return out;
}

function lastMint(): stories.ink_mint_call {
  const list = callsTo(MINT_ENTRY);
  expect(list.length > 0).toBe(true);
  const ev = list[list.length - 1];
  expect(same(ev.contract_id, INK)).toBe(true);
  return Protobuf.decode<stories.ink_mint_call>(ev.payload!, stories.ink_mint_call.decode);
}

function lastBurn(): stories.ink_burn_call {
  const list = callsTo(BURN_ENTRY);
  expect(list.length > 0).toBe(true);
  const ev = list[list.length - 1];
  expect(same(ev.contract_id, INK)).toBe(true);
  return Protobuf.decode<stories.ink_burn_call>(ev.payload!, stories.ink_burn_call.decode);
}

function same(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null) return false;
  return Base58.encode(a) == Base58.encode(b);
}

// Filler text of exactly n characters. Each call is different, because a
// story refuses the same exact text twice.
let FILL_COUNTER: i32 = 0;
function chars(n: i32): string {
  FILL_COUNTER++;
  let tag = "";
  let c = FILL_COUNTER;
  while (c > 0) {
    tag += String.fromCharCode(98 + c % 25);
    c = c / 25;
  }
  if (tag.length >= n) return tag.substring(0, n);
  return tag + "a".repeat(n - tag.length);
}

function cost(text: string): u64 {
  return new Stories().quote_cost(new stories.quote_cost_arguments(text)).value;
}

function story(id: u64): stories.story {
  return new Stories().get_story(new stories.get_story_arguments(id));
}

function segment(id: u64, seq: u64): stories.segment {
  return new Stories().get_segment(new stories.get_segment_arguments(id, seq));
}

function contributorTotal(id: u64, who: Uint8Array): u64 {
  return new Stories().get_contributor_total(new stories.get_contributor_total_arguments(id, who)).value;
}

// ---------- actions ----------

function configure(): void {
  authorize(STORIES);
  const c = new Stories();
  c.set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  // These suites check exact Ink arithmetic with short sample texts, so
  // they lower the new-text minimum to 1. The 20-character default is
  // tested on its own in "Stories: security fixes".
  c.set_min_contribution(new stories.set_min_contribution_arguments(1));
  // These suites were written for the original 2,000 per-part cap.
  c.set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  c.add_category(new stories.add_category_arguments("Fantasy"));
  c.add_category(new stories.add_category_arguments("Sci-Fi"));
  c.add_category(new stories.add_category_arguments("Mystery & Thriller"));
  checkpoint();
}

function openAs(opener: Uint8Array, kind: stories.story_kind, max: u64, vis: stories.visibility, text: string): u64 {
  authorize(opener);
  allowCalls(3);
  // Unlisted and private stories need a writers' pool of at least the kind's minimum.
  const pool: u64 = vis == PUBLIC ? 0 : (kind == BOOK ? 100000 : 10000);
  const id = new Stories().open_story(new stories.open_story_arguments(
    opener, kind, "My Tale", max, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0, pool
  )).value;
  checkpoint();
  return id;
}

function openShort(): u64 {
  return openAs(ALICE, SHORT, 10000, PUBLIC, "Once upon a time.");
}

// Opener and editors are not checked for membership: only the burn call.
function writeAsOpener(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

// A writer with an active Writer membership: membership read, then burn.
function writeAsWriter(who: Uint8Array, id: u64, text: string): u64 {
  authorize(who);
  results([writer(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

function addEditor(id: u64, who: Uint8Array): void {
  authorize(ALICE);
  new Stories().set_editor(new stories.set_editor_arguments(ALICE, id, who, true));
  checkpoint();
}

function edit(as: Uint8Array, id: u64, seq: u64, text: string): void {
  authorize(as);
  // Growing the part reads the Writer membership and burns the added letters;
  // shrinking it mints a refund.
  if (<u64>text.length > segment(id, seq).current_cost) results([writer(), okCall()]);
  else allowCalls(1);
  new Stories().edit_segment(new stories.edit_segment_arguments(as, id, seq, text, <u64>text.length));
  checkpoint();
}

// Fill a 10,000 Short Story to the top so it locks.
function fillShort(id: u64): void {
  const st = story(id);
  let left = st.max_chars - st.used_chars;
  while (left > 0) {
    const n: i32 = left > 2000 ? 2000 : <i32>left;
    writeAsOpener(id, chars(n));
    left -= <u64>n;
  }
}

function closeAs(opener: Uint8Array, id: u64): void {
  authorize(opener);
  allowCalls(1);
  new Stories().close_story(new stories.close_story_arguments(opener, id, USDT));
  checkpoint();
}

function batch(as: Uint8Array, id: u64, items: stories.final_item[]): void {
  authorize(as);
  allowCalls(items.length);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(as, id, items));
  checkpoint();
}

function keep(seq: u64): stories.final_item {
  return new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0);
}

function pdfHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(i + 1);
  return h;
}

// expect(() => ...) cannot see test variables, so failing calls read these.
let fId: u64 = 0;
let fSeq: u64 = 0;
let fWho: Uint8Array = new Uint8Array(0);
let fText: string = "";
let fExpected: u64 = 0;
let fCap: u32 = 2000;
let fResults: system_calls.exit_arguments[] = [];

function failContribute(): void {
  authorize(fWho);
  results(fResults);
  new Stories().contribute(new stories.contribute_arguments(fWho, fId, fText, false, false, fExpected, true, 0));
}

function failEdit(): void {
  authorize(fWho);
  results(fResults);
  new Stories().edit_segment(new stories.edit_segment_arguments(fWho, fId, fSeq, fText, fExpected));
}

function failLimits(): void {
  authorize(STORIES);
  new Stories().set_limits(new stories.set_limits_arguments(fCap, 1000, 3, 60, 30));
}


// A failing call leaves the mock VM mid-transaction (the real chain would
// revert it), so roll back after each one. Each failing call sets up its
// own signer and Ink/Shop answers inside the closure, and must fail for
// the exact reason given, so a test cannot pass "by accident".
function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  // The mock keeps one backup; take a fresh one of the restored state.
  MockVM.commitTransaction();
}

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
  checkpoint();
}

function openArgs(opener: Uint8Array, kind: stories.story_kind, max: u64, c1: u32, c2: u32, title: string, text: string, expected: u64, free: u32): stories.open_story_arguments {
  return new stories.open_story_arguments(opener, kind, title, max, c1, c2, PUBLIC, free, 0, text, false, expected, USDT, true, 0);
}

// Alice tries to open with these settings; Shop and Ink answer `answers`.
function tryOpen(args: stories.open_story_arguments, answers: system_calls.exit_arguments[]): void {
  authorize(ALICE);
  results(answers);
  new Stories().open_story(args);
}

function twoOk(): system_calls.exit_arguments[] {
  return [okCall(), okCall()];
}

function setLimits(cap: u32, trial: u32): void {
  authorize(STORIES);
  new Stories().set_limits(new stories.set_limits_arguments(cap, trial, 3, 60, 30));
  checkpoint();
}

function config(): stories.config {
  return new Stories().get_config(new stories.get_config_arguments());
}

const BOB_TEXT = "Bob's first version of this part, plain and simple.";

function reviseAs(who: Uint8Array, seq: u64, text: string, expected: u64): u32 {
  authorize(who);
  results([writer(), okCall(), okCall()]);
  const v = new Stories().revise_part(new stories.revise_part_arguments(who, 1, seq, text, expected, true, 0, "", false)).value;
  checkpoint();
  return v;
}

let fPrice: u64 = 0;
function failRevise(): void {
  authorize(fWho);
  results(fResults);
  new Stories().revise_part(new stories.revise_part_arguments(fWho, fId, fSeq, fText, fPrice, true, 0, "", false));
}
let fSummary: string = "";
function failSummary(): void {
  authorize(fWho);
  new Stories().set_story_summary(new stories.set_story_summary_arguments(fWho, 1, fSummary));
}

// ---------- tests ----------

describe("Stories: changing someone else's part", () => {
  beforeEach(() => { reset(); configure(); openShort(); writeAsWriter(BOB, 1, BOB_TEXT); });

  it("charges 2x the letters added and removed (at least 10), refunds removed letters, and keeps the writer", () => {
    // Delete one letter: "plain" -> "plan". 1 removed, minimum 10, x2 = 20.
    const text = BOB_TEXT.replace("plain", "plan");
    const v = reviseAs(CARA, 2, text, 20);
    expect(v).toBe(2);
    const seg = segment(1, 2);
    expect(same(seg.author, BOB)).toBe(true);
    expect(seg.text).toBe(text);
    expect(same(seg.last_edited_by, CARA)).toBe(true);
    expect(seg.charged).toBe(<u64>BOB_TEXT.length - 1);
    expect(lastBurn().value).toBe(20);
    expect(same(lastBurn().from, CARA)).toBe(true);
    const mint = lastMint();
    expect(same(mint.to, BOB)).toBe(true);
    expect(mint.value).toBe(1);
    const versions = new Stories().get_versions(new stories.get_versions_arguments(1, 2)).values;
    expect(versions.length).toBe(2);
    expect(versions[0].text).toBe(BOB_TEXT);
    expect(versions[1].kind).toBe(2);
    expect(same(versions[1].by, CARA)).toBe(true);
    expect(same(versions[1].author, BOB)).toBe(true);
  });

  it("charges for added letters, and doubles with every paid change to the same part", () => {
    // Add " Cara adds this." (16 letters) at the end: 16 x 2 = 32.
    const t1 = BOB_TEXT + " Cara adds this.";
    reviseAs(CARA, 2, t1, 32);
    expect(contributorTotal(1, CARA)).toBe(16);
    // Next change to the same part: x4. Replace "Cara" with "Dana": 4 removed + 4 added = 8 -> 10 minimum, x4 = 40.
    const t2 = BOB_TEXT + " Dana adds this.";
    fWho = MALLORY; fId = 1; fSeq = 2; fText = t2; fPrice = 20; fResults = [writer(), okCall(), okCall()];
    fails(failRevise, "STORIES: the change price does not match expected_ink (2x the letters added and removed, at least 10, doubling each time)");
    reviseAs(MALLORY, 2, t2, 40);
    // Third change: x8.
    const t3 = t2 + "!";
    reviseAs(CARA, 2, t3, 80);
    expect(segment(1, 2).version_count).toBe(4);
  });

  it("removes a whole part for Ink: empty text refunds the writer everything", () => {
    const price = <u64>BOB_TEXT.length * 2;
    reviseAs(CARA, 2, "", price);
    const seg = segment(1, 2);
    expect(seg.status).toBe(stories.segment_status.SEGMENT_REMOVED);
    expect(lastMint().value).toBe(<u64>BOB_TEXT.length);
    expect(contributorTotal(1, BOB)).toBe(0);
    const versions = new Stories().get_versions(new stories.get_versions_arguments(1, 2)).values;
    expect(versions[0].text).toBe(BOB_TEXT);
    expect(versions[1].kind).toBe(3);
  });

  it("lets only the part's writer edit or remove it for free, even the opener pays", () => {
    fWho = ALICE; fId = 1; fSeq = 2; fText = BOB_TEXT.replace("plain", "plan"); fExpected = <u64>BOB_TEXT.length - 1; fResults = [okCall()];
    fails(failEdit, "STORIES: only the part's writer may edit it for free; others can change it for Ink");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2)); }, "STORIES: only the part's writer may remove it for free; others can remove it for Ink");
    reviseAs(ALICE, 2, BOB_TEXT.replace("plain", "plan"), 20);
    expect(lastBurn().value).toBe(20);
  });

  it("refuses unchanged text and unknown parts", () => {
    fWho = CARA; fId = 1; fSeq = 2; fText = BOB_TEXT; fPrice = 20; fResults = [writer(), okCall(), okCall()];
    fails(failRevise, "STORIES: the text is unchanged");
    fSeq = 9; fText = "Something new and long enough to count.";
    fails(failRevise, "STORIES: unknown segment");
  });
});

describe("Stories: the story so far", () => {
  beforeEach(() => { reset(); configure(); openShort(); writeAsWriter(BOB, 1, BOB_TEXT); });

  it("lets the opener, editors and writers of the story update the summary", () => {
    authorize(BOB);
    new Stories().set_story_summary(new stories.set_story_summary_arguments(BOB, 1, "A ferry, three strangers and a crate of oranges."));
    checkpoint();
    const st = story(1);
    expect(st.summary).toBe("A ferry, three strangers and a crate of oranges.");
    expect(same(st.summary_by, BOB)).toBe(true);
    authorize(ALICE);
    new Stories().set_story_summary(new stories.set_story_summary_arguments(ALICE, 1, ""));
    checkpoint();
    expect(story(1).summary).toBe("");
    fWho = MALLORY; fSummary = "spam";
    fails(failSummary, "STORIES: only the opener, an editor or a current writer of this story may update its summary");
    fWho = BOB; fSummary = "x".repeat(1501);
    fails(failSummary, "STORIES: the summary must be at most 1,500 characters");
  });
});
