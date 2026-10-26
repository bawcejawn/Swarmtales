// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ 42f6af9.
// Attack: the Stories admin points Stories at an Ink contract it controls
// (set_addresses), writes a part (the "burn" goes to the fake Ink, but
// story.total_burned still grows), points Stories back at the real Ink and
// removes the part. The refund is minted on the REAL Ink (Stories is an
// approved REFUND minter), so the Stories admin creates real Ink at will.
// docs/ADMIN_POWERS.md: "The Stories admin cannot mint or burn Ink, refund
// outside the rules". Also works with a story fund (deposit on the fake Ink,
// switch back, finalize/archive: returnFund mints the whole pool for real).
// Asserts the SAFE behaviour: real Ink minted for a story never exceeds the
// real Ink burned for it. FAILS while the attack works.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { reviewedTakedown } from "./reviewed";

// Helpers copied from Stories.audit-AB001.spec.ts / Stories.moderation.spec.ts.
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CAROL = Base58.decode("1GG3wjVP4fCkDBsdeK95LCBfDhNhGigZm3");   // writer
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt");     // moderator key
// A contract the admin controls. (The address first used here starts with "11";
// the AssemblyScript Base58 decoder drops its leading zero byte, so the test
// aborted on "invalid Ink address" before reaching the attack.)
const FAKE_INK = Base58.decode("1Htyn9WgqXQcxjCWSBtGzX5bUkSWAbocvM");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const MINT_ENTRY: u32 = 3698268091;
const BURN_ENTRY: u32 = 2241834181;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;
const NO_REASON = stories.moderation_reason.REASON_UNSPECIFIED;
const PAUSED = "STORIES: stories are paused";

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
function strikes(who: Uint8Array): u32 { return c().get_account_status(new stories.get_account_status_arguments(who)).strikes; }
function same(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null || a.length != b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] != b[i]) return false;
  return true;
}
function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
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
function takedownStriking(id: u64, seq: u64, who: Uint8Array): void {
  directly(); authorize(STORIES);
  c().takedown_segment(reviewedTakedown(id, seq, COPYRIGHT, "notice 2026-101", who));
  checkpoint();
}
function setModerator(): void {
  directly(); authorize(STORIES);
  c().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
  checkpoint();
}
function hide(by: Uint8Array, id: u64, seq: u64): void {
  directly(); authorize(by);
  c().set_segment_hidden(new stories.set_segment_hidden_arguments(by, id, seq, true, COPYRIGHT, "matched a known book"));
  checkpoint();
}
function pause(on: bool): void {
  directly(); authorize(STORIES);
  c().set_paused(new stories.set_paused_arguments(on));
  checkpoint();
}
function keep(seq: u64): stories.final_item { return new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0); }
const OPENING = "A lantern swung in the dark.";   // 28 characters

function inkTotals(target: Uint8Array): u64[] {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let minted: u64 = 0;
  let burned: u64 = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (!same(ev.contract_id, target)) continue;
    if (ev.entry_point == MINT_ENTRY) minted += Protobuf.decode<stories.ink_mint_call>(ev.payload!, stories.ink_mint_call.decode).value;
    if (ev.entry_point == BURN_ENTRY) burned += Protobuf.decode<stories.ink_burn_call>(ev.payload!, stories.ink_burn_call.decode).value;
  }
  return [minted, burned];
}
function adminSetsInk(ink: Uint8Array): void {
  directly(); authorize(STORIES);
  c().set_addresses(new stories.set_addresses_arguments(ink, SHOP));
  checkpoint();
}

describe("RT-INS ink swap: the Stories admin cannot mint real Ink through refunds", () => {
  beforeEach(() => { reset(); });

  it("a part paid on a fake Ink is never refunded on the real Ink", () => {
    open(OPENING);                                   // 28 burned on the real Ink
    // Once set, the Ink address can't change (AB-037), so the swap is refused.
    expect(() => { adminSetsInk(FAKE_INK); }).toThrow("RT-INS: the Stories admin pointed Stories at another Ink contract");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    const seq = writerWrites(BOB, 1, chars(2000));   // with the swap, this burn would go to FAKE_INK
    adminSetsInk(INK);
    // The writer (an admin sock) removes the part: refund = 2,000.
    directly(); authorize(BOB); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(BOB, 1, seq));
    checkpoint();
    const t = inkTotals(INK);
    expect(t[0] <= t[1]).toBe(true,
      "RT-INS: the Stories admin minted " + t[0].toString() + " real Ink against " + t[1].toString() + " burned on the real Ink (Ink address swap)");
  });
});
