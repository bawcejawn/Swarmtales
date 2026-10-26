// Audit Bot red-team (Thief) attack test, SwarmTales commit 42f6af9.
// RT-THIEF-1: in an invite-only story, a writer pays for their own part
// themselves (the pool was low), then changes that part with revise_part
// while the pool is full again. The POOL pays the change price (4x the
// letters for a same-length rewrite), and the removed letters are refunded
// (minted) to the writer, although a same-length text stays in the story.
// The opener's pool is turned into the writer's personal Ink (4:1).
// RT-THIEF-3: an invited writer changes their own pool-paid part again and
// again; the pool pays every (doubling) change and gets nothing back.
// Asserts the SAFE behaviour: FAILS while the attack works.
// Helpers copied unchanged from stories/assembly/__tests__/Stories.funds.spec.ts
// and Stories.revise.spec.ts (trimmed to what is used).

import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { ownEditArgs } from "./reviewed";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // invited writer (the thief)
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // another invited writer

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const BURN_ENTRY: u32 = 2241834181;
const MINT_ENTRY: u32 = 3698268091;

const SHORT = stories.story_kind.KIND_SHORT;
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
  for (let i = 0; i < list.length; i++) {
    if (list[i].entry_point == entry) out.push(list[i]);
  }
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

// Alice opens a story with a fund: open fee, opening burn, fund burn.
function openFunded(vis: stories.visibility, max: u64, text: string, fund: u64): u64 {
  authorize(ALICE);
  allowCalls(3);
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "Funded", max, 1, 0, vis, 0, 0, text, false, <u64>text.length, USDT, true, 0, fund
  )).value;
  checkpoint();
  return id;
}

function invite(id: u64, who: Uint8Array): void {
  authorize(ALICE);
  new Stories().set_allowed(new stories.set_allowed_arguments(ALICE, id, [who], true));
  checkpoint();
}

// A writer with an active Writer membership: membership read, then burn.
function writeAsWriter(who: Uint8Array, id: u64, text: string): u64 {
  authorize(who);
  results([writer(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}

function removeAs(who: Uint8Array, id: u64, seq: u64): void {
  authorize(who);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(who, id, seq));
  checkpoint();
}

// revise_part: membership read, then (burn unless the pool pays), then refund mint.
function reviseIn(who: Uint8Array, id: u64, seq: u64, text: string, expected: u64): u32 {
  authorize(who);
  results([writer(), okCall(), okCall()]);
  const v = new Stories().revise_part(new stories.revise_part_arguments(who, id, seq, text, expected, true, 0, "", false)).value;
  checkpoint();
  return v;
}

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
  checkpoint();
}

// No closures in AssemblyScript: the refused call reads these.
let gId: u64 = 0;
let gSeq: u64 = 0;
function bobRevisesOwn(): void {
  authorize(BOB);
  results([writer(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(BOB, gId, gSeq, "y".repeat(100), 400, true, 0, "", false));
}

// Updated for rules 1 and 3 (decided after this audit): the pool pays only for
// new parts, never for revise_part, and a writer never uses revise_part on their
// own part (edit_segment rewords for free). The attacks now have to go through
// those paths, and the pool must come out untouched.
describe("RT-THIEF-1: pool-paid change refunds the writer for text that stays", () => {
  beforeEach(() => { reset(); configure(); });

  it("does not mint the writer's Ink back from a change the opener's pool paid for", () => {
    const id = openFunded(PRIVATE, 30000, "Private start.", 10010);
    invite(id, BOB);
    // 1) Bob empties the pool with five pool-paid parts (seq 2..6): pool 10 left.
    for (let i = 0; i < 5; i++) writeAsWriter(BOB, id, chars(2000));
    expect(story(id).fund).toBe(10);
    // 2) Pool too low: Bob pays his part P himself (seq 7).
    const P = "x".repeat(100);
    const pSeq = writeAsWriter(BOB, id, P);
    expect(segment(id, pSeq).fund_paid).toBe(false);
    // 3) Bob removes one pool-paid part for free: its 2000 go back to the pool.
    removeAs(BOB, id, 2);
    expect(story(id).fund).toBe(2010);
    const mintsBefore = callsTo(MINT_ENTRY).length;
    // 4) Bob can't revise his own part at all.
    gId = id; gSeq = pSeq;
    expect(bobRevisesOwn).toThrow("RT-THIEF-1: the writer revised their own part through revise_part");
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    // 5) Rewording it at the same length with edit_segment is free and refunds nothing.
    authorize(BOB);
    allowCalls(1);
    new Stories().edit_segment(ownEditArgs(BOB, id, pSeq, "y".repeat(100), 100));
    checkpoint();
    expect(segment(id, pSeq).current_cost).toBe(100);
    expect(story(id).fund).toBe(2010, "RT-THIEF-1: the pool paid for a change");
    expect(callsTo(MINT_ENTRY).length).toBe(mintsBefore,
      "RT-THIEF-1: a change minted the writer's own Ink back, text still in the story");
    expect(story(id).total_refunded).toBe(0,
      "RT-THIEF-1: story refunded Ink for a part that still holds the same number of letters");
  });
});

describe("RT-THIEF-3: the opener's pool pays for an invited writer's endless changes", () => {
  beforeEach(() => { reset(); configure(); });

  it("does not let an invited writer burn the opener's pool on changes to a part", () => {
    const id = openFunded(PRIVATE, 20000, "Private start.", 10000);
    invite(id, BOB);
    invite(id, CARA);
    let t = "Bob's part, paid for by the opener's pool.";
    const seq = writeAsWriter(BOB, id, t);
    const fundAfterPart = story(id).fund;
    expect(fundAfterPart).toBe(10000 - <u64>t.length);
    const burnsBefore = callsTo(BURN_ENTRY).length;
    // Eight one-letter changes by Cara: 20, 40, 80, ... 2560 = 5100 Ink.
    let price: u64 = 20;
    let paid: u64 = 0;
    for (let i = 0; i < 8; i++) {
      t = t + "!";
      reviseIn(CARA, id, seq, t, price);
      paid += price;
      price = price * 2;
    }
    // SAFE: the changer burns every change price herself; the pool only pays for writing.
    expect(callsTo(BURN_ENTRY).length).toBe(burnsBefore + 8, "RT-THIEF-3: a change was paid from the pool");
    expect(story(id).fund).toBe(fundAfterPart,
      "RT-THIEF-3: an invited writer spent the opener's pool on changes (pool Ink destroyed, never returned)");
    expect(paid).toBe(5100);
  });
});
