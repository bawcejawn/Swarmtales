// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ 42f6af9.
// Attack: the opener (or any editor) writes text into ANOTHER writer's part
// without being recorded: set_citation (Stories.ts ~1302) lets the opener or
// an editor set up to 200 characters shown under any part, free, in any
// non-finalized stage, while paused and while blocked. It is not
// recordChanger'd, so (a) a takedown of that part strikes the WRITER by
// default (edited_by_others stays false), and (b) the admin cannot name the
// opener ("strike the part's writer or a wallet that changed it"). The
// citation also steers the copy checker (citationCovers -> UNHIDE,
// checker/check.mjs ~421).
// Claims: Stories.ts header "whoever made the text can always be struck";
// ADMIN_POWERS "A part nobody else changed is a strike against its writer".
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

const PLANTED = "Lyrics: the full first verse of a famous copyrighted song, pasted by the opener.";
function aliceCites(): void {
  directly(); authorize(ALICE);
  c().set_citation(new stories.set_citation_arguments(ALICE, 1, 2, PLANTED));
  checkpoint();
}
function strikeAlice(): void {
  directly(); authorize(STORIES);
  c().takedown_segment(new stories.takedown_segment_arguments(1, 2, COPYRIGHT, "notice 2026-102", ALICE));
}

describe("RT-INS citation: text the opener puts on a writer's part is recorded as a change", () => {
  beforeEach(() => { reset(); open(OPENING); writerWrites(BOB, 1, "Bob writes a quiet scene by the sea."); });

  it("the opener's citation on Bob's part marks the part as changed by someone else", () => {
    aliceCites();
    expect(seg(1, 2).citation).toBe(PLANTED);
    expect(same(seg(1, 2).author, BOB)).toBe(true);
    expect(seg(1, 2).edited_by_others).toBe(true,
      "RT-INS: the opener wrote text into Bob's part and the default takedown would strike Bob");
  });

  it("the admin can strike the opener who wrote the citation", () => {
    aliceCites();
    expect(() => { strikeAlice(); }).not.toThrow("RT-INS: the wallet that wrote the citation cannot be struck");
    checkpoint();
    expect(strikes(ALICE)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });
});
