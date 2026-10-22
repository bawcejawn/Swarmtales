// Third October fix check: the site follows the contract's refund and history rules
// (AB-060, AB-062, AB-065).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { changePrice, cutRefund, editPrice, removalRefunds } from "../src/lib/change.js";

test("removing a part refunds it as remove_segment does", () => {
  assert.equal(removalRefunds({ hidden: false }), true);
  assert.equal(removalRefunds({ hidden: true, hidden_by: 1, hidden_by_reports: true }), true, "hidden by writer reports alone");
  assert.equal(removalRefunds({ hidden: true, hidden_by: 2 }), false, "hidden by the copy checker");
  assert.equal(removalRefunds({ hidden: true, hidden_by: 3 }), false, "hidden by the admin");
  assert.equal(removalRefunds({ hidden: false, refund_forfeited: true }), false, "restored after a checker hide");
});

test("a part restored after a checker hide gives no Ink back on a cut (AB-062)", () => {
  const seg = { charged: "100", current_cost: "100", refund_forfeited: true };
  assert.equal(cutRefund("short", 0, 100, true), 0);
  assert.equal(editPrice(seg, "a".repeat(40)).refund, 0);
  assert.equal(changePrice("a".repeat(100), "a".repeat(40), 0, 100, true).refund, 0);
  assert.equal(changePrice("a".repeat(100), "a".repeat(40), 0, 100, false).refund, 60);
});

test("the history panel reads get_versions a few versions at a time (AB-060)", () => {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const a = src.indexOf("function versionsView(");
  const body = src.slice(a, src.indexOf("\nconst NUMBER_WORDS", a));
  assert.match(body, /get_versions", \{[^}]*from, count: VERSIONS_PER_READ/);
  assert.match(src, /const VERSIONS_PER_READ = 5;/);
});
