// Audit Bot stateful fuzz for Stories writing/revising (Swarmtales main @ 42f6af9).
// A seeded sequence of valid actions (contribute, paid revise by anyone, writer's free
// edit, writer's remove, paid remove) on one public story; after EVERY step:
//   1. story.used_chars == sum of current_cost over live parts
//   2. story.total_refunded <= story.total_burned
//   3. a part nobody else changed: charged == current_cost (refunds and paid
//      growth are exact); removed parts have charged == 0
//   4. Ink minted as refunds (events) <= Ink burned (events) for the story
// Copies with other seeds: -b, -c, -d. Failures print the seed and step.
// Updated for the rules decided after the audit: revise_part only by someone
// other than the writer; the writer's edit_segment rewords, shortens (always
// allowed, AB-040) or grows (paid). Invariant 3 was "charged <= current_cost";
// a cut after someone else's change now refunds nothing, so `charged` (what the
// writer paid and has not had back) may exceed the part's length.
import { MockVM, System, Protobuf } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  BOB, CARA, MALLORY, BURN_ENTRY, MINT_ENTRY, configure, openPublic, ownerEdit, ownerRemove, reset, revise, segment, story, write,
} from "./auditFixHelpers";

const SEED: u32 = 37;
const STEPS: i32 = 60;
let rngState: u32 = SEED;
function rnd(): u32 { let x = rngState; x ^= x << 13; x ^= x >> 17; x ^= x << 5; rngState = x; return x; }
function pick(n: u32): u32 { return rnd() % n; }
const WHO: Uint8Array[] = [BOB, CARA, MALLORY];
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
function eventTotals(): u64[] {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let minted: u64 = 0; let burned: u64 = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point == MINT_ENTRY) minted += Protobuf.decode<stories.ink_mint_call>(ev.payload!, stories.ink_mint_call.decode).value;
    if (ev.entry_point == BURN_ENTRY) burned += Protobuf.decode<stories.ink_burn_call>(ev.payload!, stories.ink_burn_call.decode).value;
  }
  return [minted, burned];
}
function check(id: u64, step: i32): void {
  const st = story(id);
  let used: u64 = 0;
  for (let s: u64 = 1; s <= st.segment_count; s++) {
    const g = segment(id, s);
    if (g.status == stories.segment_status.SEGMENT_ACTIVE) {
      used += g.current_cost;
      if (g.paid_changes == 0) expect(g.charged).toBe(g.current_cost, "seed " + SEED.toString() + " step " + step.toString() + ": charged != current_cost on unchanged part " + s.toString());
    } else {
      expect(g.charged).toBe(0, "seed " + SEED.toString() + " step " + step.toString() + ": removed part still charged");
    }
  }
  expect(st.used_chars).toBe(used, "seed " + SEED.toString() + " step " + step.toString() + ": used_chars drifted");
  expect(st.total_refunded <= st.total_burned).toBe(true, "seed " + SEED.toString() + " step " + step.toString() + ": refunds exceed burns");
  const t = eventTotals();
  expect(t[0] <= t[1]).toBe(true, "seed " + SEED.toString() + " step " + step.toString() + ": minted refunds exceed burns");
}

describe("AUDIT fuzz: Stories write/revise/edit/remove invariants", () => {
  beforeEach(() => { reset(); configure(); });

  it("holds every invariant for " + STEPS.toString() + " steps", () => {
    const id = openPublic();
    for (let step = 0; step < STEPS; step++) {
      const st = story(id);
      const live: u64[] = [];
      for (let s: u64 = 1; s <= st.segment_count; s++) {
        const g = segment(id, s);
        if (g.status == stories.segment_status.SEGMENT_ACTIVE && g.paid_changes < 8) live.push(s);
      }
      const action = live.length == 0 ? 0 : pick(6);
      let who = WHO[pick(3)];
      if (action == 0) {
        write(who, id, phrase(1 + <i32>pick(6)));
      } else {
        const seq = live[pick(<u32>live.length)];
        const g = segment(id, seq);
        const old = g.text!;
        // revise_part is for someone else's part.
        while (same(who, g.author!)) who = WHO[pick(3)];
        if (action == 1) revise(who, id, seq, old + " " + phrase(1 + <i32>pick(3)));            // append
        else if (action == 2 && old.length > 12) { let cut = old.length - 1 - <i32>pick(6); const c = old.charCodeAt(cut - 1); if (c >= 0xd800 && c <= 0xdbff) cut--; revise(who, id, seq, old.substring(0, cut) + "~" + (counter++).toString()); } // cut
        else if (action == 3) revise(who, id, seq, phrase(1) + " " + old);                     // prepend
        else if (action == 4) {
          // The writer's own edit: shorten, reword at the same length, or grow (paid).
          const owner = g.author!;
          const kind = pick(3);
          let cut = old.length - 2 - <i32>pick(4);
          if (cut > 0 && old.charCodeAt(cut - 1) >= 0xd800 && old.charCodeAt(cut - 1) <= 0xdbff) cut--;
          if (kind == 0 && cut > 1) ownerEdit(owner, id, seq, old.substring(0, cut) + "!");
          else if (kind == 1 && cut > 1) { const t = old.substring(0, cut) + "?" + (counter++).toString().substring(0, 1); ownerEdit(owner, id, seq, t != old ? t : t + "."); }
          else ownerEdit(owner, id, seq, old + " " + phrase(1 + <i32>pick(2)));
        } else {
          if (pick(2) == 0) ownerRemove(g.author!, id, seq);
          else revise(who, id, seq, "");
        }
      }
      check(id, step);
    }
  });
});
