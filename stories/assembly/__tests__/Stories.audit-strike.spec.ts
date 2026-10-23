// =====================================================================
// Audit Bot attack tests for the strike rule (SwarmTales fix check,
// commit 86d9b22, findings AB-028 and AB-029), ported to the paid-change
// model from PR #22: other wallets change a part with revise_part, and the
// part stays its writer's.
//
// Rule under test (owner's decision): a part nobody else changed strikes
// its writer automatically. Once anyone else changed it, even by one
// character or only by cutting words, the contract does not guess. A
// takedown waits for the admin to name who gets the strike (the writer or
// any wallet that changed the part), or to choose no strike.
//
// Attacks: a trim, a word swap, a public-story overwrite, and one change
// split into several small changes. Each test asserts the SAFE behaviour:
// nobody is struck by default for someone else's change, and whoever made
// the text can always be struck. The original audit asserted a smarter
// automatic default; tests marked [AB-028] / [AB-029] keep those attacks
// with the decided rule.
// =====================================================================
import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");    // another writer
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52"); // a second other writer

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;
const NEEDS_CHOICE = "STORIES: someone other than the writer changed this part; name who gets the strike, or choose no strike";
const NOT_A_CHANGER = "STORIES: strike the part's writer or a wallet that changed it";

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
function segment(id: u64, seq: u64): stories.segment { return new Stories().get_segment(new stories.get_segment_arguments(id, seq)); }
function strikes(who: Uint8Array): u32 { return new Stories().get_account_status(new stories.get_account_status_arguments(who)).strikes; }

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
function writeAsWriter(who: Uint8Array, id: u64, text: string): u64 {
  authorize(who);
  results([writer(), okCall()]);
  const seq = new Stories().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}
// What revise_part charges: everything between the common start and the
// common end counts, at least 10, times 2, doubling with every change.
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
// Someone else changes a part: the paid revise_part.
function change(as: Uint8Array, id: u64, seq: u64, text: string): void {
  const s = segment(id, seq);
  const price = changePrice(s.text != null ? s.text! : "", text, s.paid_changes);
  authorize(as);
  results([writer(), okCall(), okCall()]);
  new Stories().revise_part(new stories.revise_part_arguments(as, id, seq, text, price, true, 0, "", false));
  checkpoint();
}
function takedownStriking(id: u64, seq: u64, who: Uint8Array): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(id, seq, COPYRIGHT, "notice 2026-002", who));
  checkpoint();
}
function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}
// Closures cannot capture locals in AssemblyScript: tests pass values through these.
let ID: u64 = 0;
let SEQ: u64 = 0;
let WHO: Uint8Array = new Uint8Array(0);
function strikeAs(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(ID, SEQ, COPYRIGHT, "notice 2026-003", WHO));
}
function takedownByDefault(): void {
  authorize(STORIES);
  new Stories().takedown_segment(new stories.takedown_segment_arguments(ID, SEQ, COPYRIGHT, "notice 2026-001"));
}
// A default takedown of a part someone else changed is refused and strikes nobody.
function defaultIsRefused(id: u64, seq: u64): void {
  ID = id; SEQ = seq;
  fails(() => { takedownByDefault(); }, NEEDS_CHOICE);
  expect(segment(id, seq).taken_down).toBe(false);
}

// ---------------------------------------------------------------------
// 1. Trim
// ---------------------------------------------------------------------

describe("AUDIT strike rule: a trim", () => {
  beforeEach(() => { reset(); configure(); });

  it("original AB-023 attack: a one-character trim does not move the strike off the writer by itself", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes a paragraph from a novel.");
    change(CARA, id, seq, "Bob pastes a paragraph from a novel");
    defaultIsRefused(id, seq);
    expect(strikes(CARA)).toBe(0, "AB-023: the wallet that only trimmed was struck by default");
    takedownStriking(id, seq, BOB);
    expect(strikes(BOB)).toBe(1, "AB-023: the writer of the copied words could not be struck");
    expect(strikes(CARA)).toBe(0);
  });

  it("[AB-028] a cut that leaves different words can be charged to the wallet that made it", () => {
    const id = openShort();
    // Bob's honest sentence. Cara deletes words only, and what is left says
    // the opposite: every character of the new text was already there, in order.
    const seq = writeAsWriter(BOB, id, "My grandmother said: do not ever steal, and never lie to the people who trust you.");
    change(CARA, id, seq, "do steal, and lie to the people who trust you.");
    expect(segment(id, seq).last_edited_by!).toStrictEqual(CARA);
    ID = id; SEQ = seq; WHO = CARA;
    expect(() => { strikeAs(); }).not.toThrow("AB-028: the admin cannot strike the wallet whose cut made the text");
    expect(strikes(CARA)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });

  it("[AB-028] several small trims (one change split up) never strike the writer by default, and the cutter can be struck", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "My grandmother said: do not ever steal, and never lie to the people who trust you.");
    change(CARA, id, seq, "My grandmother said: do ever steal, and never lie to the people who trust you.");
    change(CARA, id, seq, "My grandmother said: do steal, and never lie to the people who trust you.");
    change(CARA, id, seq, "My grandmother said: do steal, and lie to the people who trust you.");
    defaultIsRefused(id, seq);
    expect(strikes(BOB)).toBe(0, "AB-028: the writer took the strike for meaning someone else made by cutting words");
    takedownStriking(id, seq, CARA);
    expect(strikes(CARA)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 2. Word swap
// ---------------------------------------------------------------------

describe("AUDIT strike rule: a word swap", () => {
  beforeEach(() => { reset(); configure(); });

  it("a wallet that swaps in a word can be struck; the part stays the writer's", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes a quiet scene by the sea.");
    change(CARA, id, seq, "Bob writes a quiet scene by the bay.");
    expect(segment(id, seq).author!).toStrictEqual(BOB);
    expect(segment(id, seq).edited_by_others).toBe(true);
    takedownStriking(id, seq, CARA);
    expect(strikes(CARA)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });

  it("swapping the order of two words counts as a change", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "the red and the blue boats sailed.");
    change(CARA, id, seq, "the blue and the red boats sailed.");
    expect(segment(id, seq).edited_by_others).toBe(true);
    defaultIsRefused(id, seq);
  });

  it("[AB-029] an opener's one-letter typo fix in a writer's copied paragraph does not take the strike by default", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes teh opening page of a famous novel.");
    change(ALICE, id, seq, "Bob pastes the opening page of a famous novel.");
    defaultIsRefused(id, seq);
    expect(strikes(ALICE)).toBe(0, "AB-029: an honest opener who fixed one typo was struck for the writer's copied text");
    takedownStriking(id, seq, BOB);
    expect(strikes(ALICE)).toBe(0);
    expect(strikes(BOB)).toBe(1, "AB-029: the writer who pasted the text could not be struck");
  });

  it("the admin can put that strike on the writer by hand", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes teh opening page of a famous novel.");
    change(ALICE, id, seq, "Bob pastes the opening page of a famous novel.");
    takedownStriking(id, seq, BOB);
    expect(strikes(BOB)).toBe(1);
    expect(strikes(ALICE)).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 3. Public-story overwrite
// ---------------------------------------------------------------------

describe("AUDIT strike rule: a public-story overwrite", () => {
  beforeEach(() => { reset(); configure(); });

  it("an opener who overwrites a writer's part with new text can be struck, and the writer is not struck by default", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes a quiet scene by the sea.");
    change(ALICE, id, seq, "Alice puts in a page from a novel...");
    defaultIsRefused(id, seq);
    takedownStriking(id, seq, ALICE);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(ALICE)).toBe(1);
  });

  it("[AB-028] an overwrite made only of cuts: the opener can be named", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id,
      "The guards at the harbour never let anybody in after dark; wait for the morning bell.");
    // Alice cuts words: the rule now says the opposite.
    change(ALICE, id, seq, "The guards let anybody in after dark");
    ID = id; SEQ = seq; WHO = ALICE;
    expect(() => { strikeAs(); }).not.toThrow("AB-028: the opener who carved the text out of the writer's words cannot be struck");
    expect(strikes(ALICE)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 4. One change split into several small changes
// ---------------------------------------------------------------------

describe("AUDIT strike rule: one change split into several changes", () => {
  beforeEach(() => { reset(); configure(); });

  it("a cut followed by an addition: the wallet that made both can be struck", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes a quiet scene by the sea.");
    change(CARA, id, seq, "Bob writes a quiet scene by the");
    change(CARA, id, seq, "Bob writes a quiet scene by the bay.");
    defaultIsRefused(id, seq);
    takedownStriking(id, seq, CARA);
    expect(strikes(CARA)).toBe(1);
    expect(strikes(BOB)).toBe(0);
  });

  it("[AB-028] a planter's words, then someone else's one-letter fix: the planter can still be struck", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest paragraph about his town.");
    // Mallory plants copied words, leaving a typo in them.
    change(MALLORY, id, seq, "Mallory pastes teh first page of a novel.");
    // Cara, an honest writer, fixes the typo.
    change(CARA, id, seq, "Mallory pastes the first page of a novel.");
    ID = id; SEQ = seq; WHO = MALLORY;
    expect(() => { strikeAs(); }).not.toThrow("AB-028: after one honest fix, the wallet that planted the words can no longer be struck");
    expect(strikes(MALLORY)).toBe(1);
    expect(strikes(CARA)).toBe(0);
  });

  it("[AB-029] the same split through a second wallet does not move the strike off the planter", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest paragraph about his town.");
    change(MALLORY, id, seq, "Mallory pastes the first page of a novel.");
    change(CARA, id, seq, "Mallory pastes the first page of a novel!");   // one character
    defaultIsRefused(id, seq);
    expect(strikes(CARA)).toBe(0, "AB-029: the one-character fixer was struck by default");
    takedownStriking(id, seq, MALLORY);
    expect(strikes(MALLORY)).toBe(1, "AB-029: the wallet that planted the words escaped the strike");
    expect(strikes(CARA)).toBe(0);
  });

  it("the writer cannot be framed by splitting: no default strike, and the wallet that changed it can be struck", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob writes an honest paragraph about his town.");
    change(CARA, id, seq, "Bob writes a paragraph about his town.");
    change(CARA, id, seq, "Bob writes a paragraph about his town, copied.");
    defaultIsRefused(id, seq);
    expect(strikes(BOB)).toBe(0);
    takedownStriking(id, seq, CARA);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(CARA)).toBe(1);
  });
});

// ---------------------------------------------------------------------
// 5. The `strike` argument (new surface)
// ---------------------------------------------------------------------

describe("AUDIT strike rule: the strike argument", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses short, long and unrelated addresses and leaves the part untouched", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes a paragraph from a novel.");
    const odd: Uint8Array[] = [new Uint8Array(1), new Uint8Array(24), new Uint8Array(26), STORIES, ALICE];
    for (let i = 0; i < odd.length; i++) {
      ID = id; SEQ = seq; WHO = odd[i];
      fails(() => { strikeAs(); }, NOT_A_CHANGER);
    }
    expect(segment(id, seq).taken_down).toBe(false);
    expect(strikes(BOB)).toBe(0);
  });

  it("a stranger cannot take down or pick whom to strike", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes a paragraph from a novel.");
    ID = id; SEQ = seq; WHO = BOB;
    expect(() => {
      authorize(CARA);
      new Stories().takedown_segment(new stories.takedown_segment_arguments(ID, SEQ, COPYRIGHT, "", WHO));
    }).toThrow();
    MockVM.rollbackTransaction();
    MockVM.commitTransaction();
    expect(strikes(BOB)).toBe(0);
  });

  it("cannot strike twice for one part", () => {
    const id = openShort();
    const seq = writeAsWriter(BOB, id, "Bob pastes a paragraph from a novel.");
    ID = id; SEQ = seq;
    takedownByDefault();
    checkpoint();
    WHO = BOB;
    fails(() => { strikeAs(); }, "STORIES: part was already taken down");
    expect(strikes(BOB)).toBe(1);
  });
});
