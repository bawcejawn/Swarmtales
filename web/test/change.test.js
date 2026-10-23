import assert from "node:assert/strict";
import test from "node:test";
import { changePrice, diffSpan, editPrice, editorChanged } from "../src/lib/change.js";
import { normalizePasted } from "../src/lib/text.js";

test("one deleted letter costs the 10-letter minimum, times 2", () => {
  const p = changePrice("plain and simple", "plan and simple", 0, 16);
  assert.equal(p.removed, 1);
  assert.equal(p.added, 0);
  assert.equal(p.price, 20n); // a BigInt, exact like the contract's u64 (AB-055)
  assert.equal(p.refund, 1);
});

// The third argument is segment.paid_changes: the writer's own edits are
// versions too, so the doubling counts paid changes only.
test("added letters cost, and the price doubles with each paid change", () => {
  const base = "Bob's first version of this part, plain and simple.";
  assert.equal(changePrice(base, base + " Cara adds this.", 0, base.length).price, 32n);
  assert.equal(changePrice(base + " Cara adds this.", base + " Dana adds this.", 1, base.length).price, 40n);
  assert.equal(changePrice("abc", "abcd", 2, 3).price, 80n);
  // Exact far past 2^53 (AB-055).
  assert.equal(String(changePrice("0123456789", "0123456789X", 54, 10).price), (10n << 55n).toString());
});

test("a cut never refunds letters someone else paid for; removing it refunds what was paid (AB-035, AB-044)", () => {
  assert.equal(changePrice("Bob wrote this. Cara added this.", "Bob wrote this.", 1, 15).refund, 0);
  assert.equal(changePrice("Bob wrote this. Cara added this.", "Bob wrote.", 1, 15).refund, 5);
  assert.equal(changePrice("Bob wrote this. Cara added this.", "", 1, 15).refund, 15);
});

test("the writer's own edit: rewording is free, growth costs 1 Ink a letter, a cut refunds", () => {
  const seg = { current_cost: "20", charged: "20", paid_changes: 0 };
  assert.deepEqual(editPrice(seg, "x".repeat(20)), { cost: 0, refund: 0, toWriter: 0, toPool: 0 });
  assert.deepEqual(editPrice(seg, "x".repeat(26)), { cost: 6, refund: 0, toWriter: 0, toPool: 0 });
  assert.deepEqual(editPrice(seg, "x".repeat(15)), { cost: 0, refund: 5, toWriter: 5, toPool: 0 });
  // After someone else's change, a cut refunds only what the writer paid beyond the new length (AB-044).
  assert.equal(editPrice({ ...seg, current_cost: "40", paid_changes: 1 }, "x".repeat(25)).refund, 0);
  assert.equal(editPrice({ ...seg, current_cost: "40", paid_changes: 1 }, "x".repeat(10)).refund, 10);
  // A pool-paid part gives back what the writer paid themselves first, then the pool.
  assert.deepEqual(editPrice({ current_cost: "50", charged: "50", own_paid: "8", fund_paid: true, paid_changes: 0 }, "x".repeat(40)),
    { cost: 0, refund: 10, toWriter: 8, toPool: 2 });
});

test("an untouched editor is not a change, even if the stored text has spaces at the ends (AB-042)", () => {
  for (const stored of ["Trailing space. ", "\nOpens with a break.", "Ends with a break.\n"]) {
    assert.equal(editorChanged(stored, stored, normalizePasted), false);
  }
  assert.equal(editorChanged("Trailing space. ", "Trailing space!", normalizePasted), true);
});

test("removing a whole part refunds everything the writer paid", () => {
  const p = changePrice("Twenty letters here!", "", 0, 20);
  assert.equal(p.removed, 20);
  assert.equal(p.price, 40n);
  assert.equal(p.refund, 20);
});

test("never splits an emoji in two", () => {
  const d = diffSpan("I love \u{1F600}!", "I love \u{1F601}!");
  assert.equal(d.removed, 2);
  assert.equal(d.added, 2);
});
