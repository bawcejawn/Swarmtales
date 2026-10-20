// =====================================================================
// SwarmTales Stories — tests
//
// These run in the Koinos mock VM on this computer. The mock does not run
// Ink or Shop, so each test presets what those contracts answer (success,
// a "false" answer, or a failure) and then checks the exact bytes Stories
// sent them, which Stories publishes in stories.external_call_event.
// =====================================================================

import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { LINK_ADDRESSES, inviteSig } from "./linkFixtures";

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

// ---------- signed invite links (fix H2) ----------
// Link keys 0..3 and their signatures over (story 1, invite 1..3, wallet)
// come from linkFixtures.ts, made with koilib by scripts/gen-link-fixtures.mjs.

function linkKey(key: i32): Uint8Array {
  return Base58.decode(LINK_ADDRESSES[key]);
}

function who(account: Uint8Array): i32 {
  if (same(account, ALICE)) return 0;
  if (same(account, BOB)) return 1;
  if (same(account, CARA)) return 2;
  return 3;
}

function invite(key: i32, uses: u32, expires: u64): u64 {
  authorize(ALICE);
  const id = new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(key), uses, expires)).value;
  checkpoint();
  return id;
}

// `account` joins invite `inviteId` with a signature from link key `key`, made for wallet `forWho`.
function joinArgs(account: Uint8Array, inviteId: u64, key: i32, forWho: Uint8Array): stories.join_with_invite_arguments {
  return new stories.join_with_invite_arguments(account, 1, inviteId, inviteSig(key, <i32>inviteId, who(forWho)));
}

function config(): stories.config {
  return new Stories().get_config(new stories.get_config_arguments());
}

// ---------- tests ----------

describe("Stories: admin and settings", () => {
  beforeEach(() => { reset(); });

  it("starts with the contract as admin and the default limits", () => {
    const cfg = config();
    expect(same(cfg.admin, STORIES)).toBe(true);
    expect(cfg.contribution_cap).toBe(10000);
    expect(cfg.trial_limit).toBe(1000);
    expect(cfg.open_limit).toBe(3);
    expect(cfg.archive_days).toBe(60);
    expect(cfg.inactivity_days).toBe(30);
    expect(cfg.paused).toBe(false);
  });

  it("refuses every admin action from a stranger", () => {
    const msg = "STORIES: admin authority required";
    fails(() => { authorize(MALLORY); new Stories().set_addresses(new stories.set_addresses_arguments(INK, SHOP)); }, msg);
    fails(() => { authorize(MALLORY); new Stories().set_limits(new stories.set_limits_arguments(4000, 1000, 3, 60, 30)); }, msg);
    fails(() => { authorize(MALLORY); new Stories().add_category(new stories.add_category_arguments("Spam")); }, msg);
    fails(() => { authorize(MALLORY); new Stories().set_category_active(new stories.set_category_active_arguments(1, false)); }, msg);
    fails(() => { authorize(MALLORY); new Stories().set_paused(new stories.set_paused_arguments(true)); }, msg);
    fails(() => { authorize(MALLORY); new Stories().set_admin(new stories.set_admin_arguments(MALLORY)); }, msg);
    fails(() => { authorize(MALLORY); new Stories().admin_take_over(new stories.admin_take_over_arguments(1)); }, msg);
    // No signature at all is refused the same way.
    fails(() => { MockVM.setAuthorities([]); new Stories().set_paused(new stories.set_paused_arguments(true)); }, msg);
  });

  it("hands admin to a new wallet, after which the old one is refused", () => {
    authorize(STORIES);
    new Stories().set_admin(new stories.set_admin_arguments(ADMIN));
    checkpoint();
    expect(same(config().admin, ADMIN)).toBe(true);
    fails(() => { authorize(STORIES); new Stories().set_paused(new stories.set_paused_arguments(true)); }, "STORIES: admin authority required");
    authorize(ADMIN);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    expect(config().paused).toBe(true);
  });

  it("refuses bad Ink and Shop addresses", () => {
    fails(() => { authorize(STORIES); new Stories().set_addresses(new stories.set_addresses_arguments(INK, INK)); }, "STORIES: Ink and Shop must be different contracts");
    fails(() => { authorize(STORIES); new Stories().set_addresses(new stories.set_addresses_arguments(STORIES, SHOP)); }, "STORIES: Ink and Shop cannot be the Stories contract");
    fails(() => { authorize(STORIES); new Stories().set_addresses(new stories.set_addresses_arguments(new Uint8Array(3), SHOP)); }, "STORIES: invalid Ink address");
    fails(() => { authorize(STORIES); new Stories().set_addresses(new stories.set_addresses_arguments(INK, new Uint8Array(0))); }, "STORIES: invalid Shop address");
  });

  it("accepts a per-submission cap from 100 to 10000 and nothing outside", () => {
    setLimits(10000, 1000);
    expect(config().contribution_cap).toBe(10000);
    setLimits(100, 1000);
    expect(config().contribution_cap).toBe(100);
    fCap = 10001;
    fails(failLimits, "STORIES: per-submission cap must be 100 to 10000");
    fCap = 99;
    fails(failLimits, "STORIES: per-submission cap must be 100 to 10000");
  });

  it("refuses other limits outside their ranges", () => {
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 5001, 3, 60, 30)); }, "STORIES: trial limit must be 0 to 5000");
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 0, 60, 30)); }, "STORIES: open-project limit must be 1 to 10");
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 11, 60, 30)); }, "STORIES: open-project limit must be 1 to 10");
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 29, 30)); }, "STORIES: archive period must be 30 to 365 days");
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 366, 30)); }, "STORIES: archive period must be 30 to 365 days");
    fails(() => { authorize(STORIES); new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 29)); }, "STORIES: admin-finalize wait must be 30 to 365 days");
  });

  it("numbers categories, can turn one off, and checks names", () => {
    configure();
    expect(new Stories().get_category(new stories.get_category_arguments(3)).name).toBe("Mystery & Thriller");
    authorize(STORIES);
    new Stories().set_category_active(new stories.set_category_active_arguments(2, false));
    checkpoint();
    expect(new Stories().get_category(new stories.get_category_arguments(2)).active).toBe(false);
    fails(() => { authorize(STORIES); new Stories().add_category(new stories.add_category_arguments("")); }, "STORIES: category name must be 1 to 32 characters");
    fails(() => { authorize(STORIES); new Stories().add_category(new stories.add_category_arguments("a".repeat(33))); }, "STORIES: category name must be 1 to 32 characters");
    fails(() => { authorize(STORIES); new Stories().set_category_active(new stories.set_category_active_arguments(99, true)); }, "STORIES: unknown category");
    // A turned-off category cannot be picked for a new story.
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 2, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: pick an active category");
  });
});

describe("Stories: text cost (UTF-16 rule)", () => {
  beforeEach(() => { reset(); });

  it("charges letters, accents and emoji by UTF-16 code units", () => {
    expect(cost("a")).toBe(1);
    expect(cost("\u00E9")).toBe(1);                       // é, composed
    expect(cost("e\u0301")).toBe(2);                      // é, decomposed
    expect(cost("\uD83D\uDE00")).toBe(2);                 // 😀
    expect(cost("\u2764\uFE0F")).toBe(2);                 // ❤️
    expect(cost("\u2B50")).toBe(1);                       // ⭐
    expect(cost("\uD83D\uDC4D\uD83C\uDFFD")).toBe(4);     // 👍🏽
    expect(cost("\uD83C\uDDFA\uD83C\uDDF8")).toBe(4);     // 🇺🇸
    expect(cost("\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67")).toBe(8); // 👨‍👩‍👧
    expect(cost("Hello, world!")).toBe(13);
    expect(cost("one\ntwo")).toBe(7);
  });

  it("refuses empty, invisible and broken text", () => {
    fails(() => { cost(""); }, "STORIES: text is empty");
    fails(() => { cost("   "); }, "STORIES: text has no visible characters");
    fails(() => { cost("\u00A0\u3000\u200D\uFE0F"); }, "STORIES: text has no visible characters");
    fails(() => { cost("a\u0000b"); }, "STORIES: control characters are not allowed");
    fails(() => { cost("a\tb"); }, "STORIES: control characters are not allowed");
    fails(() => { cost("a\rb"); }, "STORIES: control characters are not allowed");
    fails(() => { cost("a\u0085b"); }, "STORIES: control characters are not allowed");
    fails(() => { cost("a\u200Bb"); }, "STORIES: invisible or direction-control characters are not allowed");
    fails(() => { cost("a\uFEFFb"); }, "STORIES: invisible or direction-control characters are not allowed");
    fails(() => { cost("a\u202Eb"); }, "STORIES: invisible or direction-control characters are not allowed");
    fails(() => { cost("a\u2066b"); }, "STORIES: invisible or direction-control characters are not allowed");
    fails(() => { cost("a\u2028b"); }, "STORIES: invisible or direction-control characters are not allowed");
    fails(() => { cost("a\u2061b"); }, "STORIES: invisible or direction-control characters are not allowed");
    fails(() => { cost("a\uFFFDb"); }, "STORIES: broken character in text");
    fails(() => { cost("a\uD83D"); }, "STORIES: broken character in text");
    fails(() => { cost("a\uDE00b"); }, "STORIES: broken character in text");
    fails(() => { cost("a\uD83Db"); }, "STORIES: broken character in text");
    fails(() => { cost("a\n\n\n\nb"); }, "STORIES: too many line breaks in a row (max 3)");
  });

  it("allows up to 3 line breaks in a row and the joiners real scripts need", () => {
    expect(cost("a\n\n\nb")).toBe(5);
    expect(cost("\u0645\u200C\u0647")).toBe(3);           // ZWNJ in Persian
  });

  it("refuses line breaks and odd characters in titles", () => {
    reset();
    configure();
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "Line\nbreak", "Hi", 2, 0), twoOk()); }, "STORIES: line breaks are not allowed here");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "a".repeat(101), "Hi", 2, 0), twoOk()); }, "STORIES: title must be 1 to 100 characters");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "", "Hi", 2, 0), twoOk()); }, "STORIES: title must be 1 to 100 characters");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "Evil\u202Eeman", "Hi", 2, 0), twoOk()); }, "STORIES: invisible or direction-control characters are not allowed");
  });
});

describe("Stories: opening", () => {
  beforeEach(() => { reset(); configure(); });

  it("opens a Short Story: Shop fee first, then the Ink burn for the opening text", () => {
    const id = openShort();
    expect(id).toBe(1);
    const list = calls();
    expect(list.length).toBe(2);
    expect(same(list[0].contract_id, SHOP)).toBe(true);
    expect(list[0].entry_point).toBe(OPEN_FEE_ENTRY);
    const fee = Protobuf.decode<stories.shop_fee_call>(list[0].payload!, stories.shop_fee_call.decode);
    expect(same(fee.payer, ALICE)).toBe(true);
    expect(fee.kind).toBe(2);
    expect(same(fee.token, USDT)).toBe(true);
    expect(list[1].entry_point).toBe(BURN_ENTRY);
    const burn = lastBurn();
    expect(same(burn.from, ALICE)).toBe(true);
    expect(burn.value).toBe(17);
    expect(burn.reason).toBe(1);
    expect(burn.memo).toBe("s:1:1");
    const st = story(1);
    expect(st.status).toBe(stories.story_status.STATUS_OPEN);
    expect(st.used_chars).toBe(17);
    expect(st.total_burned).toBe(17);
    expect(st.segment_count).toBe(1);
    expect(st.chapter_count).toBe(1);
    expect(st.contributor_count).toBe(1);
    expect(segment(1, 1).text).toBe("Once upon a time.");
    const cat = new Stories().get_category_stories(new stories.get_category_stories_arguments(1, 0, 10));
    expect(cat.values.length).toBe(1);
  });

  it("enforces the size ranges for each kind", () => {
    const shortMsg = "STORIES: a Short Story must be 10,000 to 99,999 characters";
    const bookMsg = "STORIES: a Book must be 100,000 to 1,000,000 characters";
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 9999, 1, 0, "T", "Hi", 2, 0), twoOk()); }, shortMsg);
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 100000, 1, 0, "T", "Hi", 2, 0), twoOk()); }, shortMsg);
    fails(() => { tryOpen(openArgs(ALICE, BOOK, 99999, 1, 0, "T", "Hi", 2, 0), twoOk()); }, bookMsg);
    fails(() => { tryOpen(openArgs(ALICE, BOOK, 1000001, 1, 0, "T", "Hi", 2, 0), twoOk()); }, bookMsg);
    fails(() => { tryOpen(openArgs(ALICE, <stories.story_kind>7, 10000, 1, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: kind must be Book or Short Story");
    const book = openAs(ALICE, BOOK, 100000, PUBLIC, "Chapter one.");
    expect(story(book).kind).toBe(BOOK);
    expect(story(book).max_chars).toBe(100000);
  });

  it("refuses a missing signature, bad settings and a wrong expected_ink", () => {
    fails(() => { authorize(MALLORY); allowCalls(2); new Stories().open_story(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0)); }, "STORIES: opener has not authorized this");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 9, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: pick an active category");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 1, "T", "Hi", 2, 0), twoOk()); }, "STORIES: the two categories must be different");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 9, "T", "Hi", 2, 0), twoOk()); }, "STORIES: second category is not active");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 3, 0), twoOk()); }, "STORIES: Ink cost does not match expected_ink");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 6), twoOk()); }, "STORIES: free chapters must be 0 to 5");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", chars(2001), 2001, 0), twoOk()); }, "STORIES: text is over the per-submission cap");
    fails(() => {
      authorize(ALICE);
      allowCalls(2);
      new Stories().open_story(new stories.open_story_arguments(ALICE, SHORT, "T", 10000, 1, 0, <stories.visibility>9, 0, 0, "Hi", false, 2, USDT, true, 0));
    }, "STORIES: visibility must be Public, Unlisted or Private");
    fails(() => {
      authorize(ALICE);
      allowCalls(2);
      new Stories().open_story(new stories.open_story_arguments(ALICE, SHORT, "T", 10000, 1, 0, PUBLIC, 0, 10001, "Hi", false, 2, USDT, true, 0));
    }, "STORIES: Contributor Edition minimum is above the story size");
  });

  // Both a reverted call and a "false" answer are caught by Stories.
  it("fails the whole open if Shop or Ink fails or answers false", () => {
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), [falseCall()]); }, "STORIES: open fee payment failed");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), [okCall(), falseCall()]); }, "STORIES: Ink burn failed");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), [errorCall()]); }, "STORIES: open fee payment failed");
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), [okCall(), errorCall()]); }, "STORIES: Ink burn failed");
    expect(story(1).opener).toBeNull();
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(0);
  });

  it("accepts a plain 'true' answer from Shop and Ink", () => {
    authorize(ALICE);
    results([trueCall(), trueCall()]);
    const id = new Stories().open_story(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0)).value;
    expect(id).toBe(1);
  });

  it("refuses to open before Ink and Shop are set", () => {
    reset();
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: Ink contract is not set");
  });

  it("limits an opener to 3 open projects", () => {
    openShort();
    openShort();
    openShort();
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: you already have the maximum number of open projects");
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(3);
    const ids = new Stories().get_opener_stories(new stories.get_opener_stories_arguments(ALICE, 0, 10));
    expect(ids.values.length).toBe(3);
    expect(ids.values[2]).toBe(3);
  });

  it("refuses writes while paused but still answers reads", () => {
    openShort();
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    fails(() => { tryOpen(openArgs(ALICE, SHORT, 10000, 1, 0, "T", "Hi", 2, 0), twoOk()); }, "STORIES: stories are paused");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().contribute(new stories.contribute_arguments(ALICE, 1, "More", false, false, 4, true, 0)); }, "STORIES: stories are paused");
    expect(story(1).used_chars).toBe(17);
  });

  it("lets only the opener update settings, without duplicating category lists", () => {
    const id = openShort();
    authorize(ALICE);
    new Stories().update_story(new stories.update_story_arguments(ALICE, id, "New title", 2, 1, PRIVATE, 3));
    checkpoint();
    authorize(ALICE);
    new Stories().update_story(new stories.update_story_arguments(ALICE, id, "New title", 1, 2, PRIVATE, 3));
    checkpoint();
    const st = story(id);
    expect(st.title).toBe("New title");
    expect(st.visibility).toBe(PRIVATE);
    expect(st.free_chapters).toBe(3);
    expect(new Stories().get_category_stories(new stories.get_category_stories_arguments(1, 0, 10)).values.length).toBe(1);
    expect(new Stories().get_category_stories(new stories.get_category_stories_arguments(2, 0, 10)).values.length).toBe(1);
    fails(() => { authorize(MALLORY); new Stories().update_story(new stories.update_story_arguments(MALLORY, 1, "Hacked", 1, 0, PUBLIC, 0)); }, "STORIES: only the opener may do this");
    fails(() => { authorize(MALLORY); new Stories().update_story(new stories.update_story_arguments(ALICE, 1, "Hacked", 1, 0, PUBLIC, 0)); }, "STORIES: opener has not authorized this");
  });
});

describe("Stories: writing", () => {
  beforeEach(() => { reset(); configure(); openShort(); });

  it("lets an active Writer add text, burning exactly its cost from the writer", () => {
    const seq = writeAsWriter(BOB, 1, "Bob writes \uD83D\uDE00");
    expect(seq).toBe(2);
    const burn = lastBurn();
    expect(same(burn.from, BOB)).toBe(true);
    expect(burn.value).toBe(13);
    expect(burn.reason).toBe(1);
    expect(burn.memo).toBe("s:1:2");
    const st = story(1);
    expect(st.used_chars).toBe(30);
    expect(st.contributor_count).toBe(2);
    expect(contributorTotal(1, BOB)).toBe(13);
    const mine = new Stories().get_author_segments(new stories.get_author_segments_arguments(BOB, 0, 10));
    expect(mine.values.length).toBe(1);
    expect(mine.values[0].seq).toBe(2);
    // Writing again does not count Bob twice.
    writeAsWriter(BOB, 1, "Again");
    expect(story(1).contributor_count).toBe(2);
    expect(contributorTotal(1, BOB)).toBe(18);
  });

  it("starts a new chapter only when asked", () => {
    authorize(ALICE);
    allowCalls(1);
    new Stories().contribute(new stories.contribute_arguments(ALICE, 1, "Chapter two", true, true, 11, true, 0));
    checkpoint();
    expect(story(1).chapter_count).toBe(2);
    expect(segment(1, 2).starts_chapter).toBe(true);
    expect(segment(1, 2).ai_assisted).toBe(true);
    writeAsOpener(1, "No new chapter");
    expect(story(1).chapter_count).toBe(2);
  });

  it("allows exactly the cap and refuses one more", () => {
    writeAsWriter(BOB, 1, chars(2000));
    expect(segment(1, 2).original_cost).toBe(2000);
    fWho = BOB; fId = 1; fText = chars(2001); fExpected = 2001; fResults = [writer(), okCall()];
    fails(failContribute, "STORIES: text is over the per-submission cap");
    setLimits(4000, 1000);
    writeAsWriter(BOB, 1, chars(4000));
    fText = chars(4001); fExpected = 4001;
    fails(failContribute, "STORIES: text is over the per-submission cap");
    setLimits(100, 1000);
    fText = chars(101); fExpected = 101;
    fails(failContribute, "STORIES: text is over the per-submission cap");
  });

  it("refuses a wrong expected_ink, an unsigned author and emoji priced wrong", () => {
    fWho = BOB; fId = 1; fResults = [writer(), okCall()];
    fText = "Hello"; fExpected = 4;
    fails(failContribute, "STORIES: Ink cost does not match expected_ink");
    fText = "\uD83D\uDC4D\uD83C\uDFFD"; fExpected = 2;  // 👍🏽 costs 4, not 2
    fails(failContribute, "STORIES: Ink cost does not match expected_ink");
    fails(() => { authorize(MALLORY); results([writer(), okCall()]); new Stories().contribute(new stories.contribute_arguments(BOB, 1, "Hi", false, false, 2, true, 0)); }, "STORIES: author has not authorized this");
    fails(() => { authorize(BOB); results([writer(), okCall()]); new Stories().contribute(new stories.contribute_arguments(BOB, 99, "Hi", false, false, 2, true, 0)); }, "STORIES: unknown story");
  });

  it("requires an active Writer membership, or a claimed promo for the trial", () => {
    const msg = "STORIES: an active Writer membership is required";
    fWho = BOB; fId = 1; fText = "Hi"; fExpected = 2;
    fResults = [okCall(), promo(false)];                         // no membership at all
    fails(failContribute, msg);
    fResults = [membership(1, START + DAY), promo(false)];       // Reader tier
    fails(failContribute, msg);
    fResults = [membership(2, START), promo(false)];             // Writer, expired this second
    fails(failContribute, msg);
    fResults = [membership(2, START - 1), promo(false)];
    fails(failContribute, msg);
    fResults = [errorCall()];
    fails(failContribute, "STORIES: could not read membership");
  });

  it("caps trial writing at the trial limit, and refunds do not restore it", () => {
    authorize(BOB);
    results([okCall(), promo(true), okCall()]);
    new Stories().contribute(new stories.contribute_arguments(BOB, 1, chars(1000), false, false, 1000, true, 0));
    checkpoint();
    expect(new Stories().get_trial_used(new stories.get_trial_used_arguments(BOB)).value).toBe(1000);
    fWho = BOB; fId = 1; fText = "x"; fExpected = 1; fResults = [okCall(), promo(true), okCall()];
    fails(failContribute, "STORIES: trial writing limit reached");
    // Alice removes Bob's trial text; Bob gets his Ink back but not more trial.
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    checkpoint();
    fails(failContribute, "STORIES: trial writing limit reached");
    // A real Writer is not limited by the trial.
    writeAsWriter(BOB, 1, chars(1500));
  });

  it("lets the opener and editors write without a membership read", () => {
    addEditor(1, CARA);
    const before = calls().length;
    authorize(CARA);
    allowCalls(1);       // only the burn
    new Stories().contribute(new stories.contribute_arguments(CARA, 1, "Editor text", false, false, 11, true, 0));
    checkpoint();
    expect(calls().length).toBe(before + 1);
    expect(same(lastBurn().from, CARA)).toBe(true);
  });

  it("fails the contribution if the Ink burn fails or answers false", () => {
    fWho = BOB; fId = 1; fText = "Hi"; fExpected = 2;
    fResults = [writer(), falseCall()];
    fails(failContribute, "STORIES: Ink burn failed");
    fResults = [writer(), errorCall()];
    fails(failContribute, "STORIES: Ink burn failed");
    expect(story(1).segment_count).toBe(1);
    expect(story(1).used_chars).toBe(17);
  });

  it("locks the story when it is full and refuses text that would overflow it", () => {
    fillShort(1);
    const st = story(1);
    expect(st.used_chars).toBe(10000);
    expect(st.status).toBe(stories.story_status.STATUS_LOCKED);
    expect(st.locked_at).toBe(START);
    fWho = ALICE; fId = 1; fText = "x"; fExpected = 1; fResults = [okCall()];
    fails(failContribute, "STORIES: story is not open for writing");
  });

  it("refuses text bigger than the space left", () => {
    // 17 used; fill to 9,990, then 11 characters do not fit.
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(1973));
    expect(story(1).used_chars).toBe(9990);
    fWho = ALICE; fId = 1; fText = chars(11); fExpected = 11; fResults = [okCall()];
    fails(failContribute, "STORIES: not enough space left in this story");
    writeAsOpener(1, chars(10));
    expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
  });
});

describe("Stories: private stories, allow-list and invites", () => {
  beforeEach(() => {
    reset();
    configure();
    openAs(ALICE, SHORT, 10000, PRIVATE, "Secret start.");
  });

  it("refuses writers who are not on the allow-list", () => {
    fWho = BOB; fId = 1; fText = "Hi"; fExpected = 2; fResults = [writer(), okCall()];
    fails(failContribute, "STORIES: this story is private");
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [BOB], true));
    checkpoint();
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, BOB)).value).toBe(true);
    writeAsWriter(BOB, 1, "Hi");
    authorize(ALICE);
    new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [BOB], false));
    checkpoint();
    fails(failContribute, "STORIES: this story is private");
  });

  it("lets editors manage the allow-list but not strangers", () => {
    addEditor(1, CARA);
    authorize(CARA);
    new Stories().set_allowed(new stories.set_allowed_arguments(CARA, 1, [BOB], true));
    checkpoint();
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, BOB)).value).toBe(true);
    fails(() => { authorize(MALLORY); new Stories().set_allowed(new stories.set_allowed_arguments(MALLORY, 1, [MALLORY], true)); }, "STORIES: only the opener or an editor may change the allow-list");
    fails(() => { authorize(MALLORY); new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [MALLORY], true)); }, "STORIES: caller has not authorized this");
    fails(() => { authorize(ALICE); new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [], true)); }, "STORIES: send 1 to 20 wallets per call");
    fails(() => { authorize(ALICE); new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [new Uint8Array(4)], true)); }, "STORIES: invalid wallet address");
  });

  it("limits editors to 10, only the opener appoints them, and not the opener", () => {
    fails(() => { authorize(MALLORY); new Stories().set_editor(new stories.set_editor_arguments(MALLORY, 1, MALLORY, true)); }, "STORIES: only the opener may do this");
    fails(() => { authorize(ALICE); new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, ALICE, true)); }, "STORIES: the opener is already in charge");
    fails(() => { authorize(ALICE); new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, BOB, false)); }, "STORIES: not an editor");
    addEditor(1, CARA);
    fails(() => { authorize(ALICE); new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, CARA, true)); }, "STORIES: already an editor");
    // Appoint up to the limit with fresh addresses.
    for (let i = 0; i < 9; i++) {
      const who = new Uint8Array(25);
      who[0] = 0; who[1] = <u8>(i + 1);
      authorize(ALICE);
      new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, who, true));
      checkpoint();
    }
    expect(story(1).editor_count).toBe(10);
    fails(() => { authorize(ALICE); new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, BOB, true)); }, "STORIES: a story can have at most 10 editors");
    authorize(ALICE);
    new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, CARA, false));
    checkpoint();
    expect(new Stories().is_editor(new stories.is_editor_arguments(1, CARA)).value).toBe(false);
    expect(story(1).editor_count).toBe(9);
  });

  it("joins with a valid signed invite link, counting uses, and refuses the rest", () => {
    const inviteId = invite(0, 2, START + DAY);
    expect(inviteId).toBe(1);
    // Only the public address of the link key is stored.
    const inv = new Stories().get_invite(new stories.get_invite_arguments(1, 1));
    expect(same(inv.link_signer, linkKey(0))).toBe(true);
    // Signed by the wrong link key.
    fails(() => { authorize(BOB); new Stories().join_with_invite(joinArgs(BOB, 1, 1, BOB)); }, "STORIES: invite link rejected");
    // No signature, or a damaged one.
    fails(() => { authorize(BOB); new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 1, new Uint8Array(0))); }, "STORIES: invite link rejected");
    // Someone else's signature for Bob, sent by Mallory's own wallet: Bob did not sign the transaction.
    fails(() => { authorize(MALLORY); new Stories().join_with_invite(joinArgs(BOB, 1, 0, BOB)); }, "STORIES: wallet has not authorized this");
    authorize(BOB);
    new Stories().join_with_invite(joinArgs(BOB, 1, 0, BOB));
    checkpoint();
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, BOB)).value).toBe(true);
    fails(() => { authorize(BOB); new Stories().join_with_invite(joinArgs(BOB, 1, 0, BOB)); }, "STORIES: already on the allow-list");
    authorize(CARA);
    new Stories().join_with_invite(joinArgs(CARA, 1, 0, CARA));
    checkpoint();
    fails(() => { authorize(MALLORY); new Stories().join_with_invite(joinArgs(MALLORY, 1, 0, MALLORY)); }, "STORIES: invite has no uses left");
    writeAsWriter(BOB, 1, "Invited text, long enough.");
  });

  it("will not let a copied invite signature work for a different wallet (front-running)", () => {
    invite(0, 5, START + DAY);
    // Mallory sees Bob's join in the mempool and copies the signature into her own join.
    fails(() => { authorize(MALLORY); new Stories().join_with_invite(joinArgs(MALLORY, 1, 0, BOB)); }, "STORIES: invite link rejected");
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, MALLORY)).value).toBe(false);
    // A signature made for invite 1 does not open invite 2.
    invite(1, 5, START + DAY);
    fails(() => { authorize(BOB); new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 2, inviteSig(0, 1, 1))); }, "STORIES: invite link rejected");
    authorize(BOB);
    new Stories().join_with_invite(joinArgs(BOB, 2, 1, BOB));
    checkpoint();
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, BOB)).value).toBe(true);
  });

  it("refuses expired and revoked invites", () => {
    invite(0, 5, START + DAY);
    invite(1, 5, START + DAY);
    authorize(ALICE);
    new Stories().revoke_invite(new stories.revoke_invite_arguments(ALICE, 1, 2));
    checkpoint();
    fails(() => { authorize(BOB); new Stories().join_with_invite(joinArgs(BOB, 2, 1, BOB)); }, "STORIES: invite was revoked");
    fails(() => { authorize(BOB); new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 9, inviteSig(1, 2, 1))); }, "STORIES: unknown invite");
    setTime(START + DAY);
    fails(() => { authorize(BOB); new Stories().join_with_invite(joinArgs(BOB, 1, 0, BOB)); }, "STORIES: invite has expired");
    fails(() => { authorize(MALLORY); new Stories().revoke_invite(new stories.revoke_invite_arguments(MALLORY, 1, 1)); }, "STORIES: only the opener may do this");
  });

  it("checks invite settings", () => {
    const keyMsg = "STORIES: invite needs a link key address";
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, new Uint8Array(0), 5, START + DAY)); }, keyMsg);
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, new Uint8Array(24), 5, START + DAY)); }, keyMsg);
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 0, START + DAY)); }, "STORIES: invite uses must be 1 to 1000");
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 1001, START + DAY)); }, "STORIES: invite uses must be 1 to 1000");
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 5, START)); }, "STORIES: invite expiry must be in the future");
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 5, START + 366 * DAY)); }, "STORIES: invite expiry can be at most 365 days away");
    fails(() => { authorize(BOB); new Stories().create_invite(new stories.create_invite_arguments(BOB, 1, linkKey(0), 5, START + DAY)); }, "STORIES: only the opener may do this");
  });
});

describe("Stories: edits, removals and refunds", () => {
  beforeEach(() => {
    reset();
    configure();
    openShort();                       // seq 1, Alice, 17
    writeAsWriter(BOB, 1, chars(100)); // seq 2, Bob, 100
  });

  it("refunds a shrinking edit to the author, not the editor", () => {
    addEditor(1, CARA);
    edit(CARA, 1, 2, chars(50));
    const mint = lastMint();
    expect(same(mint.to, BOB)).toBe(true);
    expect(mint.value).toBe(50);
    expect(mint.reason).toBe(5);
    expect(mint.memo).toBe("r:1:2");
    const seg = segment(1, 2);
    expect(seg.charged).toBe(50);
    expect(seg.current_cost).toBe(50);
    expect(same(seg.last_edited_by, CARA)).toBe(true);
    const st = story(1);
    expect(st.used_chars).toBe(67);
    expect(st.total_refunded).toBe(50);
    expect(contributorTotal(1, BOB)).toBe(50);
  });

  it("closes the shrink-then-regrow loophole", () => {
    edit(ALICE, 1, 2, chars(50));          // refund 50, 50 still paid for
    edit(ALICE, 1, 2, chars(70));          // free growth: allowance is 20 of the original 100
    const mintsBefore = callsTo(MINT_ENTRY).length;
    fWho = ALICE; fId = 1; fSeq = 2; fText = chars(71); fExpected = 71; fResults = [okCall()];
    fails(failEdit, "STORIES: edit grows the text too much (light edits only)");
    // Shrinking back to 50 refunds nothing: only 50 was ever left paid.
    edit(ALICE, 1, 2, chars(50));
    expect(callsTo(MINT_ENTRY).length).toBe(mintsBefore);
    expect(segment(1, 2).charged).toBe(50);
    expect(story(1).total_refunded).toBe(50);
    // Shrinking further refunds only what is still paid for.
    edit(ALICE, 1, 2, chars(10));
    expect(lastMint().value).toBe(40);
    expect(story(1).total_refunded).toBe(90);
    // And growth is still measured from what is paid for now (10 + 20).
    fText = chars(31); fExpected = 31;
    fails(failEdit, "STORIES: edit grows the text too much (light edits only)");
    edit(ALICE, 1, 2, chars(30));
  });

  it("does not let a tiny segment be padded by 20", () => {
    writeAsOpener(1, "Hi");                 // seq 3, allowance = 2
    edit(ALICE, 1, 3, "Hiya");
    fWho = ALICE; fId = 1; fSeq = 3; fText = "Hiyaa"; fExpected = 5; fResults = [okCall()];
    fails(failEdit, "STORIES: edit grows the text too much (light edits only)");
  });

  it("only lets the opener or an editor edit, while the story is open", () => {
    fWho = BOB; fId = 1; fSeq = 2; fText = chars(50); fExpected = 50; fResults = [okCall()];
    fails(failEdit, "STORIES: only the opener or an editor may edit");
    fWho = MALLORY;
    fails(failEdit, "STORIES: only the opener or an editor may edit");
    fWho = ALICE; fExpected = 49;
    fails(failEdit, "STORIES: Ink cost does not match expected_cost");
    fExpected = 50; fSeq = 9;
    fails(failEdit, "STORIES: unknown segment");
    fails(() => { authorize(BOB); allowCalls(1); new Stories().remove_segment(new stories.remove_segment_arguments(BOB, 1, 2)); }, "STORIES: only the opener or an editor may remove text");
  });

  it("removes a segment: clears the text, keeps the hash, refunds what was paid", () => {
    const hash = segment(1, 2).text_hash!;
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    checkpoint();
    const seg = segment(1, 2);
    expect(seg.status).toBe(stories.segment_status.SEGMENT_REMOVED);
    expect(seg.text).toBe("");
    expect(seg.charged).toBe(0);
    expect(seg.text_hash!.length).toBe(hash.length);
    const mint = lastMint();
    expect(same(mint.to, BOB)).toBe(true);
    expect(mint.value).toBe(100);
    const st = story(1);
    expect(st.used_chars).toBe(17);
    expect(st.total_refunded).toBe(100);
    expect(st.total_refunded <= st.total_burned).toBe(true);
    expect(contributorTotal(1, BOB)).toBe(0);
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2)); }, "STORIES: segment was already removed");
    fWho = ALICE; fId = 1; fSeq = 2; fText = "x"; fExpected = 1; fResults = [okCall()];
    fails(failEdit, "STORIES: segment was already removed");
  });

  it("keeps total refunds at or below total burned after many edits", () => {
    edit(ALICE, 1, 2, chars(1));
    edit(ALICE, 1, 2, chars(21));
    edit(ALICE, 1, 2, chars(1));
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    checkpoint();
    const st = story(1);
    expect(st.total_refunded).toBe(100);
    expect(st.total_burned).toBe(117);
  });

  it("fails the edit if the refund mint fails or answers false", () => {
    fWho = ALICE; fId = 1; fSeq = 2; fText = chars(50); fExpected = 50;
    fResults = [falseCall()];
    fails(failEdit, "STORIES: Ink refund failed");
    fResults = [errorCall()];
    fails(failEdit, "STORIES: Ink refund failed");
    expect(segment(1, 2).charged).toBe(100);
    expect(story(1).total_refunded).toBe(0);
  });

  it("refuses edits once the story is locked", () => {
    fillShort(1);
    fWho = ALICE; fId = 1; fSeq = 2; fText = chars(50); fExpected = 50; fResults = [okCall()];
    fails(failEdit, "STORIES: text can only be edited while the story is open");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2)); }, "STORIES: text can only be removed while the story is open");
  });
});

describe("Stories: closing", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses to close before the minimum", () => {
    openShort();
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: story cannot be closed yet");
  });

  it("closes an open story at exactly the 10,000 minimum, charging the close fee", () => {
    openAs(ALICE, SHORT, 20000, PUBLIC, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(1999));
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: story cannot be closed yet");
    writeAsOpener(1, "x");
    closeAs(ALICE, 1);
    const list = callsTo(CLOSE_FEE_ENTRY);
    expect(list.length).toBe(1);
    expect(same(list[0].contract_id, SHOP)).toBe(true);
    const fee = Protobuf.decode<stories.shop_fee_call>(list[0].payload!, stories.shop_fee_call.decode);
    expect(same(fee.payer, ALICE)).toBe(true);
    expect(fee.kind).toBe(2);
    const st = story(1);
    expect(st.status).toBe(stories.story_status.STATUS_EDITING);
    expect(st.close_fee_paid).toBe(true);
    expect(st.finalizer_is_admin).toBe(false);
  });

  it("uses the 100-character slack so an almost-full story can close", () => {
    // Max 10,050: 9,960 used is within 100 of the top, 9,940 is not.
    openAs(ALICE, SHORT, 10050, PUBLIC, chars(1960));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(2000));
    writeAsOpener(1, chars(1980));
    expect(story(1).used_chars).toBe(9940);
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: story cannot be closed yet");
    writeAsOpener(1, chars(20));
    expect(story(1).used_chars).toBe(9960);
    closeAs(ALICE, 1);
    expect(story(1).status).toBe(stories.story_status.STATUS_EDITING);
  });

  it("charges the opener the close fee even when the story auto-filled", () => {
    openShort();
    writeAsWriter(BOB, 1, chars(2000));
    fillShort(1);
    expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
    fails(() => { authorize(BOB); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(BOB, 1, USDT)); }, "STORIES: only the opener may do this");
    fails(() => { authorize(ALICE); results([falseCall()]); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: close fee payment failed");
    expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
    closeAs(ALICE, 1);
    const fee = Protobuf.decode<stories.shop_fee_call>(callsTo(CLOSE_FEE_ENTRY)[0].payload!, stories.shop_fee_call.decode);
    expect(same(fee.payer, ALICE)).toBe(true);
  });

  it("refuses new text, edits and invites after closing", () => {
    openShort();
    fillShort(1);
    closeAs(ALICE, 1);
    fWho = ALICE; fId = 1; fText = "x"; fExpected = 1; fResults = [okCall()];
    fails(failContribute, "STORIES: story is not open for writing");
    fWho = ALICE; fSeq = 1;
    fails(failEdit, "STORIES: text can only be edited while the story is open");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT)); }, "STORIES: story cannot be closed yet");
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

describe("Stories: the final edit", () => {
  beforeEach(() => { reset(); configure(); lockedStory(); closeAs(ALICE, 1); });

  it("processes segments in order, skips removed ones, refunds, and finalizes", () => {
    expect(story(1).segment_count).toBe(7);
    batch(ALICE, 1, [keep(1), edited(2, chars(1990))]);
    const mint = lastMint();
    expect(same(mint.to, BOB)).toBe(true);
    expect(mint.value).toBe(10);
    expect(story(1).final_cursor).toBe(3);       // seq 3 was skipped automatically
    expect(segment(1, 3).final_mode).toBe(stories.final_mode.FINAL_REMOVED);
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(3)])); }, "STORIES: items must be in order, starting at the next unprocessed segment");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(5)])); }, "STORIES: items must be in order, starting at the next unprocessed segment");
    fails(() => { authorize(ALICE); new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://x", pdfHash())); }, "STORIES: some segments are not processed yet");
    batch(ALICE, 1, [keep(4), keep(5), keep(6), dropped(7)]);
    expect(lastMint().value).toBe(1983);
    expect(same(lastMint().to, ALICE)).toBe(true);
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(8)])); }, "STORIES: more items than segments");
    finalizeAs(ALICE, 1);
    const st = story(1);
    expect(st.status).toBe(stories.story_status.STATUS_FINALIZED);
    expect(st.pdf_uri).toBe("ipfs://bafy-example");
    expect(st.running_hash!.length).toBe(32);
    expect(st.total_refunded <= st.total_burned).toBe(true);
    expect(new Stories().get_surviving_total(new stories.get_surviving_total_arguments(1, BOB)).value).toBe(1990);
    expect(new Stories().get_surviving_total(new stories.get_surviving_total_arguments(1, ALICE)).value).toBe(6017);
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(0);
  });

  it("only lets the opener finalize after a normal close", () => {
    fails(() => { authorize(BOB); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(BOB, 1, [keep(1)])); }, "STORIES: only the opener may finalize this story");
    fails(() => { authorize(BOB); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(1)])); }, "STORIES: finalizer has not authorized this");
    fails(() => { authorize(STORIES); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(STORIES, 1, [keep(1)])); }, "STORIES: only the opener may finalize this story");
  });

  it("keeps final-pass growth inside the light-edit allowance, and allows big batches", () => {
    // Segment 1 is 17 long: it may grow by 17 at most.
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [edited(1, chars(35))])); }, "STORIES: edit grows the text too much (light edits only)");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [new stories.final_item(1, stories.final_mode.FINAL_PENDING, "", 0)])); }, "STORIES: unknown final mode");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [new stories.final_item(1, stories.final_mode.FINAL_EDITED, "Hi", 3)])); }, "STORIES: Ink cost does not match expected_cost");
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [])); }, "STORIES: send 1 to 20 items per batch");
    batch(ALICE, 1, [edited(1, chars(34))]);
    // The story may now be slightly over its size; that is allowed in the final pass.
    expect(story(1).used_chars).toBe(10017);
    // The batch text limit is now 20,000 (one 10,000-character part fits twice).
    // A 10,000-character story can't reach it, so 8,001 units in one batch pass.
    batch(ALICE, 1, [edited(2, chars(2000)), keep(4), edited(5, chars(2000)), edited(6, chars(2000)), edited(7, chars(2001))]);
    expect(story(1).final_cursor).toBe(7);
  });

  it("checks the PDF link and hash", () => {
    batch(ALICE, 1, [keep(1), keep(2), keep(4), keep(5), keep(6), keep(7)]);
    fails(() => { authorize(ALICE); new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "", pdfHash())); }, "STORIES: PDF link must be 1 to 200 plain characters");
    fails(() => { authorize(ALICE); new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://has space", pdfHash())); }, "STORIES: PDF link must be 1 to 200 plain characters");
    fails(() => { authorize(ALICE); new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://x", new Uint8Array(31))); }, "STORIES: PDF hash must be 32 to 64 bytes");
    fails(() => { authorize(ALICE); new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://x", new Uint8Array(65))); }, "STORIES: PDF hash must be 32 to 64 bytes");
    finalizeAs(ALICE, 1);
  });

  it("freezes a finalized story", () => {
    batch(ALICE, 1, [keep(1), keep(2), keep(4), keep(5), keep(6), keep(7)]);
    finalizeAs(ALICE, 1);
    fails(() => { authorize(ALICE); new Stories().update_story(new stories.update_story_arguments(ALICE, 1, "New", 1, 0, PUBLIC, 0)); }, "STORIES: a finalized story cannot be changed");
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 5, START + DAY)); }, "STORIES: story is not accepting new writers");
    fails(() => { authorize(ALICE); new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, CARA, true)); }, "STORIES: a finalized story cannot be changed");
    fails(() => { authorize(ALICE); new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://x", pdfHash())); }, "STORIES: story is not in the final edit");
    fails(() => { authorize(ALICE); new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, 1, true)); }, "STORIES: story is not active");
  });
});

describe("Stories: admin take-over", () => {
  beforeEach(() => { reset(); configure(); });

  it("is refused for a story that is not ready", () => {
    openShort();
    fails(() => { authorize(STORIES); new Stories().admin_take_over(new stories.admin_take_over_arguments(1)); }, "STORIES: story is not ready for an admin finalize");
  });

  it("waits 30 days of opener inactivity unless the opener asks", () => {
    lockedStory();
    setTime(START + 30 * DAY - 1);
    fails(() => { authorize(STORIES); new Stories().admin_take_over(new stories.admin_take_over_arguments(1)); }, "STORIES: the opener has not asked and has not been inactive long enough");
    setTime(START + 30 * DAY);
    authorize(STORIES);
    new Stories().admin_take_over(new stories.admin_take_over_arguments(1));
    checkpoint();
    const st = story(1);
    expect(st.status).toBe(stories.story_status.STATUS_EDITING);
    expect(st.finalizer_is_admin).toBe(true);
    fails(() => { authorize(ALICE); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(1)])); }, "STORIES: only the admin may finalize this story");
    fails(() => { authorize(STORIES); new Stories().admin_take_over(new stories.admin_take_over_arguments(1)); }, "STORIES: story is not ready for an admin finalize");
  });

  it("acts at once when the opener asks, and survives an admin change", () => {
    lockedStory();
    authorize(ALICE);
    new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, 1, true));
    checkpoint();
    authorize(STORIES);
    new Stories().admin_take_over(new stories.admin_take_over_arguments(1));
    checkpoint();
    authorize(STORIES);
    new Stories().set_admin(new stories.set_admin_arguments(ADMIN));
    checkpoint();
    fails(() => { authorize(STORIES); allowCalls(1); new Stories().submit_final_batch(new stories.submit_final_batch_arguments(STORIES, 1, [keep(1)])); }, "STORIES: only the admin may finalize this story");
    batch(ADMIN, 1, [keep(1), keep(2), keep(4), keep(5), keep(6), keep(7)]);
    finalizeAs(ADMIN, 1);
    expect(story(1).status).toBe(stories.story_status.STATUS_FINALIZED);
  });

  it("can take over a closed story whose opener went quiet", () => {
    lockedStory();
    closeAs(ALICE, 1);
    setTime(START + 31 * DAY);
    authorize(STORIES);
    new Stories().admin_take_over(new stories.admin_take_over_arguments(1));
    checkpoint();
    expect(story(1).finalizer_is_admin).toBe(true);
  });
});

describe("Stories: archive and revive", () => {
  beforeEach(() => { reset(); configure(); openShort(); });

  it("archives after 60 quiet days, then allows one free revive", () => {
    setTime(START + 60 * DAY - 1);
    fails(() => { new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1)); }, "STORIES: story has been active recently");
    setTime(START + 60 * DAY);
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1));
    checkpoint();
    expect(story(1).status).toBe(stories.story_status.STATUS_ARCHIVED);
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(0);
    fWho = ALICE; fId = 1; fText = "x"; fExpected = 1; fResults = [okCall()];
    fails(failContribute, "STORIES: story is not open for writing");
    fails(() => { authorize(ALICE); new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, linkKey(0), 5, START + 61 * DAY)); }, "STORIES: story is not accepting new writers");
    fails(() => { authorize(BOB); new Stories().revive(new stories.revive_arguments(BOB, 1)); }, "STORIES: only the opener may do this");
    authorize(ALICE);
    new Stories().revive(new stories.revive_arguments(ALICE, 1));
    checkpoint();
    expect(story(1).status).toBe(stories.story_status.STATUS_OPEN);
    expect(story(1).revived).toBe(true);
    expect(new Stories().get_open_count(new stories.get_open_count_arguments(ALICE)).value).toBe(1);
    writeAsOpener(1, "Back again");
    setTime(START + 200 * DAY);
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1));
    checkpoint();
    fails(() => { authorize(ALICE); new Stories().revive(new stories.revive_arguments(ALICE, 1)); }, "STORIES: the free revive was already used");
  });

  it("does not revive past the open-project limit", () => {
    setTime(START + 60 * DAY);
    new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1));
    checkpoint();
    openShort();
    openShort();
    openShort();
    fails(() => { authorize(ALICE); new Stories().revive(new stories.revive_arguments(ALICE, 1)); }, "STORIES: you already have the maximum number of open projects");
  });

  it("only archives open stories", () => {
    fillShort(1);
    setTime(START + 90 * DAY);
    fails(() => { new Stories().archive_if_stale(new stories.archive_if_stale_arguments(1)); }, "STORIES: only an open story can be archived");
  });
});
