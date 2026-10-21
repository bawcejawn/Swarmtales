// Audit Bot red-team (Web attacker) test: expected_ink for heavily changed parts.
// main.js changePanel sends expected_ink: String(p.price) where
// p.price = units * 2 ** (paid_changes + 1) is a JS Number. Above 2^53 the
// product is still an exact power-of-two multiple, but String() prints the
// SHORTEST round-trip decimal, e.g. String(10 * 2**55) = "360287970189639700"
// while the contract (Stories.ts revise_part, u64) wants 360287970189639680.
// From paid_changes ~54 up to the contract's limit of 60 the page always sends
// a wrong expected_ink: every change is refused (refusal loop, mana wasted),
// and the shown price is rounded. Impact is informational (nobody holds
// ~1e17 Ink), but the page claims to mirror the contract exactly.
// SAFE: for every paid_changes the contract accepts and every u64-sized
// price, the string the page would send equals the contract's integer.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { changePrice } from "../src/lib/change.js";

const U64_MAX = (1n << 64n) - 1n;

test("RT-WEB: expected_ink is the exact contract integer up to the 60-change limit", () => {
  const oldText = "0123456789abcdefghij";
  const newText = "0123456789ABCDEFGHIJ"; // 10 replaced -> 20 units
  const short = "0123456789abcdefghiX"; // 1 replaced -> 10 units (minimum)
  for (const [a, b] of [[oldText, newText], [oldText, short]]) {
    for (let paid = 0; paid < 60; paid++) {
      const p = changePrice(a, b, paid, a.length);
      const want = BigInt(p.units) * (1n << BigInt(paid + 1));
      if (want > U64_MAX) continue; // the contract reverts (SafeMath) anyway
      assert.equal(String(p.price), want.toString(),
        "BIG-PRICE: page would send expected_ink " + String(p.price) + " but revise_part computes " + want + " (paid_changes " + paid + "): refused every time");
    }
  }
});
