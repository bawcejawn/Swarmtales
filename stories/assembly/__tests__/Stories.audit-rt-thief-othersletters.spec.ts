// Audit Bot red-team (Thief) attack test, SwarmTales commit 42f6af9.
// RT-THIEF-2: revise_part refunds removed letters to the part's writer
// (min(removed, charged)), not "to whoever paid for them" as the code
// comment at Stories.ts:1129 promises. Cara pays to ADD 16 letters to Bob's
// part; then Bob (or anyone) cuts exactly Cara's 16 letters. Bob is minted
// 16 Ink and his part's `charged` drops, although every letter Bob paid for
// is still in the story. Cara's payment became Bob's refund.
// Asserts the SAFE behaviour: FAILS while the attack works.
// Helpers copied from stories/assembly/__tests__/Stories.revise.spec.ts.
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // changer
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52"); // another changer

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const BURN_ENTRY: u32 = 2241834181;
const MINT_ENTRY: u32 = 3698268091;

const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;

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

function openShort(): u64 {
  authorize(ALICE);
  allowCalls(3);
  const text = "Once upon a time.";
  const id = new Stories().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "My Tale", 10000, 1, 0, PUBLIC, 0, 0, text, false, <u64>text.length, USDT, true, 0, 0
  )).value;
  checkpoint();
  return id;
}

const BOB_TEXT = "Bob's first version of this part, plain and simple.";

describe("RT-THIEF-2: refund for letters another wallet paid for", () => {
  beforeEach(() => { reset(); configure(); });

  it("does not refund the writer when only letters someone else paid for are cut", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, BOB_TEXT);
    const L = <u64>BOB_TEXT.length;
    // Cara adds 16 letters and pays 16 x 2 = 32 (as in Stories.revise.spec.ts).
    reviseIn(CARA, id, seq, BOB_TEXT + " Cara adds this.", 32);
    expect(segment(id, seq).charged).toBe(L);
    const mintsBefore = callsTo(MINT_ENTRY).length;
    // Someone else cuts exactly Cara's 16 letters: 16 x 4 = 64 (second change).
    // (Updated for rule 3: Bob can't use revise_part on his own part; with
    // edit_segment a cut refunds nothing once someone else changed the part.)
    reviseIn(MALLORY, id, seq, BOB_TEXT, 64);
    expect(segment(id, seq).text).toBe(BOB_TEXT);   // all of Bob's paid letters are still there
    // SAFE: Bob paid for every letter that is still there, so nothing is refunded to him.
    expect(callsTo(MINT_ENTRY).length).toBe(mintsBefore,
      "RT-THIEF-2: the writer was refunded for letters another wallet paid for, while all their own text stays");
    expect(segment(id, seq).charged).toBe(L,
      "RT-THIEF-2: the part's charged dropped below the writer's surviving letters (later refunds/surviving credit understated, refund given for text that stays)");
  });
});
