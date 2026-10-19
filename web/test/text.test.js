import assert from "node:assert/strict";
import test from "node:test";
import { checkStoryText, checkTitle, costNote, inkCost } from "../src/lib/text.js";

test("ink cost is the UTF-16 length", () => {
  assert.equal(inkCost("a"), 1);
  assert.equal(inkCost("Hi"), 2);
  assert.equal(inkCost("😀"), 2);
  assert.equal(inkCost("⭐"), 1);
  assert.equal(inkCost("👍🏽"), 4);
  assert.equal(inkCost("🇺🇸"), 4);
  assert.equal(inkCost("👨‍👩‍👧"), 8);
  assert.equal(inkCost("Hi 😀"), 5);
  assert.equal(inkCost(""), 0);
  assert.equal(inkCost(null), 0);
});

test("story text accepts a letter, emoji, and three newlines", () => {
  assert.deepEqual(checkStoryText("Hello", true), { ok: true, cost: 5 });
  assert.deepEqual(checkStoryText("😀", true), { ok: true, cost: 2 });
  assert.deepEqual(checkStoryText("a\n\n\nb", true), { ok: true, cost: 5 });
});

test("story text rejects the same cases the contract rejects", () => {
  assert.equal(checkStoryText("", true).ok, false);
  assert.equal(checkStoryText("   ", true).ok, false);
  assert.equal(checkStoryText("a\n\n\n\nb", true).ok, false);
  assert.match(checkStoryText("a\u0000b", true).reason, /Control/);
  assert.match(checkStoryText("a\u007fb", true).reason, /Control/);
  assert.match(checkStoryText("a\u200bb", true).reason, /Invisible/);
  assert.match(checkStoryText("a\u202eb", true).reason, /Invisible/);
  assert.match(checkStoryText("\uD83D", true).reason, /Broken/);
  assert.match(checkStoryText("\uDE00", true).reason, /Broken/);
  assert.equal(checkStoryText("Title\n", false).ok, false);
});

test("a title is 1 to 100 characters with no line break", () => {
  assert.equal(checkTitle("Short").ok, true);
  assert.equal(checkTitle("").ok, false);
  assert.equal(checkTitle("a".repeat(101)).ok, false);
  assert.equal(checkTitle("a".repeat(100)).ok, true);
  assert.equal(checkTitle("Line\nbreak").ok, false);
});

test("the cost note mentions emoji halves", () => {
  assert.match(costNote("ab"), /2 Ink/);
  assert.match(costNote("😀"), /2 Ink/);
  assert.match(costNote("👨‍👩‍👧"), /8 Ink/);
});
