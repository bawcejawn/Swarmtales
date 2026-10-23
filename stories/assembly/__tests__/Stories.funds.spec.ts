// =====================================================================
// Story funds, invite-only writing and the doubling open price.
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
  allowCalls(2);
  const id = new Stories().open_story(new stories.open_story_arguments(
    opener, kind, "My Tale", max, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0
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

function finalizeAs(who: Uint8Array, id: u64): void {
  authorize(who);
  allowCalls(1);
  new Stories().finalize(new stories.finalize_arguments(who, id, "ipfs://bafy-example", pdfHash()));
  checkpoint();
}

// Alice opens a story with a fund: open fee, opening burn, fund burn.
function openFunded(vis: stories.visibility, max: u64, text: string, fund: u64): u64 {
  authorize(ALICE);
  allowCalls(3);
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "Funded", max, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0, fund
  )).value;
  checkpoint();
  return id;
}

function invite(id: u64, who: Uint8Array): void {
  authorize(ALICE);
  new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, id, [who], true));
  checkpoint();
}

function lastOpenFee(): stories.shop_fee_call {
  const list = callsTo(OPEN_FEE_ENTRY);
  expect(list.length > 0).toBe(true);
  return Protobuf.decode<stories.shop_fee_call>(list[list.length - 1].payload!, stories.shop_fee_call.decode);
}

function multiplier(who: Uint8Array): u32 {
  return new Stories().get_open_multiplier(new stories.get_open_multiplier_arguments(who)).value;
}

let fAmount: u64 = 0;
let fVis: stories.visibility = PUBLIC;
function failTopUp(): void {
  authorize(fWho);
  results(fResults);
  new Stories().top_up_fund(new stories.top_up_fund_arguments(fWho, fId, fAmount));
}
function failOpenFunded(): void {
  authorize(ALICE);
  results(fResults);
  new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "Funded", 10000, 1, 0, fVis, 0, 0, fText, false, <u64>fText.length, USDT, true, 0, fAmount
  ));
}

// ---------- tests ----------

describe("Stories: doubling open price", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 10, 60, 30, 0));
    checkpoint();
  });

  it("charges the normal price for 3 open projects, then doubles", () => {
    expect(multiplier(ALICE)).toBe(1);
    openAs(ALICE, SHORT, 10000, PUBLIC, "First tale.");
    expect(lastOpenFee().price_multiplier).toBe(1);
    openAs(ALICE, SHORT, 10000, PUBLIC, "Second tale.");
    openAs(ALICE, SHORT, 10000, PUBLIC, "Third tale.");
    expect(lastOpenFee().price_multiplier).toBe(1);
    expect(multiplier(ALICE)).toBe(2);
    openAs(ALICE, SHORT, 10000, PUBLIC, "Fourth tale.");
    expect(lastOpenFee().price_multiplier).toBe(2);
    expect(multiplier(ALICE)).toBe(4);
    openAs(ALICE, SHORT, 10000, PUBLIC, "Fifth tale.");
    expect(lastOpenFee().price_multiplier).toBe(4);
    // The default ceiling is 4x: the 6th costs the same as the 5th.
    expect(multiplier(ALICE)).toBe(4);
    openAs(ALICE, SHORT, 10000, PUBLIC, "Sixth tale.");
    expect(lastOpenFee().price_multiplier).toBe(4);
    // Bob has nothing open, so he pays the normal price.
    expect(multiplier(BOB)).toBe(1);
  });

  it("lets the admin change how many projects are normal price", () => {
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 10, 60, 30, 1));
    checkpoint();
    expect(config().full_price_projects).toBe(1);
    expect(multiplier(ALICE)).toBe(1);
    openAs(ALICE, SHORT, 10000, PUBLIC, "First tale.");
    expect(multiplier(ALICE)).toBe(2);
    fails(() => {
      authorize(STORIES);
      new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 10, 60, 30, 11));
    }, "STORIES: normal-price projects must be 1 to 10");
    fails(() => {
      authorize(STORIES);
      new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 10, 60, 30, 3, 2000));
    }, "STORIES: the price ceiling must be 1 to 1024 times");
    // A higher ceiling lets the doubling go further.
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 10, 60, 30, 1, 8));
    checkpoint();
    for (let i = 0; i < 4; i++) openAs(ALICE, SHORT, 10000, PUBLIC, "More tales " + i.toString() + ".");
    expect(multiplier(ALICE)).toBe(8);
    expect(config().max_price_multiplier).toBe(8);
  });

  it("stops at the open-project limit", () => {
    for (let i = 0; i < 10; i++) openAs(ALICE, SHORT, 10000, PUBLIC, "Tale number " + i.toString() + ".");
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(10);
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "One too many.", 13, 0), twoOk()); }, "STORIES: you already have the maximum number of open projects");
  });
});

describe("Stories: story funds", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses a fund on a public story", () => {
    fVis = PUBLIC; fText = "Public start."; fAmount = 10000; fResults = [okCall(), okCall(), okCall()];
    fails(failOpenFunded, "STORIES: only unlisted and private stories have a fund");
  });

  it("requires a writers' pool of at least 10,000 Ink for invite-only stories", () => {
    fVis = PRIVATE; fText = "Private start."; fAmount = 0; fResults = [okCall(), okCall(), okCall()];
    fails(failOpenFunded, "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink");
    fVis = UNLISTED; fAmount = 9999;
    fails(failOpenFunded, "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink");
    const id = openFunded(UNLISTED, 10000, "Quiet start.", 10000);
    expect(story(id).fund).toBe(10000);
  });

  it("opens with no fixed size when the size is 0", () => {
    const id = openAs(ALICE, SHORT, 0, PUBLIC, "Open-ended start.");
    expect(story(id).max_chars).toBe(99999);
    const book = openAs(ALICE, BOOK, 0, PUBLIC, "Open-ended book.");
    expect(story(book).max_chars).toBe(1000000);
  });

  it("burns the fund at opening and records it", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 12000);
    const st = story(id);
    expect(st.fund).toBe(12000);
    expect(st.fund_added).toBe(12000);
    expect(st.total_burned).toBe(12000 + 14);
    const burn = lastBurn();
    expect(same(burn.from, ALICE)).toBe(true);
    expect(burn.value).toBe(12000);
    expect(burn.memo).toBe("fund:" + id.toString());
  });

  it("requires an invite and a Writer month for everyone but the opener", () => {
    const id = openFunded(UNLISTED, 20000, "Quiet start.", 10000);
    fWho = BOB; fId = id; fText = "Bob found the link"; fExpected = 18;
    fResults = [writer()];
    fails(failContribute, "STORIES: only invited writers can write in this story");
    invite(id, BOB);
    // No membership, and no promo trial here.
    fResults = [membership(0, 0), promo(true), okCall()];
    fails(failContribute, "STORIES: an active Writer month is required to write in invite-only stories");
    // An expired month does not count either.
    fResults = [membership(2, START - 1), okCall()];
    fails(failContribute, "STORIES: an active Writer month is required to write in invite-only stories");
    writeAsWriter(BOB, id, "Bob was invited in");
    expect(segment(id, 2).fund_paid).toBe(true);
  });

  it("pays parts from the fund until it runs low, then the writer pays", () => {
    const id = openFunded(PRIVATE, 30000, "Private start.", 10010);
    invite(id, BOB);
    const burnsBefore = callsTo(BURN_ENTRY).length;
    for (let i = 0; i < 5; i++) writeAsWriter(BOB, id, chars(2000));
    expect(callsTo(BURN_ENTRY).length).toBe(burnsBefore);
    let st = story(id);
    expect(st.fund).toBe(10);
    expect(st.total_burned).toBe(10010 + 14);
    expect(segment(id, 2).fund_paid).toBe(true);
    expect(contributorTotal(id, BOB)).toBe(10000);
    // 10 left is not enough for 20: Bob pays himself.
    writeAsWriter(BOB, id, "Twenty more chars ok");
    expect(callsTo(BURN_ENTRY).length).toBe(burnsBefore + 1);
    expect(same(lastBurn().from, BOB)).toBe(true);
    st = story(id);
    expect(st.fund).toBe(10);
    expect(st.total_burned).toBe(10010 + 14 + 20);
    expect(segment(id, 7).fund_paid).toBe(false);
    // The opener's own parts can also use the fund.
    writeAsOpener(id, "Ten chars!");
    expect(story(id).fund).toBe(0);
    expect(segment(id, 8).fund_paid).toBe(true);
  });

  it("returns refunds of fund-paid parts to the fund, without minting", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    invite(id, BOB);
    writeAsWriter(BOB, id, "A part paid by the fund");  // 23
    expect(story(id).fund).toBe(9977);
    const mintsBefore = callsTo(MINT_ENTRY).length;
    edit(BOB, id, 2, "Shorter part, by fund");       // 21: 2 back
    expect(story(id).fund).toBe(9979);
    expect(contributorTotal(id, BOB)).toBe(21);
    authorize(BOB);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(BOB, id, 2));
    checkpoint();
    expect(story(id).fund).toBe(10000);
    expect(contributorTotal(id, BOB)).toBe(0);
    expect(callsTo(MINT_ENTRY).length).toBe(mintsBefore);
    expect(story(id).total_refunded).toBe(0);
  });

  it("lets only the opener top up an open, invite-only story", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    fWho = BOB; fId = id; fAmount = 50; fResults = [okCall()];
    fails(failTopUp, "STORIES: only the opener may do this");
    fWho = ALICE; fAmount = 0;
    fails(failTopUp, "STORIES: add at least 1 Ink");
    authorize(ALICE);
    allowCalls(1);
    new Stories().top_up_fund(new stories.top_up_fund_arguments(ALICE, id, 250));
    checkpoint();
    const st = story(id);
    expect(st.fund).toBe(10250);
    expect(st.fund_added).toBe(10250);
    expect(lastBurn().value).toBe(250);
    const pub = openAs(ALICE, SHORT, 10000, PUBLIC, "Public start.");
    fId = pub; fAmount = 50;
    fails(failTopUp, "STORIES: only unlisted and private stories have a fund");
  });

  it("returns the leftover fund to the opener when the story is archived", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10300);
    invite(id, BOB);
    writeAsWriter(BOB, id, "Twenty characters ok");
    setTime(START + 90 * DAY);
    allowCalls(1);
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(id));
    checkpoint();
    const st = story(id);
    expect(st.status).toBe(stories.story_status.STATUS_ARCHIVED);
    expect(st.fund).toBe(0);
    expect(st.total_refunded).toBe(10280);
    const mint = lastMint();
    expect(same(mint.to, ALICE)).toBe(true);
    expect(mint.value).toBe(10280);
    expect(mint.memo).toBe("fund-back:" + id.toString());
    fWho = ALICE; fId = id; fAmount = 5; fResults = [okCall()];
    fails(failTopUp, "STORIES: a fund can only be topped up while the story is open");
  });

  it("closes at the minimum with no fixed size and returns the leftover fund", () => {
    const id = openFunded(PRIVATE, 0, chars(2000), 10500);
    expect(story(id).max_chars).toBe(99999);
    for (let i = 0; i < 4; i++) writeAsOpener(id, chars(2000));
    // 10,000 written: the fund paid 8,000 of it (the opening was paid separately).
    let st = story(id);
    expect(st.used_chars).toBe(10000);
    expect(st.status).toBe(stories.story_status.STATUS_OPEN);
    expect(st.fund).toBe(2500);
    closeAs(ALICE, id);
    const items: stories.final_item[] = [];
    for (let s: u64 = 1; s <= story(id).segment_count; s++) items.push(keep(s));
    batch(ALICE, id, items);
    finalizeAs(ALICE, id);
    st = story(id);
    expect(st.status).toBe(stories.story_status.STATUS_FINALIZED);
    expect(st.fund).toBe(0);
    const mint = lastMint();
    expect(same(mint.to, ALICE)).toBe(true);
    expect(mint.value).toBe(2500);
    expect(mint.memo).toBe("fund-back:" + id.toString());
  });
});

// ---------- audit Lows: AB-010, AB-011, AB-012 ----------

function isAllowed(id: u64, who: Uint8Array): bool {
  return new Stories().is_allowed(new stories.is_allowed_arguments(id, who)).value;
}

function setAllowed(id: u64, who: Uint8Array, allowed: bool): void {
  authorize(ALICE);
  new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, id, [who], allowed));
  checkpoint();
}

describe("Stories: a removed writer cannot rejoin with the same invite (AB-010)", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses the invite after the opener removes the writer, until the opener adds them back", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);   // story 1: the link fixtures' story
    authorize(ALICE);
    new Stories().create_invite(new stories.create_invite_arguments(ALICE, id, Base58.decode(LINK_ADDRESSES[0]), 5, START + DAY));
    checkpoint();
    authorize(BOB);
    new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, id, 1, inviteSig(0, 1, 1)));
    checkpoint();
    expect(isAllowed(id, BOB)).toBe(true);

    setAllowed(id, BOB, false);
    fails(() => {
      authorize(BOB);
      new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 1, inviteSig(0, 1, 1)));
    }, "STORIES: the opener or an editor removed this wallet from the story; only they can add it back");
    expect(isAllowed(id, BOB)).toBe(false);

    setAllowed(id, BOB, true);    // the opener changes their mind
    expect(isAllowed(id, BOB)).toBe(true);
  });

  it("still lets other people join with the same invite", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    authorize(ALICE);
    new Stories().create_invite(new stories.create_invite_arguments(ALICE, id, Base58.decode(LINK_ADDRESSES[0]), 5, START + DAY));
    checkpoint();
    setAllowed(id, BOB, true);
    setAllowed(id, BOB, false);
    authorize(CARA);
    new Stories().join_with_invite(new stories.join_with_invite_arguments(CARA, id, 1, inviteSig(0, 1, 2)));
    checkpoint();
    expect(isAllowed(id, CARA)).toBe(true);
  });
});

describe("Stories: switching to invite-only needs a writers' pool (AB-011)", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses making a public story unlisted or private without a pool", () => {
    openShort();   // story 1, public, no pool
    fails(() => {
      authorize(ALICE);
      new Stories().update_story(new stories.update_story_arguments(ALICE, 1, "My Tale", 1, 0, PRIVATE, 0));
    }, "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink");
    fails(() => {
      authorize(ALICE);
      new Stories().update_story(new stories.update_story_arguments(ALICE, 1, "My Tale", 1, 0, UNLISTED, 0));
    }, "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink");
    expect(story(1).visibility).toBe(PUBLIC);
  });

  it("lets a story with a pool switch between unlisted, private and public", () => {
    const id = openFunded(UNLISTED, 20000, "Quiet start.", 10000);
    authorize(ALICE);
    new Stories().update_story(new stories.update_story_arguments(ALICE, id, "Funded", 1, 0, PRIVATE, 0));
    checkpoint();
    expect(story(id).visibility).toBe(PRIVATE);
    authorize(ALICE);
    new Stories().update_story(new stories.update_story_arguments(ALICE, id, "Funded", 1, 0, PUBLIC, 0));
    checkpoint();
    authorize(ALICE);
    new Stories().update_story(new stories.update_story_arguments(ALICE, id, "Funded", 1, 0, UNLISTED, 0));
    checkpoint();
    expect(story(id).visibility).toBe(UNLISTED);
  });
});

describe("Stories: a part hidden by reports is refunded when the opener removes it (AB-012)", () => {
  beforeEach(() => { reset(); configure(); });

  it("refunds the writer, so reports plus a removal cannot take their Ink", () => {
    const id = openShort();                                          // Alice has written
    const seq = writeAsWriter(BOB, id, "Bob writes an honest scene.");
    writeAsWriter(CARA, id, "Cara writes a line.");
    writeAsWriter(MALLORY, id, "Mallory writes a line.");
    const reporters: Uint8Array[] = [ALICE, CARA, MALLORY];
    for (let i = 0; i < reporters.length; i++) {
      authorize(reporters[i]);
      new Stories().report_segment(new stories.report_segment_arguments(reporters[i], id, seq, stories.moderation_reason.REASON_COPYRIGHT, ""));
      checkpoint();
    }
    expect(segment(id, seq).hidden).toBe(true);

    const before = callsTo(MINT_ENTRY).length;
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, id, seq));
    checkpoint();
    expect(callsTo(MINT_ENTRY).length).toBe(before + 1);
    const mint = lastMint();
    expect(same(mint.to, BOB)).toBe(true);
    expect(mint.value).toBe(27);
  });
});

describe("Stories: the opener's price limit reaches Shop (AB-017)", () => {
  beforeEach(() => { reset(); configure(); });

  it("passes max_price on to Shop's open fee, where the price is checked", () => {
    authorize(ALICE);
    allowCalls(2);
    new Stories().open_story(new stories.open_story_arguments(
      ALICE, SHORT, "My Tale", 10000, 1, 0, PUBLIC, 0, 0, "Once upon a time.", false, 17, USDT, true, 0, 0, "", 10000000
    ));
    checkpoint();
    expect(lastOpenFee().max_price).toBe(10000000);
  });
});
