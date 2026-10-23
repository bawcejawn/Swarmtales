// =====================================================================
// Audit Bot attack test for AB-001 (SwarmTales audit, commit 3335a2a).
//
// Attack: an opener rewrites another writer's part with different text of
// the same length, then the admin takes the part down. The strike must land
// on whoever put the text there, not on the writer whose words were replaced.
//
// This test asserts the SAFE behaviour. Before the fix it FAILS (proof of the
// bug). After the fix it PASSES. Keep it in the repo as a regression test.
// Helpers below are copied unchanged from Stories.moderation.spec.ts.
// =====================================================================
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { reviewedTakedown } from "./reviewed";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CAROL = Base58.decode("1GG3wjVP4fCkDBsdeK95LCBfDhNhGigZm3");   // writer
const DAVE = Base58.decode("13ZhCsVeBFFm5jbHRynyrR2AjULxUUtwfd");    // writer
const READER = Base58.decode("17tbkL7b9mGGQeYszdDqpZFWxYSh6R3zs3");  // has never written
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt");     // moderator key
const EVIL_APP = Base58.decode("112AujjxBp3etKBgsfu9gwcfAxRYM2ve8c");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const MINT_ENTRY: u32 = 3698268091;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;
const SPAM = stories.moderation_reason.REASON_SPAM;
const NO_REASON = stories.moderation_reason.REASON_UNSPECIFIED;
const DIRECT_ONLY = "STORIES: call SwarmTales directly from your wallet, not through another contract";

// ---------- helpers ----------

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

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function directly(): void { MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode)); }
function viaOtherContract(): void { MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode)); }
function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  MockVM.setCallContractResults(list);
}
function writerAnswer(): system_calls.exit_arguments {
  const m = new stories.shop_membership(2, START + 365 * DAY, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}
function c(): Stories { return new Stories(); }
function story(id: u64): stories.story { return c().get_story(new stories.get_story_arguments(id)); }
function seg(id: u64, seq: u64): stories.segment { return c().get_segment(new stories.get_segment_arguments(id, seq)); }
function cfg(): stories.config { return c().get_config(new stories.get_config_arguments()); }

function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}

function countEvents(name: string): i32 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let n = 0;
  for (let i = 0; i < events.length; i++) if (events[i].name == name) n++;
  return n;
}

function mints(): i32 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let n = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point == MINT_ENTRY) n++;
  }
  return n;
}

function lastModeration(): stories.moderation_event {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].name == "stories.moderation_event") {
      return Protobuf.decode<stories.moderation_event>(events[i].data!, stories.moderation_event.decode);
    }
  }
  return new stories.moderation_event();
}

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  directly();
  checkpoint();
  authorize(STORIES);
  c().set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c().add_category(new stories.add_category_arguments("Fantasy"));
  // Written for the original 2,000 per-part cap.
  c().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  checkpoint();
}

function open(text: string): u64 {
  directly(); authorize(ALICE); allowCalls(2);
  const id = c().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "My Tale", 10000, 1, 0, PUBLIC, 0, 0, text, false, <u64>text.length, USDT, true, cfg().terms_version
  )).value;
  checkpoint();
  return id;
}

function openerWrites(id: u64, text: string): u64 {
  directly(); authorize(ALICE); allowCalls(1);
  const seq = c().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, cfg().terms_version)).value;
  checkpoint();
  return seq;
}

function writerWrites(who: Uint8Array, id: u64, text: string): u64 {
  directly(); authorize(who);
  MockVM.setCallContractResults([writerAnswer(), okCall()]);
  const seq = c().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, cfg().terms_version)).value;
  checkpoint();
  return seq;
}

function setModerator(): void {
  directly(); authorize(STORIES);
  c().set_moderation(new stories.set_moderation_arguments(BOT, 3, 3));
  checkpoint();
}

function hide(by: Uint8Array, id: u64, seq: u64, hidden: bool): void {
  directly(); authorize(by);
  c().set_segment_hidden(new stories.set_segment_hidden_arguments(by, id, seq, hidden, hidden ? COPYRIGHT : NO_REASON, "matched a known book"));
  checkpoint();
}

function report(who: Uint8Array, id: u64, seq: u64): void {
  directly(); authorize(who);
  c().report_segment(new stories.report_segment_arguments(who, id, seq, COPYRIGHT, "looks copied"));
  checkpoint();
}

function takedown(id: u64, seq: u64): void {
  directly(); authorize(STORIES);
  c().takedown_segment(reviewedTakedown(id, seq, COPYRIGHT, "notice 2026-001"));
  checkpoint();
}

function keep(seq: u64): stories.final_item { return new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0); }
function drop(seq: u64): stories.final_item { return new stories.final_item(seq, stories.final_mode.FINAL_REMOVED, "", 0); }

function pdfHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(i + 1);
  return h;
}

function termsHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(200 - i);
  return h;
}

// Opening (28) + 4 x 2,000 + 1,972 = 10,000: story locks.
function fillAndLock(id: u64): void {
  for (let i = 0; i < 4; i++) openerWrites(id, chars(2000));
  openerWrites(id, chars(1972));
}

function closeStory(id: u64): void {
  directly(); authorize(ALICE); allowCalls(1);
  c().close_story(new stories.close_story_arguments(ALICE, id));
  checkpoint();
}

function batch(id: u64, items: stories.final_item[]): void {
  directly(); authorize(ALICE); allowCalls(items.length);
  c().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, items));
  checkpoint();
}

function finalize(id: u64): void {
  directly(); authorize(ALICE);
  c().finalize(new stories.finalize_arguments(ALICE, id, "ipfs://book", pdfHash()));
  checkpoint();
}

const OPENING = "A lantern swung in the dark.";   // 28 characters

// ---------- rights confirmation and Terms of Use ----------

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
function revise(who: Uint8Array, id: u64, seq: u64, text: string): void {
  const s = seg(id, seq);
  const price = changePrice(s.text != null ? s.text! : "", text, s.paid_changes);
  directly(); authorize(who);
  MockVM.setCallContractResults([writerAnswer(), okCall(), okCall()]);
  c().revise_part(new stories.revise_part_arguments(who, id, seq, text, price, true, cfg().terms_version, "", false));
  checkpoint();
}
let FAIL_ID: u64 = 0;
function takedownDefault(): void {
  directly(); authorize(STORIES);
  c().takedown_segment(reviewedTakedown(FAIL_ID, 2, COPYRIGHT, "notice 2026-001"));
}
function takedownStriking(id: u64, seq: u64, who: Uint8Array): void {
  directly(); authorize(STORIES);
  c().takedown_segment(reviewedTakedown(id, seq, COPYRIGHT, "notice 2026-001", who));
  checkpoint();
}

describe("AUDIT AB-001: rewriting someone else's part must not frame them", () => {
  beforeEach(() => { reset(); setModerator(); });

  // Since the revise-and-book change, other wallets change a part with the
  // paid revise_part, and the part stays its writer's. The contract no
  // longer guesses who made the text: once someone else changed a part, a
  // takedown waits for the admin to name who gets the strike.
  it("never strikes the writer by default for text someone else planted, and the planter can be struck", () => {
    open(OPENING);
    const original = "Bob writes an honest, original paragraph.";
    writerWrites(BOB, 1, original);
    expect(seg(1, 2).author!).toStrictEqual(BOB);

    // Alice (the opener) pays to replace Bob's words with different text of the SAME length.
    const planted = "Alice swaps in copied text of equal size.";
    expect(planted.length).toBe(original.length);
    revise(ALICE, 1, 2, planted);
    expect(seg(1, 2).text).toBe(planted);
    expect(seg(1, 2).edited_by_others).toBe(true);

    // A takedown with no choice is refused, so Bob is not struck by default.
    FAIL_ID = 1;
    fails(() => { takedownDefault(); }, "STORIES: someone other than the writer changed this part; name who gets the strike, or choose no strike");
    expect(seg(1, 2).taken_down).toBe(false);

    // The admin compares the versions and strikes Alice.
    takedownStriking(1, 2, ALICE);
    const bob = c().get_account_status(new stories.get_account_status_arguments(BOB));
    const alice = c().get_account_status(new stories.get_account_status_arguments(ALICE));
    expect(bob.strikes).toBe(0, "AB-001: the original writer was struck for text the opener planted");
    expect(alice.strikes).toBe(1, "AB-001: the wallet that planted the text could not be struck");
  });
});
