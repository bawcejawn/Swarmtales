// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ 42f6af9.
// Attack: a part is removed with revise_part (empty text) before the
// takedown notice arrives. revise_part keeps every version, including the
// original text (version 1). takedown_segment wipes kept versions only
// inside `if (seg.status == SEGMENT_ACTIVE)` (Stories.ts ~1402-1422), so for
// a removed part the infringing original stays readable via get_versions
// after the "permanent" takedown. Any opener/editor (or the writer, or any
// allowed writer) can put a part in this state for 2x its length in Ink.
// docs/ADMIN_POWERS.md: "A takedown also wipes the part's kept versions."
// Asserts the SAFE behaviour. FAILS while the attack works.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";

// Helpers copied from Stories.audit-AB001.spec.ts / Stories.moderation.spec.ts.
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CAROL = Base58.decode("1GG3wjVP4fCkDBsdeK95LCBfDhNhGigZm3");   // writer
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt");     // moderator key
const FAKE_INK = Base58.decode("112AujjxBp3etKBgsfu9gwcfAxRYM2ve8c"); // a contract the admin controls

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
  c().takedown_segment(new stories.takedown_segment_arguments(id, seq, COPYRIGHT, "notice 2026-101", who));
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

const COPIED = "Bob pastes the opening page of a famous novel here.";

describe("RT-INS takedown: kept versions of a removed part are wiped too", () => {
  beforeEach(() => { reset(); });

  it("someone else removed the part with revise_part, then the admin takes it down", () => {
    open(OPENING);
    const seq = writerWrites(BOB, 1, COPIED);
    revise(CAROL, 1, seq, "");                       // removed; versions 1 (original) and 2 (removed) kept
    expect(seg(1, seq).status).toBe(stories.segment_status.SEGMENT_REMOVED);
    takedownStriking(1, seq, BOB);
    expect(seg(1, seq).taken_down).toBe(true);
    const kept = c().get_versions(new stories.get_versions_arguments(1, seq)).values;
    let readable = false;
    for (let i = 0; i < kept.length; i++) if (kept[i].text != null && kept[i].text! == COPIED) readable = true;
    expect(readable).toBe(false, "RT-INS: the taken-down text is still readable through get_versions");
    expect(kept.length).toBe(0, "RT-INS: a takedown left kept versions of a removed part");
  });

  // Updated for rule 3 (a writer never uses revise_part on their own part):
  // the writer removes it with the free remove_segment after someone changed it.
  it("the writer removed their own part after a change, then the admin takes it down", () => {
    open(OPENING);
    const seq = writerWrites(BOB, 1, COPIED);
    revise(CAROL, 1, seq, COPIED + " Carol adds a line.");
    directly(); authorize(BOB); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(BOB, 1, seq));
    checkpoint();
    takedownStriking(1, seq, BOB);
    const kept = c().get_versions(new stories.get_versions_arguments(1, seq)).values;
    expect(kept.length).toBe(0, "RT-INS: a takedown left kept versions of a removed part");
  });
});
