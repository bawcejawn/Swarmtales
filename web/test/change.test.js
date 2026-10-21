import assert from "node:assert/strict";
import test from "node:test";
import { changePrice, diffSpan } from "../src/lib/change.js";

test("one deleted letter costs the 10-letter minimum, times 2", () => {
  const p = changePrice("plain and simple", "plan and simple", 0, 16);
  assert.equal(p.removed, 1);
  assert.equal(p.added, 0);
  assert.equal(p.price, 20);
  assert.equal(p.refund, 1);
});

test("added letters cost, and the price doubles with each change", () => {
  const base = "Bob's first version of this part, plain and simple.";
  assert.equal(changePrice(base, base + " Cara adds this.", 0, base.length).price, 32);
  assert.equal(changePrice(base + " Cara adds this.", base + " Dana adds this.", 2, base.length).price, 40);
  assert.equal(changePrice("abc", "abcd", 3, 3).price, 80);
});

test("removing a whole part refunds everything the writer paid", () => {
  const p = changePrice("Twenty letters here!", "", 0, 20);
  assert.equal(p.removed, 20);
  assert.equal(p.price, 40);
  assert.equal(p.refund, 20);
});

test("never splits an emoji in two", () => {
  const d = diffSpan("I love \u{1F600}!", "I love \u{1F601}!");
  assert.equal(d.removed, 2);
  assert.equal(d.added, 2);
});
