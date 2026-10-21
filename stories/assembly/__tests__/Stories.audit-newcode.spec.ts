// =====================================================================
// Audit Bot attack tests for the code the fixes added (SwarmTales fix
// check, commit b002091): the AB-011 pool rule, the AB-001 strike rule,
// accept_admin, the removed-writer list and the AB-012 refund path.
//
// Each test asserts the SAFE behaviour. Tests marked [NEW FINDING] FAIL on
// b002091 (proof); the rest PASS (the attack was blocked) and stay as
// regression tests. Helpers are copied unchanged from
// stories/assembly/__tests__/Stories.funds.spec.ts.
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
// What revise_part charges: everything between the common start and the
// common end counts, at least 10, times 2, doubling with every change.
function changePrice(oldText: string, newText: string, versionCount: u32): u64 {
  let pre = 0;
  const maxPre = min<i32>(oldText.length, newText.length);
  while (pre < maxPre && oldText.charCodeAt(pre) == newText.charCodeAt(pre)) pre++;
  let suf = 0;
  const maxSuf = min<i32>(oldText.length, newText.length) - pre;
  while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) == newText.charCodeAt(newText.length - 1 - suf)) suf++;
  const changed = <u64>(oldText.length - pre - suf + newText.length - pre - suf);
  const units: u64 = changed < 10 ? 10 : changed;
  const changes: u32 = versionCount == 0 ? 0 : versionCount - 1;
  return units * ((<u64>1) << (<u64>changes + 1));
}
// Someone else changes a part: the paid revise_part.
function revise(as: Uint8Array, id: u64, seq: u64, text: string): void {
  const s = segment(id, seq);
  const price = changePrice(s.text != null ? s.text! : "", text, s.version_count);
  authorize(as);
  results([writer(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(as, id, seq, text, price, true, 0, "", false));
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
function takedownStriking(id: u64, seq: u64, who: Uint8Array): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(id, seq, COPYRIGHT, "notice 2026-001", who));
  checkpoint();
}
let TD_ID: u64 = 0;   // closures cannot capture locals in AssemblyScript
let TD_SEQ: u64 = 0;
function takedownNoChoice(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(TD_ID, TD_SEQ, COPYRIGHT, "notice 2026-001"));
}
const NEEDS_CHOICE = "STORIES: someone other than the writer changed this part; name who gets the strike, or choose no strike";
function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}

// ---------------------------------------------------------------------

describe("AUDIT AB-022 [NEW FINDING]: the AB-011 pool rule locks invite-only stories out of update_story", () => {
  beforeEach(() => { reset(); configure(); });

  it("lets the opener of a private story rename it after writers have used some of the pool", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    setAllowed(ALICE, id, BOB, true);
    writeAsWriter(BOB, id, chars(100));       // paid from the pool, as designed
    expect(story(id).fund < 10000).toBe(true);
    // Same visibility, new title. Nothing about the pool changes.
    authorize(ALICE);
    expect(() => {
      new Stories().update_story(new stories.update_story_arguments(ALICE, 1, "Renamed", 1, 0, PRIVATE, 0));
    }).not.toThrow("AB-022: a private story whose pool was used normally can no longer change its title, categories or free chapters");
  });
});

// Rule (owner's decision, after AB-028 and AB-029): a part nobody else
// changed strikes its writer. Once someone else changed it (revise_part),
// even by one character, the admin compares the versions and names who
// gets the strike. A trim or a typo fix never moves a strike by itself.
describe("AUDIT AB-023: a one-character change by someone else", () => {
  beforeEach(() => { reset(); configure(); });

  it("does not take the strike off the writer by itself; the admin decides", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes a paragraph from a novel.");
    // Cara, another writer, pays to remove the final full stop.
    revise(CARA, id, seq, "Bob pastes a paragraph from a novel");
    TD_ID = id; TD_SEQ = seq;
    fails(() => { takedownNoChoice(); }, NEEDS_CHOICE);
    takedownStriking(id, seq, BOB);
    expect(strikes(BOB)).toBe(1, "AB-023: the writer of the infringing words could not be struck");
    expect(strikes(CARA)).toBe(0, "AB-023: the wallet that only trimmed was struck");
  });

  it("lets the admin strike someone who swapped in a word", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes a quiet scene by the sea.");
    revise(CARA, id, seq, "Bob writes a quiet scene by the bay.");
    takedownStriking(id, seq, CARA);
    expect(strikes(BOB)).toBe(0, "AB-023: the writer was struck for words someone else put there");
    expect(strikes(CARA)).toBe(1, "AB-023: the wallet that replaced words could not be struck");
  });
});

describe("AUDIT: the strike rule still blocks framing (AB-001 regression)", () => {
  beforeEach(() => { reset(); configure(); });

  it("never strikes the writer by default for words someone else planted", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest paragraph.");
    revise(CARA, id, seq, "Cara plants a copied paragraph");
    TD_ID = id; TD_SEQ = seq;
    fails(() => { takedownNoChoice(); }, NEEDS_CHOICE);
    expect(strikes(BOB)).toBe(0, "AB-001: the original writer was struck");
    takedownStriking(id, seq, CARA);
    expect(strikes(BOB)).toBe(0, "AB-001: the original writer was struck");
    expect(strikes(CARA)).toBe(1, "AB-001: the wallet that planted the text was not struck");
  });
});

describe("AUDIT AB-016: attacks on accept_admin", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses a stranger, an app contract and a second accept; the old admin keeps power until the accept", () => {
    authorize(STORIES);
    new Stories().set_admin(new stories.set_admin_arguments(ADMIN));
    checkpoint();
    // Still the old admin.
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(false));
    checkpoint();
    fails(() => { authorize(MALLORY); new Stories().accept_admin(new stories.accept_admin_arguments()); },
      "STORIES: only the proposed admin can accept");
    authorize(ADMIN);
    MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode));
    fails(() => { new Stories().accept_admin(new stories.accept_admin_arguments()); },
      "STORIES: call SwarmTales directly from your wallet, not through another contract");
    directly();
    authorize(ADMIN);
    new Stories().accept_admin(new stories.accept_admin_arguments());
    checkpoint();
    expect(adminOf()).toBe(Base58.encode(ADMIN));
    fails(() => { authorize(ADMIN); new Stories().accept_admin(new stories.accept_admin_arguments()); },
      "STORIES: no admin handover is pending");
    fails(() => { authorize(STORIES); new Stories().set_paused(new stories.set_paused_arguments(true)); },
      "STORIES: admin authority required");
  });

  it("keeps a pending handover across other admin settings", () => {
    authorize(STORIES);
    new Stories().set_admin(new stories.set_admin_arguments(ADMIN));
    checkpoint();
    authorize(STORIES);
    new Stories().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
    new Stories().set_paused(new stories.set_paused_arguments(false));
    checkpoint();
    authorize(ADMIN);
    new Stories().accept_admin(new stories.accept_admin_arguments());
    checkpoint();
    expect(adminOf()).toBe(Base58.encode(ADMIN));
  });
});

describe("AUDIT AB-010: the removed-writer list", () => {
  beforeEach(() => { reset(); configure(); });

  it("an editor's removal also blocks the invite, and only the opener or an editor can undo it", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    addEditor(id, CARA);
    authorize(ALICE);
    new Stories().create_invite(new stories.create_invite_arguments(ALICE, id, Base58.decode(LINK_ADDRESSES[0]), 5, START + DAY));
    checkpoint();
    authorize(BOB);
    new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, id, 1, inviteSig(0, 1, 1)));
    checkpoint();
    setAllowed(CARA, id, BOB, false);
    fails(() => {
      authorize(BOB);
      new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 1, inviteSig(0, 1, 1)));
    }, "STORIES: the opener or an editor removed this wallet from the story; only they can add it back");
    fails(() => {
      authorize(BOB);
      new Stories().set_allowed(new stories.set_allowed_arguments(BOB, 1, [BOB], true));
    }, "STORIES: only the opener or an editor may change the allow-list");
    expect(isAllowed(id, BOB)).toBe(false);
  });

  it("RESIDUAL (documents current behaviour): the removed writer's second wallet can still use the same link", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    authorize(ALICE);
    new Stories().create_invite(new stories.create_invite_arguments(ALICE, id, Base58.decode(LINK_ADDRESSES[0]), 5, START + DAY));
    checkpoint();
    authorize(BOB);
    new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, id, 1, inviteSig(0, 1, 1)));
    checkpoint();
    setAllowed(ALICE, id, BOB, false);
    // Bob still has the link: he signs it for another wallet he controls.
    authorize(MALLORY);
    new Stories().join_with_invite(new stories.join_with_invite_arguments(MALLORY, id, 1, inviteSig(0, 1, 3)));
    checkpoint();
    expect(isAllowed(id, MALLORY)).toBe(true);   // only revoke_invite closes this
  });
});

function reportHide(id: u64, seq: u64): void {
  const reporters: Uint8Array[] = [ALICE, CARA, MALLORY];
  for (let i = 0; i < reporters.length; i++) {
    authorize(reporters[i]);
    new Stories().report_segment(new stories.report_segment_arguments(reporters[i], id, seq, COPYRIGHT, ""));
    checkpoint();
  }
}

describe("AUDIT AB-012: the new refund path", () => {
  beforeEach(() => { reset(); configure(); });

  it("a part the admin hid is not refunded; a report-hidden part the admin re-hides is not either", () => {
    const id = openShort();
    const a = writeAsWriter(BOB, id, "Bob copies a paragraph.");
    writeAsWriter(CARA, id, "Cara writes a line.");
    writeAsWriter(MALLORY, id, "Mallory writes a line.");
    const b = writeAsWriter(BOB, id, "Bob copies another one.");

    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, a, true, COPYRIGHT, "matched a known book"));
    checkpoint();

    // Bob's friends hide part b by reports first, so it would be refunded.
    reportHide(id, b);
    expect(segment(id, b).hidden_by_reports).toBe(true);
    // The admin can still make it an admin hide: unhide, then hide.
    authorize(STORIES);
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, b, false, NO_REASON, "re-check"));
    new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(STORIES, id, b, true, COPYRIGHT, "matched a known book"));
    checkpoint();
    expect(segment(id, b).hidden_by_reports).toBe(false);

    const before = callsTo(MINT_ENTRY).length;
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, id, a));
    checkpoint();
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, id, b));
    checkpoint();
    expect(callsTo(MINT_ENTRY).length).toBe(before, "AB-012: a part hidden by the admin was refunded");
  });

  it("refunds never exceed what the story burned, with the new refund path", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest scene.");
    writeAsWriter(CARA, id, "Cara writes a line.");
    writeAsWriter(MALLORY, id, "Mallory writes a line.");
    reportHide(id, seq);
    authorize(ALICE);
    allowCalls(1);
    new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, id, seq));
    checkpoint();
    const st = story(id);
    expect(st.total_refunded <= st.total_burned).toBe(true, "refunds exceeded burns");
  });
});
