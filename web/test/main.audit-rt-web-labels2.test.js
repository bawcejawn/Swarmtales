// Audit Bot red-team (Web attacker) tests, fix check @ 00eec36: places in
// main.js that 3ee712a did not move to the new contract rules. main.js is too
// DOM-heavy to import, so these read its source (each decision is one
// expression) and assert the SAFE behaviour.
//
// 1) removePanel (main.js ~1562-1590) says "<writer> gets their <charged> Ink
//    back". remove_segment (Stories.ts ~905-916) refunds through settleRefund:
//    in a pool-paid part (fund_paid) only own_paid goes to the writer and the
//    rest to the story's pool. The AB-055 pool-aware label (refundLine /
//    refundSplit) was added to changePanel only.
//    SAFE: removePanel uses fund_paid / own_paid (refundSplit or refundLine).
//
// 2) removePanel says "This part is hidden while it's checked, so its Ink isn't
//    returned" for EVERY hidden part. remove_segment refunds a part hidden only
//    by writer reports (refundable: !hidden || hidden_by_reports, AB-012).
//    SAFE: removePanel looks at hidden_by_reports / hidden_by.
//
// 3) Final edit (renderFinish ~3150-3155): maxCost = charged + allowance.
//    submit_final_batch (Stories.ts ~1067, AB-056) allows current_cost +
//    allowance. In a part others grew (current > charged) the page refuses
//    light edits the contract accepts ("the edit makes it too long"); in a
//    pre-upgrade part with charged > current it offers edits the contract
//    refuses (wasted mana, refusal loop).
//    SAFE: maxCost is built from current_cost.
//
// 4) The "Change (xN)" tool (renderSegment ~1192) is offered for any
//    paid_changes, but revise_part refuses from 60 on (MAX_PAID_CHANGES,
//    "changing this part again would cost more Ink than exists"). The page
//    prices it, the user signs, the contract reverts.
//    SAFE: the tool (or changePanel) is gated on paid_changes < 60.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function body(start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "can't find " + start + " in main.js");
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b > a ? b : undefined);
}

test("RT-WEB: removing your own pool-paid part does not promise you Ink that goes to the pool", () => {
  const panel = body("function removePanel(", "function reportControl(");
  const promises = /gets their " \+ num\(seg\.charged\)/.test(panel);
  const knowsPool = /fund_paid|own_paid|refundSplit|refundLine/.test(panel);
  assert.ok(!promises || knowsPool,
    "REMOVE-POOL-LABEL: removePanel says the writer gets all of seg.charged back; remove_segment's settleRefund " +
    "sends only own_paid to the writer and the rest to the story's pool");
});

test("RT-WEB: removing a part hidden only by reports does not say the Ink is lost", () => {
  const panel = body("function removePanel(", "function reportControl(");
  const saysLost = /isn't returned|is not returned|not refunded/.test(panel);
  const knowsReports = /hidden_by_reports|hidden_by\b/.test(panel);
  assert.ok(!saysLost || knowsReports,
    "REMOVE-HIDDEN-LABEL: every hidden part is labelled 'its Ink isn't returned', but remove_segment refunds a part " +
    "hidden only by writer reports (refundable = !hidden || hidden_by_reports)");
});

test("RT-WEB: the final light-edit limit is measured from the part as it is now (AB-056)", () => {
  const i = src.indexOf("const maxCost =");
  assert.ok(i >= 0, "can't find the final edit maxCost");
  const line = src.slice(i, src.indexOf("\n", i));
  assert.ok(/current_cost/.test(line) && !/seg\.charged/.test(line),
    "FINAL-LIMIT: '" + line.trim() + "' but submit_final_batch allows current_cost + allowance(original_cost)");
});

test("RT-WEB: the page does not offer a paid change revise_part will refuse (60 paid changes)", () => {
  const tool = body("const times = changeMultiplier(segment.paid_changes)", "Listen from here");
  const before = src.slice(src.indexOf("const times = changeMultiplier(segment.paid_changes)") - 200,
    src.indexOf("const times = changeMultiplier(segment.paid_changes)"));
  const panel = body("function changePanel(", "function refundLine(");
  const gated = /paid_changes[^\n]*(<|>=|>)\s*(60|59|MAX_PAID)/.test(before + tool + panel) ||
    /(60|MAX_PAID)[^\n]*paid_changes/.test(before + tool + panel);
  assert.ok(gated,
    "CHANGE-LIMIT: the Change tool is offered and priced at paid_changes >= 60; revise_part refuses every such change");
});
