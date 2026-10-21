// =====================================================================
// Audit Bot attack tests for the AB-022 fix (SwarmTales fix check, commit
// 86d9b22): the writers' pool check now runs only on a switch from public.
// Original attack, inverse, bypass and legitimate use. Each test asserts
// the SAFE behaviour; all are expected to PASS on 86d9b22 and stay as
// regression tests. Helpers are copied unchanged from
// stories/assembly/__tests__/Stories.audit-newcode.spec.ts.
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
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // editor / writer
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const ADMIN = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");
const EVIL_APP = Base58.decode("112AujjxBp3etKBgsfu9gwcfAxRYM2ve8c");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const MINT_ENTRY: u32 = 3698268091;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const PRIVATE = stories.visibility.VISIBILITY_PRIVATE;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;
const NO_REASON = stories.moderation_reason.REASON_UNSPECIFIED;

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function directly(): void { MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode)); }
function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
function membership(tier: u32, paidUntil: u64): system_calls.exit_arguments {
  const m = new stories.shop_membership(tier, paidUntil, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}
function writer(): system_calls.exit_arguments { return membership(2, START + 365 * DAY); }
function results(list: system_calls.exit_arguments[]): void { MockVM.setCallContractResults(list); }
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
  for (let i = 0; i < list.length; i++) if (list[i].entry_point == entry) out.push(list[i]);
  return out;
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
function story(id: u64): stories.story { return new Stories().get_story(new stories.get_story_arguments(id)); }
function segment(id: u64, seq: u64): stories.segment { return new Stories().get_segment(new stories.get_segment_arguments(id, seq)); }
function strikes(who: Uint8Array): u32 { return new Stories().get_account_status(new stories.get_account_status_arguments(who)).strikes; }
function isAllowed(id: u64, who: Uint8Array): bool { return new Stories().is_allowed(new stories.is_allowed_arguments(id, who)).value; }
function adminOf(): string { return Base58.encode(new Stories().get_config(new stories.get_config_arguments()).admin!); }

function configure(): void {
  authorize(STORIES);
  const c = new Stories();
  c.set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c.set_min_contribution(new stories.set_min_contribution_arguments(1));
  c.set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  c.add_category(new stories.add_category_arguments("Fantasy"));
  checkpoint();
}
function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  directly();
  checkpoint();
}
function openShort(): u64 {
  authorize(ALICE);
  allowCalls(2);
  const text = "Once upon a time.";
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "My Tale", 10000, 1, 0, PUBLIC, 0, 0, text, false, <u64>text.length, USDT, true, 0
  )).value;
  checkpoint();
  return id;
}
function openFunded(vis: stories.visibility, max: u64, text: string, fund: u64): u64 {
  authorize(ALICE);
  allowCalls(3);
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "Funded", max, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0, fund
  )).value;
  checkpoint();
  return id;
}
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
function setAllowed(actor: Uint8Array, id: u64, who: Uint8Array, allowed: bool): void {
  authorize(actor);
  new Stories().set_allowed(new stories.set_allowed_arguments(actor, id, [who], allowed));
  checkpoint();
}
function takedown(id: u64, seq: u64): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(id, seq, COPYRIGHT, "notice 2026-001"));
  checkpoint();
}
function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}

const UNLISTED = stories.visibility.VISIBILITY_UNLISTED;
function update(id: u64, vis: stories.visibility, title: string): void {
  authorize(ALICE);
  new Stories().update_story(new stories.update_story_arguments(ALICE, id, title, 1, 0, vis, 0));
  checkpoint();
}
let ID: u64 = 0;   // closures cannot capture locals in AssemblyScript
const POOL_MSG = "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink";

describe("AUDIT AB-022 fix: the pool check runs only on a switch from public", () => {
  beforeEach(() => { reset(); configure(); });

  it("original: a private story whose pool was used can still be renamed", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    setAllowed(ALICE, id, BOB, true);
    writeAsWriter(BOB, id, chars(100));
    update(id, PRIVATE, "Renamed");
    expect(story(id).title!).toBe("Renamed");
  });

  it("legitimate use: private to unlisted after the pool was used (both invite-only)", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    setAllowed(ALICE, id, BOB, true);
    writeAsWriter(BOB, id, chars(100));
    update(id, UNLISTED, "Now unlisted");
    expect(story(id).visibility).toBe(UNLISTED);
  });

  it("inverse (AB-011 must still hold): a public story with no pool cannot become private", () => {
    const id = openShort();
    ID = id;
    fails(() => { update(ID, PRIVATE, "Sneaky"); }, POOL_MSG);
    expect(story(id).visibility).toBe(PUBLIC);
  });

  it("bypass: private -> public -> private once the pool has dropped below the minimum is refused", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    setAllowed(ALICE, id, BOB, true);
    writeAsWriter(BOB, id, chars(100));
    update(id, PUBLIC, "Public for a bit");
    ID = id;
    fails(() => { update(ID, PRIVATE, "Back to private"); }, POOL_MSG);
    expect(story(id).visibility).toBe(PUBLIC);
  });
});
