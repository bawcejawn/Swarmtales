// Audit Bot stateful fuzz (Swarmtales, branch audit-fixes-2 @ e5255c6): rules 1-3 money paths.
// Seeded random valid actions on one invite-only (pool) story: contribute (the pool pays new parts while it
// can), paid change by someone else (append, cut, prepend, remove), the writer's own edit
// (shorten, reword, grow), the writer's removal. After EVERY step:
//   1. used_chars == sum of live current_cost
//   2. total_refunded <= total_burned
//   3. per wallet: Ink minted to it as refunds <= Ink it burned (no wallet earns Ink)
//   4. pool: fund + sum over live pool-paid parts of (charged - own_paid) == what the opener put in
//      (the pool never pays changes or growth and never loses Ink to a writer), own_paid <= charged
//   5. removed parts: charged == 0 and own_paid == 0
// Asserts the SAFE behaviour; failures print the seed and step.
import { MockVM, System, Protobuf } from "@koinos/sdk-as";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, MALLORY, BURN_ENTRY, MINT_ENTRY, PRIVATE, configure, invite, openAs, openPublic, ownerEdit, ownerRemove,
  reset, revise, segment, story, write,
} from "./auditFixHelpers";

const SEED: u32 = 7;
const STEPS: i32 = 80;
const POOL: bool = true;
let rngState: u32 = SEED;
function rnd(): u32 { let x = rngState; x ^= x << 13; x ^= x >> 17; x ^= x << 5; rngState = x; return x; }
function pick(n: u32): u32 { return rnd() % n; }
const WHO: Uint8Array[] = [BOB, CARA, MALLORY, ALICE];
const WORDS: string[] = ["river", "lamp", "stone", "ember", "quiet", "north", "salt", "glass", "\u{1F600}", "wind"];
let counter: i32 = 0;
function phrase(n: i32): string {
  let s = "p" + (counter++).toString();
  for (let i = 0; i < n; i++) s += " " + WORDS[pick(<u32>WORDS.length)];
  return s + ".";
}
function same(a: Uint8Array, b: Uint8Array): bool {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
  return true;
}
// [minted to who, burned from who]
function totals(who: Uint8Array): u64[] {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let minted: u64 = 0; let burned: u64 = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point == MINT_ENTRY) {
      const m = Protobuf.decode<stories.ink_mint_call>(ev.payload!, stories.ink_mint_call.decode);
      if (same(m.to!, who)) minted += m.value;
    }
    if (ev.entry_point == BURN_ENTRY) {
      const b = Protobuf.decode<stories.ink_burn_call>(ev.payload!, stories.ink_burn_call.decode);
      if (same(b.from!, who)) burned += b.value;
    }
  }
  return [minted, burned];
}
let deposited: u64 = 0;
function check(id: u64, step: i32): void {
  const tag = "seed " + SEED.toString() + " step " + step.toString() + ": ";
  const st = story(id);
  let used: u64 = 0;
  let poolShare: u64 = 0;
  for (let s: u64 = 1; s <= st.segment_count; s++) {
    const g = segment(id, s);
    if (g.status == stories.segment_status.SEGMENT_ACTIVE) {
      used += g.current_cost;
      if (g.fund_paid) {
        expect(g.own_paid <= g.charged).toBe(true, tag + "own_paid > charged on part " + s.toString());
        poolShare += g.charged - g.own_paid;
      } else {
        expect(g.own_paid).toBe(0, tag + "own_paid on a writer-paid part " + s.toString());
      }
    } else {
      expect(g.charged).toBe(0, tag + "removed part still charged");
      expect(g.own_paid).toBe(0, tag + "removed part still own_paid");
    }
  }
  expect(st.used_chars).toBe(used, tag + "used_chars drifted");
  expect(st.total_refunded <= st.total_burned).toBe(true, tag + "refunds exceed burns");
  if (POOL) expect(st.fund + poolShare).toBe(deposited, tag + "pool accounting: fund " + st.fund.toString() + " + pool share " + poolShare.toString());
  for (let w = 0; w < 3; w++) {
    const t = totals(WHO[w]);
    expect(t[0] <= t[1]).toBe(true, tag + "wallet " + w.toString() + " minted " + t[0].toString() + " > burned " + t[1].toString());
  }
}

// Edits add a counter so random texts never collide with the duplicate-text rule (audit F-03).
describe("AUDIT fuzz (" + (POOL ? "pool" : "public") + ", seed " + SEED.toString() + "): rules 1-3 money paths", () => {
  beforeEach(() => { reset(); configure(); });

  it("holds every invariant for " + STEPS.toString() + " steps", () => {
    let id: u64 = 0;
    if (POOL) {
      id = openAs(PRIVATE, 10000);
      invite(id, BOB, true); invite(id, CARA, true); invite(id, MALLORY, true);
      deposited = story(id).fund;
      // the opening text is a pool-paid part only if the pool paid it; include it in the share
      const g1 = segment(id, 1);
      if (g1.fund_paid) deposited = deposited + g1.charged - g1.own_paid;
    } else {
      id = openPublic();
    }
    for (let step = 0; step < STEPS; step++) {
      const st = story(id);
      const live: u64[] = [];
      for (let s: u64 = 1; s <= st.segment_count; s++) {
        const g = segment(id, s);
        if (g.status == stories.segment_status.SEGMENT_ACTIVE && g.paid_changes < 6 && g.version_count < 90) live.push(s);
      }
      const action = live.length == 0 ? 0 : pick(8);
      let who = WHO[pick(3)];
      if (action == 0) {
        write(who, id, phrase(1 + <i32>pick(6)));
      } else {
        const seq = live[pick(<u32>live.length)];
        const g = segment(id, seq);
        const old = g.text!;
        const owner = g.author!;
        while (same(who, owner)) who = WHO[pick(4)];
        if (action == 1) revise(who, id, seq, old + " " + phrase(1 + <i32>pick(3)));
        else if (action == 2 && old.length > 12) { let cut = old.length - 1 - <i32>pick(8); const c = old.charCodeAt(cut - 1); if (c >= 0xd800 && c <= 0xdbff) cut--; revise(who, id, seq, old.substring(0, cut) + "~" + (counter++).toString()); }
        else if (action == 3) revise(who, id, seq, phrase(1) + " " + old);
        else if (action >= 4 && action <= 6) {
          const kind = pick(4);
          let cut = old.length - 2 - <i32>pick(10);
          if (cut > 0 && old.charCodeAt(cut - 1) >= 0xd800 && old.charCodeAt(cut - 1) <= 0xdbff) cut--;
          if (kind == 0 && cut > 1) ownerEdit(owner, id, seq, old.substring(0, cut) + "!" + (counter++).toString());
          else if (kind == 1 && cut > 1) { const t = old.substring(0, cut) + "?" + (counter++).toString().substring(0, 1); ownerEdit(owner, id, seq, t != old ? t : t + "."); }
          else if (kind == 2 && old.length > 4) ownerEdit(owner, id, seq, old.substring(0, 2) + "#" + (counter++).toString());
          else ownerEdit(owner, id, seq, old + " " + phrase(1 + <i32>pick(4)));
        } else {
          if (pick(2) == 0) ownerRemove(owner, id, seq);
          else revise(who, id, seq, "");
        }
      }
      check(id, step);
    }
  });
});
