// Audit Bot helpers for the fix-check tests on main @ 42f6af9.
// Copied from the repo's own tests (Stories.audit-strike.spec.ts, Stories.funds.spec.ts)
// so the setup matches how the authors test. Not a spec: imported by the audit specs.
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { reviewedTakedown, ownEditArgs } from "./reviewed";

export const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
export const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
export const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
export const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
export const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
export const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
export const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // another writer
export const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52"); // a third writer

export const START: u64 = 1700000000;
export const DAY: u64 = 86400;
export const MINT_ENTRY: u32 = 3698268091;
export const BURN_ENTRY: u32 = 2241834181;
export const SHORT = stories.story_kind.KIND_SHORT;
export const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
export const PRIVATE = stories.visibility.VISIBILITY_PRIVATE;
export const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;

export function checkpoint(): void { MockVM.commitTransaction(); }
export function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
export function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
export function directly(): void { MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode)); }
export function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
export function membership(tier: u32, paidUntil: u64): system_calls.exit_arguments {
  const m = new stories.shop_membership(tier, paidUntil, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}
export function writerMonth(): system_calls.exit_arguments { return membership(2, START + 365 * DAY); }
export function results(list: system_calls.exit_arguments[]): void { MockVM.setCallContractResults(list); }
export function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  results(list);
}
export function segment(id: u64, seq: u64): stories.segment { return new Stories().get_segment(new stories.get_segment_arguments(id, seq)); }
export function story(id: u64): stories.story { return new Stories().get_story(new stories.get_story_arguments(id)); }
// Every kept version: get_versions returns at most 5 per call (AB-060).
export function versions(id: u64, seq: u64): stories.segment_version[] {
  const out: stories.segment_version[] = [];
  const count = segment(id, seq).version_count;
  for (let from: u32 = 1; from <= count; from += 5) {
    const page = new Stories().get_versions(new stories.get_versions_arguments(id, seq, from, 5)).values;
    for (let i = 0; i < page.length; i++) out.push(page[i]);
  }
  return out;
}
export function strikes(who: Uint8Array): u32 { return new Stories().get_account_status(new stories.get_account_status_arguments(who)).strikes; }

export function configure(): void {
  authorize(STORIES);
  const c = new Stories();
  c.set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c.set_min_contribution(new stories.set_min_contribution_arguments(1));
  c.set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  c.add_category(new stories.add_category_arguments("Fantasy"));
  checkpoint();
}
export function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  directly();
  checkpoint();
}
export function openAs(vis: stories.visibility, fund: u64): u64 {
  authorize(ALICE);
  allowCalls(3);
  const text = "Once upon a time.";
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "My Tale", 10000, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0, fund
  )).value;
  checkpoint();
  return id;
}
export function openPublic(): u64 { return openAs(PUBLIC, 0); }
export function invite(id: u64, who: Uint8Array, allowed: bool): void {
  authorize(ALICE);
  new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, id, [who], allowed));
  checkpoint();
}
export function topUp(id: u64, amount: u64): void {
  authorize(ALICE);
  allowCalls(1);
  new Stories().top_up_fund(new stories.top_up_fund_arguments(ALICE, id, amount));
  checkpoint();
}
export function write(who: Uint8Array, id: u64, text: string): u64 {
  authorize(who);
  results([writerMonth(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}
// The price revise_part charges (copied from the repo's Stories.audit-strike.spec.ts).
// Doubles with each earlier paid change (segment.paid_changes); the writer's own
// edits are versions too, so version_count no longer counts paid changes.
export function changePrice(oldText: string, newText: string, paidChanges: u32): u64 {
  let pre = 0;
  const maxPre = min<i32>(oldText.length, newText.length);
  while (pre < maxPre && oldText.charCodeAt(pre) == newText.charCodeAt(pre)) pre++;
  let suf = 0;
  const maxSuf = min<i32>(oldText.length, newText.length) - pre;
  while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) == newText.charCodeAt(newText.length - 1 - suf)) suf++;
  const changed = <u64>(oldText.length - pre - suf + newText.length - pre - suf);
  const units: u64 = changed < 10 ? 10 : changed;
  const changes: u32 = paidChanges;
  return units * ((<u64>1) << (<u64>changes + 1));
}
export function revise(as: Uint8Array, id: u64, seq: u64, text: string): void {
  const s = segment(id, seq);
  const price = changePrice(s.text != null ? s.text! : "", text, s.paid_changes);
  authorize(as);
  results([writerMonth(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(as, id, seq, text, price, true, 0, "", false));
  checkpoint();
}
export function ownerEdit(as: Uint8Array, id: u64, seq: u64, text: string): void {
  authorize(as);
  // Growing the part reads the Writer membership and burns the added letters
  // (rule 3: letters beyond the current length cost the normal rate).
  const current = segment(id, seq).current_cost;
  if (<u64>text.length > current) results([writerMonth(), okCall()]);
  else allowCalls(1);
  // max_ink: the growth price the page would show (AB-049).
  const growth: u64 = <u64>text.length > current ? <u64>text.length - current : 0;
  new Stories().edit_segment(ownEditArgs(as, id, seq, text, <u64>text.length, growth));
  checkpoint();
}
export function ownerRemove(as: Uint8Array, id: u64, seq: u64): void {
  authorize(as);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(as, id, seq));
  checkpoint();
}
export function takedown(id: u64, seq: u64, who: Uint8Array): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(id, seq, COPYRIGHT, "notice 2026-010", who));
  checkpoint();
}
export function mintsTo(who: Uint8Array): u64 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let total: u64 = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point != MINT_ENTRY) continue;
    const m = Protobuf.decode<stories.ink_mint_call>(ev.payload!, stories.ink_mint_call.decode);
    let same = m.to != null && m.to!.length == who.length;
    if (same) for (let j = 0; j < who.length; j++) if (m.to![j] != who[j]) { same = false; break; }
    if (same) total += m.value;
  }
  return total;
}
// Ink burned from `who` (contribution burns) across all events so far.
export function burnsFrom(who: Uint8Array): u64 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let total: u64 = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point != BURN_ENTRY) continue;
    const b = Protobuf.decode<stories.ink_burn_call>(ev.payload!, stories.ink_burn_call.decode);
    let same = b.from != null && b.from!.length == who.length;
    if (same) for (let j = 0; j < who.length; j++) if (b.from![j] != who[j]) { same = false; break; }
    if (same) total += b.value;
  }
  return total;
}
