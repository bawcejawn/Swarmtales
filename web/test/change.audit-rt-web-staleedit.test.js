// Audit Bot red-team (Web attacker) test: the writer's own edit burns Ink
// that the page never showed and the signed operation never names.
//
// main.js editPanel (lines ~1228-1281) prices the edit from the part as it was
// when the page was rendered (editPrice(seg, text): cost = length - seg.current_cost)
// and shows "Free." / a plain "Save edit" button. It then sends
// edit_segment { editor, story_id, seq, new_text, expected_cost: quoteCost(text) }.
// expected_cost is only the NEW TEXT LENGTH (Stories.ts:814
// `newCost == args.expected_cost`); the Ink actually burned is
// growth = newCost - seg.current_cost read AT EXECUTION (Stories.ts:825, 865-867).
// Nothing in the signed operation bounds that burn.
//
// Sequence: Bob's part is 600 letters and was already changed once by
// someone else (paid_changes 1, so cuts refund nothing). Bob opens "Edit"
// (page: current_cost 600) and rewords it, keeping 600 letters: the page says
// "Free.". Meanwhile Cara (or a griefer) uses revise_part to cut the part to
// 20 letters (pays 580 x 4 = 2,320 Ink; no refund to Bob since paid_changes > 0).
// Bob presses "Save edit": the transaction is valid, Bob's text replaces Cara's,
// and the contract burns 580 of Bob's Ink, which the page showed as free and
// Kondor/Vault show only as "expected_cost: 600". The Ink sits in seg.charged
// and only comes back if the whole part is removed. An ordinary concurrent
// change does this by accident. (Same root cause: a shown cut refund silently
// becomes 0 if paid_changes goes 0 -> 1 before the edit lands; and with
// paid_changes 0 in a pool-paid part, Cara's cut refund goes to the pool while
// Bob's re-growth is burned from Bob.)
//
// SAFE behaviour asserted: the edit_segment arguments carry a field the
// contract checks against the Ink it burns (e.g. expected_ink == growth, or a
// max_ink cap), so a stale page is refused instead of overcharging.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { changePrice, editPrice } from "../src/lib/change.js";
import { abis } from "../src/generated/abis.js";

function findMessage(node, name) {
  if (!node || typeof node !== "object") return null;
  if (node[name] && node[name].fields) return node[name];
  for (const v of Object.values(node)) {
    const hit = findMessage(v, name);
    if (hit) return hit;
  }
  return null;
}

// Contract port of the economic part of edit_segment (Stories.ts:794-870).
function contractEditBurn(liveSeg, text, args) {
  const newCost = text.length;
  if (String(newCost) !== String(args.expected_cost)) throw new Error("STORIES: Ink cost does not match expected_cost");
  const growth = Math.max(0, newCost - Number(liveSeg.current_cost));
  // If the arguments ever carry an Ink bound, honour it the way a fix would.
  for (const k of ["expected_ink", "expected_growth", "expected_burn"]) {
    if (k in args && String(args[k]) !== String(growth)) throw new Error("STORIES: Ink does not match " + k);
  }
  for (const k of ["max_ink", "max_burn"]) {
    if (k in args && growth > Number(args[k])) throw new Error("STORIES: Ink is over " + k);
  }
  return growth;
}

test("RT-WEB: a stale edit page can't make the writer burn Ink it showed as free", () => {
  const before = "B".repeat(600);
  const pageSeg = { text: before, charged: "600", current_cost: "600", paid_changes: 1, author: "1Bob" };
  const bobText = "b".repeat(600); // reworded, same length
  const shown = editPrice(pageSeg, bobText);
  assert.equal(shown.cost, 0, "the page shows the edit as free");

  // Meanwhile Cara cuts the part with revise_part (contract-accepted, she pays).
  const caraText = "B".repeat(20);
  const caraPrice = changePrice(before, caraText, 1, 600).price; // no refund to Bob: paid_changes > 0
  const liveSeg = { text: caraText, charged: "600", current_cost: "20", paid_changes: 2 };

  // What main.js builds (editPanel): expected_cost = quoteCost(text) = text length.
  const fields = Object.keys((findMessage(abis.stories, "edit_segment_arguments") || { fields: {} }).fields);
  const args = { editor: "1Bob", story_id: "1", seq: "1", new_text: bobText, expected_cost: String(bobText.length) };
  for (const f of fields) if (/ink|burn|growth|max_/.test(f) && !(f in args)) args[f] = String(shown.cost);

  let burned = null;
  try {
    burned = contractEditBurn(liveSeg, bobText, args);
  } catch {
    burned = null; // refused: safe
  }
  assert.ok(burned === null || burned === shown.cost,
    "STALE-EDIT OVERCHARGE: page showed " + shown.cost + " Ink, contract burns " + burned +
    " Ink of the writer's (griefer paid " + caraPrice + "). edit_segment_arguments fields: " + fields.join(", ") +
    " - none binds the Ink burned; expected_cost is only the new length.");
});
