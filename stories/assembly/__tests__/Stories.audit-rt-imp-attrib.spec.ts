// Audit Bot red-team (Impersonator) attack test RT-IMP-ATTRIB (Swarmtales, commit 42f6af9).
// Attack: revise_part (Stories.ts:1132-1248) writes the changer's words into a part that
// stays credited to the original writer, but drops what the changer declares about them:
// args.ai_assisted and args.citation are never read, and the part keeps the WRITER's
// citation (which tells the copy checker to leave quoted text alone). It also clears the
// moderator's source note (seg.source_note = "", Stories.ts:1228), a field only the
// admin/moderator may set (set_source_note, Stories.ts:1323), so any paying stranger
// erases the copy checker's finding on someone else's part with a one-letter change.
// Asserts the SAFE behaviour: FAILS while those declarations/notes are silently lost.
// Setup helpers below are copied unchanged (or trimmed) from the repo's own
// stories/assembly/__tests__/Stories.revise.spec.ts and Stories.security.spec.ts.

import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { ownEditArgs } from "./reviewed";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // another writer
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const EVIL_APP = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");

const START: u64 = 1700000000;
const DAY: u64 = 86400;

const SHORT = stories.story_kind.KIND_SHORT;
const BOOK = stories.story_kind.KIND_BOOK;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const PRIVATE = stories.visibility.VISIBILITY_PRIVATE;

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

function directly(): void {
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
}

function viaOtherContract(): void {
  MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode));
}

function okCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0)));
}

function membership(tier: u32, paidUntil: u64): system_calls.exit_arguments {
  const m = new stories.shop_membership(tier, paidUntil, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
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

function same(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null) return false;
  return Base58.encode(a) == Base58.encode(b);
}

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

function story(id: u64): stories.story {
  return new Stories().get_story(new stories.get_story_arguments(id));
}

function segment(id: u64, seq: u64): stories.segment {
  return new Stories().get_segment(new stories.get_segment_arguments(id, seq));
}

function configure(): void {
  authorize(STORIES);
  const c = new Stories();
  c.set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c.set_min_contribution(new stories.set_min_contribution_arguments(1));
  c.set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  c.add_category(new stories.add_category_arguments("Fantasy"));
  c.add_category(new stories.add_category_arguments("Sci-Fi"));
  c.add_category(new stories.add_category_arguments("Mystery & Thriller"));
  checkpoint();
}

function openAs(opener: Uint8Array, kind: stories.story_kind, max: u64, vis: stories.visibility, text: string): u64 {
  authorize(opener);
  allowCalls(3);
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

function writeAsOpener(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

function writeAsWriter(who: Uint8Array, id: u64, text: string): u64 {
  authorize(who);
  results([writer(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

function edit(as: Uint8Array, id: u64, seq: u64, text: string): void {
  authorize(as);
  // Growing the part reads the Writer membership and burns the added letters;
  // shrinking it mints a refund.
  if (<u64>text.length > segment(id, seq).current_cost) results([writer(), okCall()]);
  else allowCalls(1);
  new Stories().edit_segment(ownEditArgs(as, id, seq, text, <u64>text.length));
  checkpoint();
}

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
  new Stories().close_story(new stories.close_story_arguments(opener, id));
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

function edited(seq: u64, text: string): stories.final_item {
  return new stories.final_item(seq, stories.final_mode.FINAL_EDITED, text, <u64>text.length);
}

function pdfHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(i + 1);
  return h;
}

function finalizeAs(who: Uint8Array, id: u64): void {
  authorize(who);
  new Stories().finalize(new stories.finalize_arguments(who, id, "ipfs://bafy-example", pdfHash()));
  checkpoint();
}

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
  checkpoint();
}

function reviseAs(who: Uint8Array, seq: u64, text: string, expected: u64): u32 {
  authorize(who);
  results([writer(), okCall(), okCall()]);
  const v = new Stories().revise_part(new stories.revise_part_arguments(who, 1, seq, text, expected, true, 0, "", false)).value;
  checkpoint();
  return v;
}

function block(who: Uint8Array): void {
  authorize(STORIES);
  new Stories().set_blocked(new stories.set_blocked_arguments(who, true, "test block"));
  checkpoint();
}

// An attack call must be refused. The message is not pinned (the safe
// version's wording is up to the fix); the mock is rolled back afterwards.
function refused(fn: () => void, finding: string): void {
  expect(fn).toThrow(finding);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
  directly();
}

const BOB_TEXT = "Bob's first version of this part, plain and simple.";

const NOTE = "Parts also appear in The Sea by A. Writer";

describe("RT-IMP-ATTRIB: a paid change hides behind the writer's flags", () => {
  beforeEach(() => { reset(); configure(); openShort(); writeAsWriter(BOB, 1, BOB_TEXT); });

  it("keeps the changer's AI-assisted declaration", () => {
    authorize(CARA);
    results([writer(), okCall(), okCall()]);
    new Stories().revise_part(new stories.revise_part_arguments(
      CARA, 1, 2, BOB_TEXT.replace("plain", "plan"), 20, true, 0, "", true));
    checkpoint();
    expect(segment(1, 2).ai_assisted).toBe(true,
      "RT-IMP-ATTRIB: the changer declared AI-assisted text but the part still reads as not AI-assisted");
  });

  it("does not let a stranger's paid change erase the moderator's source note", () => {
    authorize(STORIES);
    new Stories().set_source_note(new stories.set_source_note_arguments(STORIES, 1, 2, NOTE));
    checkpoint();
    expect(segment(1, 2).source_note).toBe(NOTE);
    reviseAs(MALLORY, 2, BOB_TEXT.replace("plain", "plan"), 20);
    expect(segment(1, 2).source_note).toBe(NOTE,
      "RT-IMP-ATTRIB: a non-moderator cleared the copy checker's source note by paying for a one-letter change");
  });
});
