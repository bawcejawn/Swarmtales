// Audit Bot red-team (Web attacker) test: the writer's own edit, priced by
// the page (web/src/lib/change.js editPrice, shown in main.js editPanel) vs.
// what Stories.edit_segment really burns and refunds (Stories.ts:794-870,
// cutRefund ~1977, settleRefund ~2092), across whole SEQUENCES of edits by
// the writer and paid changes by others (revise_part ~1180-1290), in public
// and pool-paid (fund_paid / own_paid) parts.
// Attack: find a part state + new text (emoji, surrogate pairs, \r\n, tabs,
// long newline runs, trailing spaces) where the page shows "Free" / "N Ink
// back" but the contract burns more or refunds less (or to the pool instead
// of the writer), or where the revise price/refund drifts after a few steps.
// The contract is ported line for line below with BigInt. Fixed seed.
// Segment fields are fed to the page the way koilib decodes them: uint64 as
// strings, and zero/false fields sometimes missing (proto3 defaults).
// Asserts the SAFE behaviour (page == contract at every step).
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { changePrice, editPrice, editorChanged } from "../src/lib/change.js";
import { checkStoryText, normalizePasted } from "../src/lib/text.js";

// ---------------- Port of the contract ----------------
const MIN_CHANGE_UNITS = 10n;
const MAX_PAID_CHANGES = 60;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

// Stories.cutRefund (repo update, AB-044: a cut refunds what was paid beyond the new
// length, also after someone else's change; the paid_changes > 0 early return is gone)
function cutRefund(seg, newCost) {
  return seg.charged > newCost ? seg.charged - newCost : 0n;
}
// Stories.settleRefund -> { toWriter, toFund } (mutates seg.own_paid, story.fund)
function settleRefund(st, seg, refund) {
  if (refund === 0n) return { toWriter: 0n, toFund: 0n };
  let toWriter = refund;
  let toFund = 0n;
  if (seg.fund_paid) {
    toWriter = refund < seg.own_paid ? refund : seg.own_paid;
    seg.own_paid = seg.own_paid - toWriter;
    toFund = refund - toWriter;
    st.fund += toFund;
  }
  return { toWriter, toFund };
}
// Stories.edit_segment (economic part). Returns { burn, refund, toWriter, toFund } or throws.
function contractEdit(st, seg, text) {
  const newCost = BigInt(text.length);
  if (text === seg.text) throw new Error("STORIES: the text is unchanged");
  const oldCost = seg.current_cost;
  const growth = newCost > oldCost ? newCost - oldCost : 0n;
  const refund = cutRefund(seg, newCost);
  const { toWriter, toFund } = settleRefund(st, seg, refund);
  seg.charged = seg.charged - refund + growth;
  if (growth > 0n && seg.fund_paid) seg.own_paid += growth;
  seg.text = text;
  seg.current_cost = newCost;
  return { burn: growth, refund, toWriter, toFund };
}
// Stories.revise_part (economic part). Returns { price, refund, toWriter, toFund, removed } or throws.
function contractRevise(st, seg, text) {
  const oldText = seg.text;
  if (text === oldText) throw new Error("STORIES: the text is unchanged");
  const removing = text.length === 0;
  const newCost = removing ? 0n : BigInt(text.length);
  let pre = 0;
  const maxPre = Math.min(oldText.length, text.length);
  while (pre < maxPre && oldText.charCodeAt(pre) === text.charCodeAt(pre)) pre++;
  if (pre > 0 && ((pre < oldText.length && isLow(oldText.charCodeAt(pre))) || (pre < text.length && isLow(text.charCodeAt(pre))))) pre--;
  let suf = 0;
  const maxSuf = Math.min(oldText.length, text.length) - pre;
  while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) === text.charCodeAt(text.length - 1 - suf)) suf++;
  if (suf > 0 && (isLow(oldText.charCodeAt(oldText.length - suf)) || isLow(text.charCodeAt(text.length - suf)))) suf--;
  const removed = BigInt(oldText.length - pre - suf);
  const added = BigInt(text.length - pre - suf);
  const changes = seg.paid_changes;
  if (changes >= MAX_PAID_CHANGES) throw new Error("STORIES: changing this part again would cost more Ink than exists");
  const units = removed + added < MIN_CHANGE_UNITS ? MIN_CHANGE_UNITS : removed + added;
  const price = units * (1n << BigInt(changes + 1));
  const refund = removing ? seg.charged : cutRefund(seg, newCost);
  seg.paid_changes = changes + 1;
  const { toWriter, toFund } = settleRefund(st, seg, refund);
  if (removing) {
    seg.removed = true;
  } else {
    seg.charged = seg.charged - refund;
    seg.text = text;
    seg.current_cost = newCost;
  }
  return { price, refund, toWriter, toFund };
}

// ---------------- What the page sees (koilib decode) ----------------
function asDecoded(seg, r) {
  const out = { text: seg.text, author: "1Writer" };
  const put = (k, v, isZero) => {
    if (isZero && r() < 0.5) return; // proto3 default: field missing after decode
    out[k] = v;
  };
  put("charged", seg.charged.toString(), seg.charged === 0n);
  put("current_cost", seg.current_cost.toString(), seg.current_cost === 0n);
  put("paid_changes", seg.paid_changes, seg.paid_changes === 0);
  put("fund_paid", seg.fund_paid, !seg.fund_paid);
  put("own_paid", seg.own_paid.toString(), seg.own_paid === 0n);
  return out;
}

// ---------------- Text generator ----------------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const ATOMS = [
  "a", "b", "e", "z", " ", ".", ",", "\n", "\r\n", "\r", "\t", "\n\n\n\n\n", "é", "é",
  "\u{1F600}", "\u{1F601}", "\u{1F44D}\u{1F3FD}", "\u{1F1FA}\u{1F1F8}", "\u{1F468}‍\u{1F469}‍\u{1F467}",
  " ", "中", "\u{20BB7}", "❤️", "Wort ",
];
function rawText(r, max) {
  const n = 1 + Math.floor(r() * max);
  let s = "";
  for (let i = 0; i < n; i++) s += ATOMS[Math.floor(r() * ATOMS.length)];
  return s;
}
function mutate(r, s) {
  const cps = Array.from(s);
  const ops = 1 + Math.floor(r() * 4);
  for (let k = 0; k < ops; k++) {
    const at = Math.floor(r() * (cps.length + 1));
    const kind = Math.floor(r() * 4);
    if (kind === 0) cps.splice(at, 0, ATOMS[Math.floor(r() * ATOMS.length)]);
    else if (kind === 1 && cps.length > 1) cps.splice(Math.min(at, cps.length - 1), 1 + Math.floor(r() * 3));
    else if (kind === 2) cps.splice(Math.min(at, cps.length), 0, ...Array.from(rawText(r, 6)));
    else cps.splice(Math.min(at, cps.length - 1), 1, ATOMS[Math.floor(r() * ATOMS.length)]);
  }
  return cps.join("");
}
// What the editor box sends (main.js editPanel / changePanel): normalizePasted(box).trim()
const sendable = (box) => normalizePasted(box).trim();

test("RT-WEB: editPrice == edit_segment burn/refund/split over 3,000 random edit+change sequences (seed 0xED17)", () => {
  const r = rng(0xed17);
  let edits = 0;
  let revises = 0;
  for (let run = 0; run < 3000; run++) {
    const first = sendable(rawText(r, 25));
    if (!checkStoryText(first, true).ok) continue;
    const fund_paid = r() < 0.5;
    const st = { fund: 1000n };
    const seg = {
      text: first, charged: BigInt(first.length), current_cost: BigInt(first.length),
      paid_changes: 0, fund_paid, own_paid: 0n, removed: false,
    };
    for (let step = 0; step < 12 && !seg.removed; step++) {
      const page = asDecoded(seg, r);
      const byWriter = r() < 0.65;
      const box = r() < 0.04 ? "" : mutate(r, page.text);
      const text = sendable(box);
      const ctx = JSON.stringify({ run, step, byWriter, old: seg.text, text, seg: page });
      if (byWriter) {
        // The page refuses before sending: unchanged, empty, or bad text.
        if (!text || text === page.text || !editorChanged(page.text, box, normalizePasted)) continue;
        if (!checkStoryText(text, true).ok) continue;
        const shown = editPrice(page, text);
        const got = contractEdit(st, seg, text);
        assert.equal(BigInt(shown.cost), got.burn, "OVERCHARGE: page shows " + shown.cost + " Ink for the edit, contract burns " + got.burn + " " + ctx);
        assert.equal(BigInt(shown.refund), got.refund, "refund shown differs from contract " + ctx);
        assert.equal(BigInt(shown.toWriter), got.toWriter, "Ink shown as coming back to the writer differs (own_paid/fund_paid) " + ctx);
        assert.equal(BigInt(shown.toPool), got.toFund, "Ink shown as going to the pool differs " + ctx);
        edits++;
      } else {
        if (text && !checkStoryText(text, true).ok) continue;
        if (text === page.text) continue;
        if (text && !editorChanged(page.text, box, normalizePasted)) continue;
        if (seg.paid_changes >= 20) continue; // keep the numbers small; the multiplier is tested elsewhere
        const shown = changePrice(page.text, text, page.paid_changes, page.charged);
        const got = contractRevise(st, seg, text);
        assert.equal(BigInt(shown.price), got.price, "revise price (expected_ink) differs: refusal or wrong price shown " + ctx);
        assert.equal(String(shown.price), got.price.toString(), "expected_ink string is not the exact integer " + ctx);
        assert.equal(BigInt(shown.refund), got.refund, "revise refund shown differs " + ctx);
        revises++;
      }
    }
  }
  assert.ok(edits > 3000, "too few writer edits compared: " + edits);
  assert.ok(revises > 1000, "too few paid changes compared: " + revises);
});

test("RT-WEB: emoji and CRLF edits are priced in UTF-16 units of the text actually sent", () => {
  // 10 letters, writer-paid
  const seg = { text: "abcdefghij", charged: "10", current_cost: "10", paid_changes: 0 };
  const cases = [
    ["abcdefghij\u{1F600}", 2],            // one emoji = 2 Ink
    ["abcdefghij\r\nk", 2],               // \r\n is sent as \n: 1 + "k"
    ["abcdefghij\r\n\r\n\r\n\r\n\r\nk", 3], // 5 breaks collapse to 2 (normalizePasted) + "k"
    ["abcdefghi\u{1F44D}\u{1F3FD}", 3],      // replace 1 letter with a 4-unit skin-tone emoji
    ["  abcdefghij\t ", 0],               // trimmed: unchanged length, not a change
  ];
  for (const [box, want] of cases) {
    const text = sendable(box);
    if (!editorChanged(seg.text, box, normalizePasted)) {
      assert.equal(want, 0, "page treats " + JSON.stringify(box) + " as unchanged");
      continue;
    }
    const st = { fund: 0n };
    const cseg = { text: seg.text, charged: 10n, current_cost: 10n, paid_changes: 0, fund_paid: false, own_paid: 0n };
    const got = contractEdit(st, cseg, text);
    assert.equal(editPrice(seg, text).cost, want, "page price for " + JSON.stringify(box));
    assert.equal(got.burn, BigInt(want), "contract burn for " + JSON.stringify(box) + " differs from the page");
  }
});
