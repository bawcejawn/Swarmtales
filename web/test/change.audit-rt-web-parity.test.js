// Audit Bot red-team (Web attacker) test: revise price parity.
// Attack: craft old/new texts (emoji, surrogate pairs, ZWJ families, flags,
// newlines, repeated letters, edits at the edges) so that the page's price
// (web/src/lib/change.js) differs from what Stories.revise_part computes
// (stories/assembly/Stories.ts:1153-1172). A difference means the user is
// refused (expected_ink mismatch) or shown the wrong price/refund.
// The contract algorithm is ported line for line below.
// Asserts the SAFE behaviour (fails if the two ever disagree).
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { changeMultiplier, changePrice, diffSpan, editorChanged } from "../src/lib/change.js";
import { checkStoryText, normalizePasted } from "../src/lib/text.js";

// ---- Port of Stories.revise_part (Stories.ts:1147-1172, 1190) ----
const MIN_CHANGE_UNITS = 10n;
const isLowSurrogate = (c) => c >= 0xdc00 && c <= 0xdfff;
function contractPrice(oldText, text, versionCount, charged) {
  const removing = text.length === 0;
  let pre = 0;
  const maxPre = Math.min(oldText.length, text.length);
  while (pre < maxPre && oldText.charCodeAt(pre) === text.charCodeAt(pre)) pre++;
  if (pre > 0 && ((pre < oldText.length && isLowSurrogate(oldText.charCodeAt(pre))) ||
    (pre < text.length && isLowSurrogate(text.charCodeAt(pre))))) pre--;
  let suf = 0;
  const maxSuf = Math.min(oldText.length, text.length) - pre;
  while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) === text.charCodeAt(text.length - 1 - suf)) suf++;
  if (suf > 0 && (isLowSurrogate(oldText.charCodeAt(oldText.length - suf)) || isLowSurrogate(text.charCodeAt(text.length - suf)))) suf--;
  const removed = BigInt(oldText.length - pre - suf);
  const added = BigInt(text.length - pre - suf);
  // Updated for the October 2026 rules: the doubling counts paid changes
  // (segment.paid_changes; the writer's own edits are versions too), and a cut
  // refunds what was paid beyond the new length, also after someone else's
  // change (Stories.cutRefund, AB-044).
  const changes = versionCount; // paid changes so far
  if (changes >= 60) return null; // "changing this part again would cost more Ink than exists"
  const units = removed + added < MIN_CHANGE_UNITS ? MIN_CHANGE_UNITS : removed + added;
  const price = units * (1n << BigInt(changes + 1));
  const c = BigInt(charged);
  const newCost = BigInt(text.length);
  const refund = removing ? c : (c > newCost ? c - newCost : 0n);
  return { removed, added, price, refund };
}

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const ATOMS = [
  "a", "b", "e", " ", "\n", "\n\n", ".", "é", "é", "⭐", "\u{1F600}", "\u{1F601}", "\u{1F44D}\u{1F3FD}",
  "\u{1F1FA}\u{1F1F8}", "\u{1F468}‍\u{1F469}‍\u{1F467}", " ", "中", "\u{20BB7}", "❤️",
];
function randomText(r, maxAtoms) {
  const n = 1 + Math.floor(r() * maxAtoms);
  let s = "";
  for (let i = 0; i < n; i++) s += ATOMS[Math.floor(r() * ATOMS.length)];
  return s;
}
function mutate(r, s) {
  const cps = Array.from(s);
  const ops = 1 + Math.floor(r() * 3);
  for (let k = 0; k < ops; k++) {
    const at = Math.floor(r() * (cps.length + 1));
    const kind = Math.floor(r() * 3);
    if (kind === 0) cps.splice(at, 0, ATOMS[Math.floor(r() * ATOMS.length)]);
    else if (kind === 1 && cps.length > 1) cps.splice(Math.min(at, cps.length - 1), 1);
    else cps.splice(Math.min(at, cps.length - 1), 1, ATOMS[Math.floor(r() * ATOMS.length)]);
  }
  return cps.join("");
}

test("RT-WEB: page price, refund and diff match revise_part for 20,000 random texts with emoji and newlines", () => {
  const r = rng(0x5eed);
  let compared = 0;
  for (let i = 0; i < 20000; i++) {
    const oldText = randomText(r, 30);
    const newText = r() < 0.05 ? "" : mutate(r, oldText);
    if (newText === oldText) continue; // contract: "the text is unchanged"
    if (!checkStoryText(oldText, true).ok) continue;
    if (newText && !checkStoryText(newText, true).ok) continue;
    const versions = Math.floor(r() * 12);
    const charged = Math.floor(r() * 80);
    const want = contractPrice(oldText, newText, versions, charged);
    const got = changePrice(oldText, newText, versions, charged);
    const ctx = JSON.stringify({ oldText, newText, versions, charged });
    assert.equal(BigInt(got.removed), want.removed, "removed differs " + ctx);
    assert.equal(BigInt(got.added), want.added, "added differs " + ctx);
    assert.equal(BigInt(got.price), want.price, "price differs (refused or overcharged) " + ctx);
    assert.equal(BigInt(got.refund), want.refund, "refund differs " + ctx);
    // expected_ink is sent as String(p.price) (main.js:1331): it must be the exact integer.
    assert.equal(String(got.price), want.price.toString(), "expected_ink string is not the exact integer " + ctx);
    compared++;
  }
  assert.ok(compared > 10000, "too few valid samples: " + compared);
});

test("RT-WEB: surrogate-pair edge cases match the contract exactly", () => {
  const cases = [
    ["I love \u{1F600}!", "I love \u{1F601}!"], // same high surrogate, different low
    ["\u{1F600}", "\u{1F601}"],
    ["ab\u{1F600}", "ab\u{1F600}\u{1F600}"], // repeat at the end
    ["\u{1F600}\u{1F600}ab", "\u{1F600}ab"], // repeat at the start
    ["\u{1F44D}\u{1F3FD} ok", "\u{1F44D}\u{1F3FF} ok"], // skin tone swap
    ["x\n\ny", "x\n\n\ny"],
    ["line one\nline two", "line one line two"],
    ["\u{1F1FA}\u{1F1F8}\u{1F1FA}\u{1F1F8}", "\u{1F1FA}\u{1F1F8}"],
  ];
  for (const [a, b] of cases) {
    for (const v of [0, 1, 2, 7]) {
      const want = contractPrice(a, b, v, a.length);
      const got = changePrice(a, b, v, a.length);
      assert.equal(BigInt(got.price), want.price, JSON.stringify({ a, b, v }));
      assert.equal(BigInt(got.refund), want.refund, JSON.stringify({ a, b, v }));
      const d = diffSpan(a, b);
      // The changed span never starts or ends in the middle of an emoji.
      assert.ok(!isLowSurrogate(a.charCodeAt(d.pre)) || d.pre === a.length, "split emoji at start " + JSON.stringify({ a, b }));
    }
  }
});

test("RT-WEB: the multiplier matches the contract up to its 60-change limit", () => {
  for (let paid = 0; paid < 60; paid++) {
    assert.equal(BigInt(changeMultiplier(paid)), 1n << BigInt(paid + 1), "paid_changes " + paid);
  }
});

// Attack on the composition in main.js:1294-1297 (changePanel): the editor
// box starts with the part's on-chain text, but the price is computed on
// normalizePasted(area.value).trim(). A part stored with a leading or trailing
// space or line break (allowed by Stories.requireText; written by another
// client, the deploy CLI or a direct call) makes an UNTOUCHED editor show a
// price and an enabled "Change for 20 Ink" button: the user pays the
// 10-letter minimum x2 (or more) to change nothing they can see.
test("RT-WEB: an untouched change editor never prices a change (texts the contract accepts)", () => {
  const stored = ["Trailing space after the sentence. ", "\nOpens with a line break.", "Ends with a break.\n", "Ends with a no-break space. "];
  for (const oldText of stored) {
    assert.ok(checkStoryText(oldText, true).ok, "the contract accepts " + JSON.stringify(oldText));
    // Updated after the fix: the change panel now asks editorChanged() (the same
    // normalization on both sides) whether to price a change, so the test calls
    // it instead of re-deriving the old inline comparison.
    const untouched = normalizePasted(oldText).trim(); // what the panel would send
    const priced = editorChanged(oldText, oldText, normalizePasted); // the box starts with the stored text
    assert.equal(priced, false,
      "untouched editor is priced at " + changePrice(oldText, untouched, 0, oldText.length).price + " Ink for " + JSON.stringify(oldText));
  }
});
