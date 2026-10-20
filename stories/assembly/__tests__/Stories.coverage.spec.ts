// =====================================================================
// Extra Stories coverage. These cases live in their own wasm instance so
// a long run does not have to keep every filled book from the main suite
// alive at once. Behavior under test is unchanged.
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
  allowCalls(1);
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

// ---------- tests ----------

describe("Stories: admin and settings", () => {
  beforeEach(() => { reset(); });
  it("stores every adjustable limit on its lower and upper edge", () => {
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(100, 0, 1, 30, 30));
    checkpoint();
    let cfg = config();
    expect(cfg.contribution_cap).toBe(100);
    expect(cfg.trial_limit).toBe(0);
    expect(cfg.open_limit).toBe(1);
    expect(cfg.archive_days).toBe(30);
    expect(cfg.inactivity_days).toBe(30);
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(4000, 5000, 10, 365, 365));
    checkpoint();
    cfg = config();
    expect(cfg.contribution_cap).toBe(4000);
    expect(cfg.trial_limit).toBe(5000);
    expect(cfg.open_limit).toBe(10);
    expect(cfg.archive_days).toBe(365);
    expect(cfg.inactivity_days).toBe(365);
  });

});

describe("Stories: text cost (UTF-16 rule)", () => {
  beforeEach(() => { reset(); });
  it("treats a missing string as empty text", () => {
    fails(() => { new Stories().quote_cost(new stories.quote_cost_arguments(null)); }, "STORIES: text is empty");
  });

});

describe("Stories: opening", () => {
  beforeEach(() => { reset(); configure(); });
  it("files a new story under both categories", () => {
    authorize(ALICE);
    allowCalls(2);
    const id = new Stories().open_story(new stories.open_story_arguments(
      ALICE, SHORT, "Two tags", 10000, 1, 2, PUBLIC, 0, 0, "Hi", false, 2, USDT, true, 0
    )).value;
    checkpoint();
    const st = story(id);
    expect(st.category_1).toBe(1);
    expect(st.category_2).toBe(2);
    const first = new Stories().get_category_stories(new stories.get_category_stories_arguments(1, 0, 10));
    const second = new Stories().get_category_stories(new stories.get_category_stories_arguments(2, 0, 10));
    expect(first.values.length).toBe(1);
    expect(first.values[0]).toBe(id);
    expect(second.values.length).toBe(1);
    expect(second.values[0]).toBe(id);
  });

  it("lets only invited writers write an unlisted story", () => {
    const id = openAs(ALICE, SHORT, 10000, UNLISTED, "Quiet start.");
    expect(story(id).visibility).toBe(UNLISTED);
    fWho = BOB; fId = id; fText = "A reader found the link"; fExpected = 23;
    fResults = [writer(), okCall()];
    fails(failContribute, "STORIES: only invited writers can write in this story");
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, id, [BOB], true));
    checkpoint();
    writeAsWriter(BOB, id, "A reader found the link");
    expect(segment(id, 2).text).toBe("A reader found the link");
    expect(story(id).contributor_count).toBe(2);
  });

  it("honors an open-project limit of 1", () => {
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 1, 60, 30));
    checkpoint();
    openShort();
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: you already have the maximum number of open projects");
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(1);
    // Bob is a different opener, so Alice's limit does not apply to him.
    openAs(BOB, SHORT, 10000, PUBLIC, "Bob's tale.");
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(BOB)).value).toBe(1);
  });

});

describe("Stories: writing", () => {
  beforeEach(() => { reset(); configure(); openShort(); });
  it("blocks trial writing when the trial limit is 0", () => {
    setLimits(2000, 0);
    expect(config().trial_limit).toBe(0);
    fWho = BOB; fId = 1; fText = "x"; fExpected = 1;
    fResults = [okCall(), promo(true), okCall()];
    fails(failContribute, "STORIES: trial writing limit reached");
    expect(new Stories().get_trial_used(new stories.get_trial_used_arguments(BOB)).value).toBe(0);
    expect(story(1).segment_count).toBe(1);
  });

});

describe("Stories: private stories, allow-list and invites", () => {
  beforeEach(() => {
    reset();
    configure();
    openAs(ALICE, SHORT, 10000, PRIVATE, "Secret start.");
  });
  it("lets the opener and an editor write a private story without an allow-list entry", () => {
    writeAsOpener(1, "Opener continues");
    addEditor(1, CARA);
    authorize(CARA);
    results([writer(), okCall()]);
    new Stories().contribute(new stories.contribute_arguments(CARA, 1, "Editor continues", false, false, 16, true, 0));
    checkpoint();
    expect(segment(1, 2).text).toBe("Opener continues");
    expect(segment(1, 3).text).toBe("Editor continues");
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, ALICE)).value).toBe(false);
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, CARA)).value).toBe(false);
  });

  it("accepts 20 allow-list wallets and refuses 21", () => {
    const many: Uint8Array[] = [];
    for (let i = 0; i < 20; i++) {
      const who = new Uint8Array(25);
      who[0] = <u8>(i + 1);
      many.push(who);
    }
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, many, true));
    checkpoint();
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, many[0])).value).toBe(true);
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, many[19])).value).toBe(true);
    fails(() => {
      const extra: Uint8Array[] = [];
      for (let i = 0; i < 21; i++) {
        const who = new Uint8Array(25);
        who[0] = <u8>(i + 1);
        extra.push(who);
      }
      authorize(ALICE);
      new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, extra, true));
    }, "STORIES: send 1 to 20 wallets per call");
    // The refused call did not remove the wallets already stored.
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, many[0])).value).toBe(true);
  });

  it("accepts invite uses and expiries on the boundary", () => {
    authorize(ALICE);
    const shortCode = new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 1, START + 1)).value;
    checkpoint();
    authorize(ALICE);
    const longCode = new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(1), 1000, START + 365 * DAY)).value;
    checkpoint();
    expect(shortCode).toBe(1);
    expect(longCode).toBe(2);
    const inv = new Stories().get_invite(new stories.get_invite_arguments(1, 2));
    expect(inv.max_uses).toBe(1000);
    expect(inv.uses).toBe(0);
    expect(inv.expires_at).toBe(START + 365 * DAY);
    expect(inv.revoked).toBe(false);
    authorize(BOB);
    new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 1, inviteSig(0, 1, 1)));
    checkpoint();
    expect(new Stories().get_invite(new stories.get_invite_arguments(1, 1)).uses).toBe(1);
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, BOB)).value).toBe(true);
  });

});

describe("Stories: edits, removals and refunds", () => {
  beforeEach(() => {
    reset();
    configure();
    openShort();                       // seq 1, Alice, 17
    writeAsWriter(BOB, 1, chars(100)); // seq 2, Bob, 100
  });
  it("refuses a light edit that would overflow the story, then locks when the edit fills it", () => {
    // 117 used. Fill to 9,990 so Bob's 100-character segment (allowance 20) can grow by 10, not 11.
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(1873));
    expect(story(1).used_chars).toBe(9990);
    expect(story(1).status).toBe(stories.story_status.STATUS_OPEN);
    fWho = ALICE; fId = 1; fSeq = 2; fText = chars(111); fExpected = 111; fResults = [okCall()];
    fails(failEdit, "STORIES: not enough space left in this story");
    expect(segment(1, 2).current_cost).toBe(100);
    edit(ALICE, 1, 2, chars(110));
    const st = story(1);
    expect(st.used_chars).toBe(10000);
    expect(st.status).toBe(stories.story_status.STATUS_LOCKED);
    expect(st.locked_at).toBe(START);
    expect(segment(1, 2).current_cost).toBe(110);
    // Growth inside the allowance does not charge more Ink, so nothing is minted.
    expect(segment(1, 2).charged).toBe(100);
    expect(st.total_refunded).toBe(0);
  });

});

describe("Stories: closing", () => {
  beforeEach(() => { reset(); configure(); });
  it("refuses to close a Book before 100,000 characters", () => {
    openAs(ALICE, BOOK, 100000, PUBLIC, "Chapter one.");
    const st = story(1);
    expect(st.kind).toBe(BOOK);
    expect(st.status).toBe(stories.story_status.STATUS_OPEN);
    expect(st.used_chars).toBe(12);
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: story cannot be closed yet");
    fails(() => { authorize(STORIES); new Stories().admin_take_over(new stories.admin_take_over_arguments(1)); }, "STORIES: story is not ready for an admin finalize");
    expect(story(1).status).toBe(stories.story_status.STATUS_OPEN);
    expect(story(1).locked_at).toBe(0);
  });

});

function edited(seq: u64, text: string): stories.final_item {
  return new stories.final_item(seq, stories.final_mode.FINAL_EDITED, text, <u64>text.length);
}

function dropped(seq: u64): stories.final_item {
  return new stories.final_item(seq, stories.final_mode.FINAL_REMOVED, "", 0);
}

function finalizeAs(who: Uint8Array, id: u64): void {
  authorize(who);
  new Stories().finalize(new stories.finalize_arguments(who, id, "ipfs://bafy-example", pdfHash()));
  checkpoint();
}

// Story 1: seq 1 Alice 17, seq 2 Bob 2000, seq 3 Bob 100 (removed before
// the lock), seq 4-7 Alice 2000/2000/2000/1983. Locked at 10,000.
function lockedStory(): void {
  openShort();
  writeAsWriter(BOB, 1, chars(2000));
  writeAsWriter(BOB, 1, chars(100));
  authorize(ALICE);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 3));
  checkpoint();
  fillShort(1);
}

describe("Stories: admin take-over", () => {
  beforeEach(() => { reset(); configure(); });
  it("sets the lock time when it takes over an open story that is ready to close", () => {
    openAs(ALICE, SHORT, 20000, PUBLIC, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    const before = story(1);
    expect(before.used_chars).toBe(10000);
    expect(before.status).toBe(stories.story_status.STATUS_OPEN);
    expect(before.locked_at).toBe(0);
    fails(() => { authorize(BOB); new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(BOB, 1, true)); }, "STORIES: only the opener may do this");
    fails(() => { authorize(BOB); new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, 1, true)); }, "STORIES: opener has not authorized this");
    authorize(ALICE);
    new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, 1, true));
    checkpoint();
    expect(story(1).admin_finalize_requested).toBe(true);
    authorize(STORIES);
    new Stories().admin_take_over(new stories.admin_take_over_arguments(1));
    checkpoint();
    const st = story(1);
    expect(st.status).toBe(stories.story_status.STATUS_EDITING);
    expect(st.finalizer_is_admin).toBe(true);
    expect(st.locked_at).toBe(START);
  });

});

describe("Stories: archive and revive", () => {
  beforeEach(() => { reset(); configure(); openShort(); });
  it("refuses archive and revive while stories are paused", () => {
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    setTime(START + 90 * DAY);
    fails(() => { new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1)); }, "STORIES: stories are paused");
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(false));
    checkpoint();
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1));
    checkpoint();
    expect(story(1).status).toBe(stories.story_status.STATUS_ARCHIVED);
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    fails(() => { authorize(ALICE); new Stories().revive(new stories.revive_arguments(ALICE, 1)); }, "STORIES: stories are paused");
    expect(story(1).revived).toBe(false);
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(0);
  });

  it("refuses to revive a story that is not archived", () => {
    fails(() => { authorize(ALICE); new Stories().revive(new stories.revive_arguments(new Uint8Array(4), 1)); }, "STORIES: invalid opener address");
    fails(() => { authorize(ALICE); new Stories().revive(new stories.revive_arguments(ALICE, 1)); }, "STORIES: story is not archived");
    expect(story(1).status).toBe(stories.story_status.STATUS_OPEN);
  });

});

describe("Stories: reads", () => {
  beforeEach(() => { reset(); configure(); openShort(); });
  it("pages segments and caps one read at 10", () => {
    writeAsOpener(1, "Second line");
    writeAsOpener(1, "Third line");
    const c = new Stories();
    expect(c.get_segments(new stories.get_segments_arguments(9, 0, 10)).values.length).toBe(0);
    const all = c.get_segments(new stories.get_segments_arguments(1, 0, 0));
    expect(all.values.length).toBe(3);
    expect(all.values[0].text).toBe("Once upon a time.");
    expect(all.values[1].text).toBe("Second line");
    expect(all.values[2].text).toBe("Third line");
    expect(all.values[0].starts_chapter).toBe(true);
    const capped = c.get_segments(new stories.get_segments_arguments(1, 0, 100));
    expect(capped.values.length).toBe(3);
    expect(capped.values[2].text).toBe("Third line");
    const first = c.get_segments(new stories.get_segments_arguments(1, 0, 1));
    expect(first.values.length).toBe(1);
    expect(first.values[0].text).toBe("Once upon a time.");
    const mid = c.get_segments(new stories.get_segments_arguments(1, 2, 1));
    expect(mid.values.length).toBe(1);
    expect(mid.values[0].text).toBe("Second line");
    const tail = c.get_segments(new stories.get_segments_arguments(1, 3, 2));
    expect(tail.values.length).toBe(1);
    expect(tail.values[0].text).toBe("Third line");
    expect(c.get_segments(new stories.get_segments_arguments(1, 4, 5)).values.length).toBe(0);
  });

  it("returns empty reads for missing records and bad addresses", () => {
    const c = new Stories();
    const bad = new Uint8Array(4);
    const missing = c.get_segment(new stories.get_segment_arguments(1, 99));
    expect(missing.text).toBeNull();
    expect(missing.author).toBeNull();
    expect(missing.status).toBe(stories.segment_status.SEGMENT_NONE);
    expect(missing.original_cost).toBe(0);
    expect(c.get_contributor_total(new stories.get_contributor_total_arguments(1, BOB)).value).toBe(0);
    expect(c.get_contributor_total(new stories.get_contributor_total_arguments(1, bad)).value).toBe(0);
    expect(c.get_contributor_total(new stories.get_contributor_total_arguments(1, null)).value).toBe(0);
    expect(c.get_surviving_total(new stories.get_surviving_total_arguments(1, bad)).value).toBe(0);
    expect(c.get_surviving_total(new stories.get_surviving_total_arguments(1, MALLORY)).value).toBe(0);
    expect(c.is_editor(new stories.is_editor_arguments(1, null)).value).toBe(false);
    expect(c.is_editor(new stories.is_editor_arguments(1, bad)).value).toBe(false);
    expect(c.is_allowed(new stories.is_allowed_arguments(1, bad)).value).toBe(false);
    expect(c.is_allowed(new stories.is_allowed_arguments(1, null)).value).toBe(false);
    const inv = c.get_invite(new stories.get_invite_arguments(1, 99));
    expect(inv.max_uses).toBe(0);
    expect(inv.uses).toBe(0);
    expect(inv.revoked).toBe(false);
    expect(inv.link_signer).toBeNull();
    expect(c.get_trial_used(new stories.get_trial_used_arguments(null)).value).toBe(0);
    expect(c.get_trial_used(new stories.get_trial_used_arguments(bad)).value).toBe(0);
    expect(c.get_open_count(new stories.get_open_count_arguments(bad)).value).toBe(0);
    expect(c.get_open_count(new stories.get_open_count_arguments(null)).value).toBe(0);
    const cat = c.get_category(new stories.get_category_arguments(0));
    expect(cat.name).toBeNull();
    expect(cat.active).toBe(false);
    expect(c.get_category(new stories.get_category_arguments(99)).name).toBeNull();
    expect(c.get_opener_stories(new stories.get_opener_stories_arguments(null, 0, 10)).values.length).toBe(0);
    expect(c.get_opener_stories(new stories.get_opener_stories_arguments(bad, 0, 10)).values.length).toBe(0);
    expect(c.get_author_segments(new stories.get_author_segments_arguments(null, 0, 10)).values.length).toBe(0);
    expect(c.get_author_segments(new stories.get_author_segments_arguments(bad, 0, 10)).values.length).toBe(0);
    expect(c.get_category_stories(new stories.get_category_stories_arguments(99, 0, 10)).values.length).toBe(0);
    expect(c.get_story(new stories.get_story_arguments(99)).opener).toBeNull();
  });

  it("caps list reads at 50 and pages from a start index", () => {
    openShort();
    openShort();
    writeAsOpener(1, "More");
    const c = new Stories();
    const byZero = c.get_opener_stories(new stories.get_opener_stories_arguments(ALICE, 0, 0));
    expect(byZero.values.length).toBe(3);
    expect(byZero.values[0]).toBe(1);
    expect(byZero.values[2]).toBe(3);
    expect(c.get_opener_stories(new stories.get_opener_stories_arguments(ALICE, 0, 80)).values.length).toBe(3);
    const openerPage = c.get_opener_stories(new stories.get_opener_stories_arguments(ALICE, 1, 1));
    expect(openerPage.values.length).toBe(1);
    expect(openerPage.values[0]).toBe(2);
    expect(c.get_opener_stories(new stories.get_opener_stories_arguments(ALICE, 3, 10)).values.length).toBe(0);
    const cats = c.get_category_stories(new stories.get_category_stories_arguments(1, 0, 0));
    expect(cats.values.length).toBe(3);
    expect(cats.values[0]).toBe(1);
    const catPage = c.get_category_stories(new stories.get_category_stories_arguments(1, 2, 80));
    expect(catPage.values.length).toBe(1);
    expect(catPage.values[0]).toBe(3);
    // Alice: story 1 opening, story 2 opening, story 3 opening, then story 1 segment 2.
    const authored = c.get_author_segments(new stories.get_author_segments_arguments(ALICE, 0, 0));
    expect(authored.values.length).toBe(4);
    expect(authored.values[0].story_id).toBe(1);
    expect(authored.values[0].seq).toBe(1);
    expect(authored.values[3].story_id).toBe(1);
    expect(authored.values[3].seq).toBe(2);
    const authorPage = c.get_author_segments(new stories.get_author_segments_arguments(ALICE, 1, 1));
    expect(authorPage.values.length).toBe(1);
    expect(authorPage.values[0].story_id).toBe(2);
    expect(authorPage.values[0].seq).toBe(1);
    expect(c.get_author_segments(new stories.get_author_segments_arguments(ALICE, 0, 80)).values.length).toBe(4);
  });

});


describe("Stories: gaps the main suite does not reach", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses an admin-finalize wait past 365 days", () => {
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 366)); }, "STORIES: admin-finalize wait must be 30 to 365 days");
  });

  it("refuses a missing category, a null title, null opening text and bad addresses", () => {
    openShort();
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 0, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: pick an active category");
    fails(() => { tryOpen(new stories.open_story_arguments(ALICE, SHORT, null, 10000, 1, 0, PUBLIC, 0, 0, "Hi", false, 2, USDT, true, 0), twoOk()); }, "STORIES: title must be 1 to 100 characters");
    fails(() => { tryOpen(new stories.open_story_arguments(ALICE, SHORT, "T", 10000, 1, 0, PUBLIC, 0, 0, null, false, 0, USDT, true, 0), twoOk()); }, "STORIES: text is empty");
    fails(() => { tryOpen(new stories.open_story_arguments(ALICE, SHORT, "T", 10000, 1, 0, PUBLIC, 0, 0, "Hi", false, 2, new Uint8Array(3), true, 0), twoOk()); }, "STORIES: invalid token address");
    fails(() => { tryOpen(new stories.open_story_arguments(new Uint8Array(4), SHORT, "T", 10000, 1, 0, PUBLIC, 0, 0, "Hi", false, 2, USDT, true, 0), twoOk()); }, "STORIES: invalid opener address");
  });

  it("refuses updates, invites, close and archive while paused", () => {
    openShort();
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    fails(() => { authorize(ALICE); new Stories().update_story(new stories.update_story_arguments(ALICE, 1, "New", 1, 0, PUBLIC, 0)); }, "STORIES: stories are paused");
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 5, START + DAY)); }, "STORIES: stories are paused");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: stories are paused");
    fails(() => { new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1)); }, "STORIES: stories are paused");
    expect(story(1).status).toBe(stories.story_status.STATUS_OPEN);
    expect(story(1).used_chars).toBe(17);
  });

  it("treats a missing membership read as not a Writer", () => {
    openShort();
    const msg = "STORIES: an active Writer membership is required";
    fWho = BOB; fId = 1; fText = "Hi"; fExpected = 2;
    fResults = [nullCall(), promo(false)];
    fails(failContribute, msg);
    fResults = [nullCall(), nullCall()];
    fails(failContribute, msg);
    expect(new Stories().get_trial_used(new stories.get_trial_used_arguments(BOB)).value).toBe(0);
  });

  it("refuses an unknown invite id", () => {
    openAs(ALICE, SHORT, 10000, PRIVATE, "Hi");
    authorize(ALICE);
    new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 5, START + DAY));
    checkpoint();
    fails(() => { authorize(ALICE); new Stories().revoke_invite(new stories.revoke_invite_arguments(ALICE, 1, 9)); }, "STORIES: unknown invite");
  });

  it("refuses a bad close token and a signer who is not the opener", () => {
    openShort();
    fails(() => { authorize(ALICE); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, new Uint8Array(2))); }, "STORIES: invalid token address");
    fails(() => { authorize(MALLORY); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: opener has not authorized this");
  });
});

describe("Stories: final-pass edges", () => {
  beforeEach(() => { reset(); configure(); lockedStory(); closeAs(ALICE, 1); });

  it("refuses a final batch of 21 items", () => {
    fails(() => {
      const items: stories.final_item[] = [];
      for (let i = 0; i < 21; i++) items.push(keep(1));
      authorize(ALICE);
      allowCalls(1);
      new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, items));
    }, "STORIES: send 1 to 20 items per batch");
  });

  it("refuses allow-list edits after finalize", () => {
    batch(ALICE, 1, [keep(1), keep(2), keep(4), keep(5), keep(6), keep(7)]);
    finalizeAs(ALICE, 1);
    fails(() => { authorize(ALICE); new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [BOB], true)); }, "STORIES: a finalized story cannot be changed");
    fails(() => { authorize(ALICE); new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, CARA, true)); }, "STORIES: a finalized story cannot be changed");
  });
});
