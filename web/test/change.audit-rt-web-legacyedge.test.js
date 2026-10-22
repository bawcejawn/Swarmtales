// Audit Bot red-team (Web attacker) tests, fix check @ 00eec36: page prices vs.
// Stories.ts for inputs the earlier parity fuzzers never generate.
//
// 1) LEGACY charged > current_cost. Before 867b025, cutRefund returned 0 when
//    paid_changes > 0 (git show 26c17e9~5:stories/assembly/Stories.ts ~1977),
//    so a part cut after someone else's change kept charged > current_cost.
//    Those parts are still on testnet after the upgrade. edit_segment now does
//    growth = newCost - current_cost AND refund = cutRefund = charged - newCost
//    in the SAME call (Stories.ts ~847-858). editPrice (change.js ~95) sets
//    refund = 0 whenever cost > 0, so the page shows "costs N Ink" and hides
//    the refund the contract mints (and toWriter/toPool split).
//    SAFE: editPrice's refund equals the contract's for such a part.
//
// 2) Multiplier label above 2^53. changeMultiplier returns a Number; main.js
//    prints it with "×" + p.multiplier and "×" + p.multiplier * 2
//    (changePanel ~1325-1327, tool title ~1193). From paid_changes 54 the
//    printed decimal is not 2^(n+1) (String(2**56) = "72057594037927940"), so
//    "units x multiplier = price" no longer adds up on screen.
//    SAFE: the multiplier (and the doubled next one) print exactly.
//
// 3) Edge-whitespace price inflation. Stories.requireText accepts leading or
//    trailing spaces / line breaks. A writer (or a changer, via a direct
//    contract call) stores " <text> ". changePanel prices
//    normalizePasted(area.value).trim() (main.js current()), so a visitor who
//    fixes ONE letter in the middle is charged for removing and re-adding the
//    whole part (diff span from the first to the last unit): a 1,000-letter
//    part costs ~2,000 x multiplier instead of 10 x multiplier, and the
//    writer gets a refund for the two trimmed spaces.
//    SAFE: a one-letter fix costs the 10-letter minimum x multiplier.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { changeMultiplier, changePrice, editPrice } from "../src/lib/change.js";
import { normalizePasted } from "../src/lib/text.js";

// Contract port (Stories.ts edit_segment + cutRefund + settleRefund), BigInt.
function contractEdit(seg, newText) {
  const newCost = BigInt(newText.length);
  const oldCost = BigInt(seg.current_cost);
  const charged = BigInt(seg.charged);
  const growth = newCost > oldCost ? newCost - oldCost : 0n;
  const refund = charged > newCost ? charged - newCost : 0n;
  let toWriter = refund;
  if (seg.fund_paid) {
    const own = BigInt(seg.own_paid || 0);
    toWriter = refund < own ? refund : own;
  }
  return { cost: growth, refund, toWriter, toPool: refund - toWriter };
}

test("RT-WEB: a pre-upgrade part (charged > current_cost) shows the refund edit_segment mints when the writer grows it", () => {
  const cases = [
    { charged: "100", current_cost: "50", paid_changes: "1" },
    { charged: "300", current_cost: "120", paid_changes: "2", fund_paid: true, own_paid: "40" },
  ];
  for (const seg of cases) {
    const text = "w".repeat(Number(seg.current_cost) + 30); // grows by 30, still below charged
    const page = editPrice(seg, text);
    const chain = contractEdit(seg, text);
    assert.equal(BigInt(page.cost), chain.cost, "growth cost");
    assert.equal(BigInt(page.refund), chain.refund,
      "LEGACY-EDIT: page shows refund " + page.refund + " but edit_segment burns " + chain.cost + " and mints back " +
      chain.refund + " (charged " + seg.charged + " > current " + seg.current_cost + ")");
    assert.equal(BigInt(page.toPool), chain.toPool, "pool share");
  }
});

test("RT-WEB: the shown change multiplier (and the next one) print as the exact contract integer", () => {
  for (let paid = 0; paid < 60; paid++) {
    const m = changeMultiplier(paid);
    assert.equal(String(m), (1n << BigInt(paid + 1)).toString(),
      "MULTIPLIER-LABEL: '×" + String(m) + "' shown for paid_changes " + paid);
    if (paid < 59) {
      // Fixed by the fixer: `m * 2` throws once m is the BigInt this test asks for
      // (BigInt and Number can't mix), so double it in m's own type, as main.js does.
      const next = m * (typeof m === "bigint" ? 2n : 2);
      assert.equal(String(next), (1n << BigInt(paid + 2)).toString(),
        "NEXT-MULTIPLIER-LABEL: 'next change will cost ×" + String(next) + "' for paid_changes " + paid);
    }
  }
});

test("RT-WEB: a one-letter fix to a part stored with edge whitespace is not priced as rewriting the whole part", () => {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const a = src.indexOf("function changePanel(");
  const panel = src.slice(a, src.indexOf("function refundLine(", a));
  // The page's own pipeline: what it prices and sends.
  const trims = /const current = \(\) => normalizePasted\(area\.value\)\.trim\(\)/.test(panel);
  const pipeline = (box) => (trims ? normalizePasted(box).trim() : normalizePasted(box));
  const body = "The knight rode north through the rain and the long dark. ".repeat(17).trim();
  for (const oldText of [" " + body + " ", "\n" + body + "\n", " " + body, body + "　"]) {
    const mid = Math.floor(oldText.length / 2);
    const ch = oldText[mid] === "x" ? "y" : "x";
    const box = oldText.slice(0, mid) + ch + oldText.slice(mid + 1); // the visitor changes ONE letter
    const p = changePrice(oldText, pipeline(box), 0, oldText.length);
    assert.equal(p.units, 10,
      "EDGE-TRIM: one changed letter in a " + oldText.length + "-letter part with edge whitespace is priced as " +
      p.units + " units (" + String(p.price) + " Ink at x2) because the page trims what it sends");
  }
});
