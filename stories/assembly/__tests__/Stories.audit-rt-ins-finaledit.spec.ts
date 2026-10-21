// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ 42f6af9.
// Attack: after admin_take_over, the admin (or, after close_story, the
// opener) "lightly edits" a writer's part in submit_final_batch. The only
// limit is LENGTH (newCost <= charged + allowance, Stories.ts ~994): every
// word can be replaced, the part stays attributed to its writer, and no
// version of the writer's original is kept (revise_part keeps versions,
// the final edit does not), so the admin's own comparison before a
// takedown (deploy.js takedown prints get_versions) has nothing to compare.
// Claim: docs/ADMIN_POWERS.md "the admin can lightly edit text (within the
// same small allowance any finalizer has ...)".
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

const LINE = "Bob writes a scene for the final edit.";      // 38
const SWAPPED = "Admin replaces every one of these words";   // 39, nothing in common
function lockedStoryWithBobsPart(): void {
  open(OPENING);                                    // 1: 28
  writerWrites(BOB, 1, LINE);                       // 2: 38
  for (let i = 0; i < 4; i++) openerWrites(1, chars(2000));
  openerWrites(1, chars(1972 - LINE.length));       // story locks at 10,000
  expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
  directly(); authorize(ALICE);
  c().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, 1, true));
  checkpoint();
  directly(); authorize(STORIES);
  c().admin_take_over(new stories.admin_take_over_arguments(1));
  checkpoint();
}
function adminSwaps(): void {
  directly(); authorize(STORIES); allowCalls(2);
  c().submit_final_batch(new stories.submit_final_batch_arguments(STORIES, 1, [
    keep(1), new stories.final_item(2, stories.final_mode.FINAL_EDITED, SWAPPED, <u64>SWAPPED.length)
  ]));
}

describe("RT-INS final edit: the admin's 'light edit' of a writer's part", () => {
  beforeEach(() => { reset(); lockedStoryWithBobsPart(); });

  it("keeps the writer's original as a version the admin can compare before a takedown", () => {
    adminSwaps();
    checkpoint();
    const kept = c().get_versions(new stories.get_versions_arguments(1, 2)).values;
    let original = false;
    for (let i = 0; i < kept.length; i++) if (kept[i].text != null && kept[i].text! == LINE) original = true;
    expect(original).toBe(true, "RT-INS: the final edit replaced Bob's words and kept no version of them");
  });

  // Changed from "the swap is refused": the final edit may replace words within
  // the light-edit length limit (Stories.moderation.spec.ts relies on that, and
  // the audit report treats it as intended). What must hold is that the swap is
  // on the record: kept as a version by the finalizer, and the part counts as
  // changed by someone else, so a takedown can't strike Bob by default.
  it("records a 'light edit' that replaces every word of someone else's part as the finalizer's change", () => {
    adminSwaps();
    checkpoint();
    const kept = c().get_versions(new stories.get_versions_arguments(1, 2)).values;
    expect(kept.length).toBe(2);
    expect(kept[1].text!).toBe(SWAPPED);
    expect(same(kept[1].by!, STORIES)).toBe(true, "RT-INS: the swap is not attributed to the finalizer");
    expect(kept[1].kind).toBe(5);
    expect(seg(1, 2).edited_by_others).toBe(true, "RT-INS: a default takedown would strike Bob for the admin's words");
  });
});
