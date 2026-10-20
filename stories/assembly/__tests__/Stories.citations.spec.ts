// =====================================================================
// Citations, the checker's source notes, and restoring hidden parts.
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

const BOT = MALLORY; // stands in for the moderator wallet

function setModerator(): void {
  authorize(STORIES);
  new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 3));
  checkpoint();
}

function writeCited(who: Uint8Array, id: u64, text: string, citation: string): u64 {
  authorize(who);
  results([writer(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0, 0, false, citation)).value;
  checkpoint();
  return seq;
}

function hideAs(id: u64, seq: u64): void {
  authorize(BOT);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, id, seq, true, stories.moderation_reason.REASON_COPYRIGHT, "found in a book"));
  checkpoint();
}

let fCitation: string = "";
function failCite(): void {
  authorize(fWho);
  new Stories().set_citation(new stories.set_citation_arguments(fWho, fId, fSeq, fCitation));
}
function failNote(): void {
  authorize(fWho);
  new Stories().set_source_note(new stories.set_source_note_arguments(fWho, fId, fSeq, fCitation));
}
function failRestore(): void {
  authorize(fWho);
  new Stories().restore_segment(new stories.restore_segment_arguments(fWho, fId, fSeq, ""));
}
function failCitedWrite(): void {
  authorize(BOB);
  results([writer(), okCall()]);
  new Stories().contribute(new stories.contribute_arguments(BOB, 1, "A quoted line goes here.", false, false, 24, true, 0, 0, false, fCitation));
}

// ---------- tests ----------

describe("Stories: citations", () => {
  beforeEach(() => { reset(); configure(); openShort(); });

  it("stores a writer's citation with the part, and refuses one over 200 characters", () => {
    const seq = writeCited(BOB, 1, "It is a truth universally acknowledged, she wrote.", "Pride and Prejudice, Jane Austen");
    expect(segment(1, seq).citation).toBe("Pride and Prejudice, Jane Austen");
    expect(segment(1, 1).citation).toBe("");
    fCitation = "x".repeat(201);
    fails(failCitedWrite, "STORIES: a citation must be at most 200 characters");
  });

  it("lets the writer, the opener or an editor set a citation later, and nobody else", () => {
    const seq = writeAsWriter(BOB, 1, "A line from somewhere else entirely.");
    authorize(BOB);
    new Stories().set_citation(new stories.set_citation_arguments(BOB, 1, seq, "The Sea, A. Writer"));
    checkpoint();
    expect(segment(1, seq).citation).toBe("The Sea, A. Writer");
    authorize(ALICE);
    new Stories().set_citation(new stories.set_citation_arguments(ALICE, 1, seq, "The Sea (1999), A. Writer"));
    checkpoint();
    expect(segment(1, seq).citation).toBe("The Sea (1999), A. Writer");
    addEditor(1, CARA);
    authorize(CARA);
    new Stories().set_citation(new stories.set_citation_arguments(CARA, 1, seq, ""));
    checkpoint();
    expect(segment(1, seq).citation).toBe("");
    fWho = MALLORY; fId = 1; fSeq = seq; fCitation = "spam";
    fails(failCite, "STORIES: only the part's writer, the opener or an editor may do this");
    fWho = BOB; fCitation = "y".repeat(201);
    fails(failCite, "STORIES: a citation must be at most 200 characters");
  });
});

describe("Stories: source notes and restoring", () => {
  beforeEach(() => { reset(); configure(); setModerator(); openShort(); });

  it("lets the moderator add a source note without hiding the part", () => {
    const seq = writeAsWriter(BOB, 1, "Some text that also appears in a book.");
    authorize(BOT);
    new Stories().set_source_note(new stories.set_source_note_arguments(BOT, 1, seq, "Parts also appear in The Sea by A. Writer"));
    checkpoint();
    const seg = segment(1, seq);
    expect(seg.source_note).toBe("Parts also appear in The Sea by A. Writer");
    expect(seg.hidden).toBe(false);
    fWho = BOB; fId = 1; fSeq = seq; fCitation = "not a source";
    fails(failNote, "STORIES: only the admin or the moderator may do this");
  });

  it("lets the opener or an editor restore a hidden part, and nobody else", () => {
    const seq = writeAsWriter(BOB, 1, "Text the checker thought was copied.");
    hideAs(1, seq);
    expect(story(1).hidden_count).toBe(1);
    fWho = BOB; fId = 1; fSeq = seq;
    fails(failRestore, "STORIES: only the opener or an editor may do this");
    authorize(ALICE);
    new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, 1, seq, "the writer showed it's theirs"));
    checkpoint();
    let seg = segment(1, seq);
    expect(seg.hidden).toBe(false);
    expect(seg.restored).toBe(true);
    expect(seg.report_count).toBe(0);
    expect(story(1).hidden_count).toBe(0);
    fWho = ALICE;
    fails(failRestore, "STORIES: part is not hidden");
    // An editor can restore too.
    hideAs(1, seq);
    addEditor(1, CARA);
    authorize(CARA);
    new Stories().restore_segment(new stories.restore_segment_arguments(CARA, 1, seq, ""));
    checkpoint();
    seg = segment(1, seq);
    expect(seg.hidden).toBe(false);
  });

  it("can't restore a part the admin took down", () => {
    const seq = writeAsWriter(BOB, 1, "Text that a rights holder had removed.");
    authorize(STORIES);
    new Stories().takedown_segment(new stories.takedown_segment_arguments(1, seq, stories.moderation_reason.REASON_COPYRIGHT, "notice 1"));
    checkpoint();
    fWho = ALICE; fId = 1; fSeq = seq;
    fails(failRestore, "STORIES: segment was already removed");
  });
});
