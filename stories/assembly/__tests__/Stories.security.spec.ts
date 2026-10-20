// =====================================================================
// Stories — tests for the October 2026 security fixes
//
//   H1  Every action must come straight from a transaction. A call that
//       arrives through another contract is refused, even when the
//       transaction carries the right wallet's signature.
//   M2  The final edit folds in removed text in bounded steps, and
//       anyone can push a long run along with advance_final_cursor.
//   New text must be at least 20 Ink units (the default), except the
//   piece that exactly fills the story.
//
// Signed invite links (H2) are tested in Stories.spec.ts, next to the
// rest of the private-story tests.
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
// Stands for some OTHER contract: an app a user signed a transaction for,
// which then tries to call Stories in that user's name.
const EVIL_APP = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const BURN_ENTRY: u32 = 2241834181;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const PRIVATE = stories.visibility.VISIBILITY_PRIVATE;
const DIRECT_ONLY = "STORIES: call SwarmTales directly from your wallet, not through another contract";

// ---------- helpers ----------

function checkpoint(): void {
  MockVM.commitTransaction();
}

function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
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

function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  MockVM.setCallContractResults(list);
}

function writerAnswer(): system_calls.exit_arguments {
  const m = new stories.shop_membership(2, START + 365 * DAY, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}

function burns(): i32 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let n = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point == BURN_ENTRY) n++;
  }
  return n;
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

function story(id: u64): stories.story {
  return new Stories().get_story(new stories.get_story_arguments(id));
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
  const c = new Stories();
  c.set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c.add_category(new stories.add_category_arguments("Fantasy"));
  checkpoint();
}

function openAs(opener: Uint8Array, max: u64, vis: stories.visibility, text: string): u64 {
  directly();
  authorize(opener);
  allowCalls(2);
  const id = new Stories().open_story(new stories.open_story_arguments(
    opener, SHORT, "My Tale", max, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0
  )).value;
  checkpoint();
  return id;
}

function writeAsOpener(id: u64, text: string): u64 {
  directly();
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

function removeAsOpener(id: u64, seq: u64): void {
  directly();
  authorize(ALICE);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, id, seq));
  checkpoint();
}

function keep(seq: u64): stories.final_item {
  return new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0);
}

function batch(id: u64, items: stories.final_item[]): void {
  directly();
  authorize(ALICE);
  allowCalls(items.length);
  new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, items));
  checkpoint();
}

function advance(id: u64): void {
  directly();
  authorize(BOB); // anyone
  new Stories().advance_final_cursor(new stories.advance_final_cursor_arguments(id));
  checkpoint();
}

function pdfHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(i + 1);
  return h;
}

const OPENING = "A lantern swung in the dark.";   // 28 characters

// ---------- H1: direct calls only ----------

describe("Stories security H1: only direct calls", () => {
  beforeEach(() => { reset(); });

  it("refuses to spend a writer's Ink when another contract calls in their name", () => {
    openAs(ALICE, 10000, PUBLIC, OPENING);
    const before = burns();
    fails(() => {
      viaOtherContract();
      authorize(BOB); // Bob DID sign the transaction, but for a different app.
      MockVM.setCallContractResults([writerAnswer(), okCall()]);
      new Stories().contribute(new stories.contribute_arguments(BOB, 1, "Spam posted in Bob's name.", false, false, 26, true, 0));
    }, DIRECT_ONLY);
    expect(burns()).toBe(before);
    expect(story(1).segment_count).toBe(1);

    // The same write, sent directly by Bob, works.
    directly();
    authorize(BOB);
    MockVM.setCallContractResults([writerAnswer(), okCall()]);
    new Stories().contribute(new stories.contribute_arguments(BOB, 1, "Bob writes this himself.", false, false, 24, true, 0));
    expect(story(1).segment_count).toBe(2);
  });

  it("refuses opening, editing, removing, closing and inviting through another contract", () => {
    openAs(ALICE, 10000, PRIVATE, OPENING);
    writeAsOpener(1, "A second sentence by Alice.");
    fails(() => {
      viaOtherContract(); authorize(ALICE); allowCalls(2);
      new Stories().open_story(new stories.open_story_arguments(ALICE, SHORT, "Fake", 10000, 1, 0, PUBLIC, 0, 0, OPENING, false, 28, USDT, true, 0));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE); allowCalls(1);
      new Stories().edit_segment(new stories.edit_segment_arguments(ALICE, 1, 2, "Rewritten by an app.", 20));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE); allowCalls(1);
      new Stories().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE);
      new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, 1, [EVIL_APP], true));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE);
      new Stories().set_editor(new stories.set_editor_arguments(ALICE, 1, EVIL_APP, true));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE);
      new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, Base58.decode(LINK_ADDRESSES[0]), 5, START + DAY));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE);
      new Stories().request_admin_finalize(new stories.request_admin_finalize_arguments(ALICE, 1, true));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(ALICE); allowCalls(1);
      new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT));
    }, DIRECT_ONLY);
    directly();
    expect(story(1).segment_count).toBe(2);
    expect(story(1).editor_count).toBe(0);
    expect(story(1).admin_finalize_requested).toBe(false);
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, EVIL_APP)).value).toBe(false);
  });

  it("refuses an invite join through another contract, even with a valid link signature", () => {
    openAs(ALICE, 10000, PRIVATE, OPENING);
    directly();
    authorize(ALICE);
    new Stories().create_invite(new stories.create_invite_arguments(ALICE, 1, Base58.decode(LINK_ADDRESSES[0]), 5, START + DAY));
    checkpoint();
    fails(() => {
      viaOtherContract(); authorize(BOB);
      new Stories().join_with_invite(new stories.join_with_invite_arguments(BOB, 1, 1, inviteSig(0, 1, 1)));
    }, DIRECT_ONLY);
    directly();
    expect(new Stories().is_allowed(new stories.is_allowed_arguments(1, BOB)).value).toBe(false);
  });

  it("refuses admin actions through another contract, even with the admin's signature", () => {
    fails(() => {
      viaOtherContract(); authorize(STORIES);
      new Stories().set_paused(new stories.set_paused_arguments(true));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(STORIES);
      new Stories().set_addresses(new stories.set_addresses_arguments(EVIL_APP, SHOP));
    }, DIRECT_ONLY);
    fails(() => {
      viaOtherContract(); authorize(STORIES);
      new Stories().set_admin(new stories.set_admin_arguments(EVIL_APP));
    }, DIRECT_ONLY);
    directly();
    const cfg = new Stories().get_config(new stories.get_config_arguments());
    expect(cfg.paused).toBe(false);
    expect(Base58.encode(cfg.ink!)).toBe(Base58.encode(INK));
    expect(Base58.encode(cfg.admin!)).toBe(Base58.encode(STORIES));
  });
});

// ---------- the 20-character minimum ----------

describe("Stories security: 20-character minimum for new text", () => {
  beforeEach(() => { reset(); });

  it("starts at 20", () => {
    expect(new Stories().get_config(new stories.get_config_arguments()).min_contribution).toBe(20);
  });

  it("refuses an opening shorter than 20", () => {
    fails(() => {
      authorize(ALICE); allowCalls(2);
      new Stories().open_story(new stories.open_story_arguments(ALICE, SHORT, "Tiny", 10000, 1, 0, PUBLIC, 0, 0, chars(19), false, 19, USDT, true, 0));
    }, "STORIES: opening text is shorter than the minimum");
  });

  it("refuses 19 characters, accepts 20", () => {
    openAs(ALICE, 10000, PUBLIC, OPENING);
    fails(() => {
      authorize(ALICE); allowCalls(1);
      new Stories().contribute(new stories.contribute_arguments(ALICE, 1, chars(19), false, false, 19, true, 0));
    }, "STORIES: text is shorter than the minimum (only the piece that fills the story may be shorter)");
    writeAsOpener(1, chars(20));
    expect(story(1).used_chars).toBe(48);
  });

  it("lets a short piece through only when it exactly fills the story", () => {
    openAs(ALICE, 10000, PUBLIC, OPENING);       // 28
    for (let i = 0; i < 4; i++) writeAsOpener(1, chars(2000));   // 8,028
    writeAsOpener(1, chars(1967));               // 9,995: 5 left
    fails(() => {
      authorize(ALICE); allowCalls(1);
      new Stories().contribute(new stories.contribute_arguments(ALICE, 1, chars(4), false, false, 4, true, 0));
    }, "STORIES: text is shorter than the minimum (only the piece that fills the story may be shorter)");
    writeAsOpener(1, chars(5));
    expect(story(1).used_chars).toBe(10000);
    expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
  });

  it("lets only the admin change the minimum, between 1 and 200", () => {
    fails(() => { authorize(BOB); new Stories().set_min_contribution(new stories.set_min_contribution_arguments(5)); }, "STORIES: admin authority required");
    fails(() => { authorize(STORIES); new Stories().set_min_contribution(new stories.set_min_contribution_arguments(0)); }, "STORIES: minimum text length must be 1 to 200");
    fails(() => { authorize(STORIES); new Stories().set_min_contribution(new stories.set_min_contribution_arguments(201)); }, "STORIES: minimum text length must be 1 to 200");
    authorize(STORIES);
    new Stories().set_min_contribution(new stories.set_min_contribution_arguments(200));
    checkpoint();
    expect(new Stories().get_config(new stories.get_config_arguments()).min_contribution).toBe(200);
  });
});

// ---------- M2: bounded final edit ----------

describe("Stories security M2: a long run of removed text cannot freeze the final edit", () => {
  beforeEach(() => { reset(); });

  it("folds in at most 50 removed segments per call, and advance_final_cursor moves the rest", () => {
    openAs(ALICE, 10000, PUBLIC, OPENING);                    // seq 1
    for (let i = 0; i < 60; i++) writeAsOpener(1, chars(20)); // seq 2..61
    for (let s: u64 = 2; s <= 61; s++) removeAsOpener(1, s);  // all removed
    // Fill to the top: 28 used, 9,972 left.
    for (let i = 0; i < 4; i++) writeAsOpener(1, chars(2000)); // seq 62..65
    writeAsOpener(1, chars(1972));                             // seq 66
    expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
    directly();
    authorize(ALICE);
    allowCalls(1);
    new Stories().close_story(new stories.close_story_arguments(ALICE, 1, USDT));
    checkpoint();

    // Keeping seq 1 and jumping to seq 62 in one call would need 60 skips.
    fails(() => {
      authorize(ALICE); allowCalls(2);
      new Stories().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(1), keep(62)]));
    }, "STORIES: a long run of removed text is next; call advance_final_cursor first");

    batch(1, [keep(1)]);
    expect(story(1).final_cursor).toBe(51);   // 1 kept + 50 removed folded in
    advance(1);
    expect(story(1).final_cursor).toBe(61);   // the other 10
    fails(() => { authorize(BOB); new Stories().advance_final_cursor(new stories.advance_final_cursor_arguments(1)); },
      "STORIES: nothing to skip; the next segment still needs the finalizer");

    batch(1, [keep(62), keep(63), keep(64), keep(65), keep(66)]);
    directly();
    authorize(ALICE);
    new Stories().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://book", pdfHash()));
    checkpoint();
    expect(story(1).status).toBe(stories.story_status.STATUS_FINALIZED);
  });

  it("refuses advance_final_cursor outside the final edit", () => {
    openAs(ALICE, 10000, PUBLIC, OPENING);
    fails(() => { authorize(BOB); new Stories().advance_final_cursor(new stories.advance_final_cursor_arguments(1)); },
      "STORIES: story is not in the final edit");
  });
});
