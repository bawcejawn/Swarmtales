import assert from "node:assert/strict";
import test from "node:test";
import { normalizePasted, splitIntoParts } from "../src/lib/text.js";

const para = (n, word) => Array.from({ length: n }, (_, i) => word + i + ".").join(" ");

test("pasted Windows line endings and tabs are tidied", () => {
  assert.equal(normalizePasted("One\r\nTwo\tthree\r\n\r\n\r\n\r\n\r\nFour"), "One\nTwo three\n\nFour");
});

test("text within the cap stays one part", () => {
  assert.deepEqual(splitIntoParts("A short line that fits easily.", 2000, 20), ["A short line that fits easily."]);
});

test("long text splits between paragraphs, every part within the cap", () => {
  const text = [para(150, "Alpha"), para(150, "Beta"), para(150, "Gamma"), para(150, "Delta")].join("\n\n");
  const parts = splitIntoParts(text, 2000, 20);
  assert.ok(parts.length >= 2);
  for (const p of parts) {
    assert.ok(p.length <= 2000, "part too long: " + p.length);
    assert.ok(p.length >= 20);
  }
  // Nothing is lost except the paragraph breaks at the cuts.
  assert.equal(parts.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("one huge paragraph splits between sentences, and a run-on line between words", () => {
  const big = para(600, "Sentence");
  const parts = splitIntoParts(big, 2000, 20);
  for (const p of parts) assert.ok(p.length <= 2000 && p.length >= 20);
  const runOn = "word ".repeat(1000).trim();
  for (const p of splitIntoParts(runOn, 2000, 20)) assert.ok(p.length <= 2000 && p.length >= 20);
});

test("a tiny last part joins or borrows from the one before", () => {
  const text = "x".repeat(1990) + " " + "y".repeat(5) + "\n\nThe end.";
  const parts = splitIntoParts(text, 2000, 20);
  for (const p of parts) assert.ok(p.length >= 20, "short part: " + JSON.stringify(p));
});

test("emoji are never cut in half", () => {
  const text = "😀".repeat(1500);
  for (const p of splitIntoParts(text, 2000, 20)) {
    const last = p.charCodeAt(p.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff));
  }
});
