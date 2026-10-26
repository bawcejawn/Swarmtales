// Re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md) L-19: after a "Pay
// with" switch, the old token's prices are never shown or used for a purchase.
import assert from "node:assert/strict";
import test from "node:test";

// app/payment.js renders notices, so it needs a document to load.
class FakeNode {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.attributes = {}; this.style = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener() {}
  append(...c) { this.childNodes.push(...c); }
  appendChild(c) { this.childNodes.push(c); return c; }
  replaceChildren(...c) { this.childNodes = [...c]; }
}
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_ns, tag) => new FakeNode(tag),
  createTextNode: (data) => ({ nodeType: 3, data }),
  getElementById: () => null,
  querySelector: () => null,
  addEventListener() {},
  body: new FakeNode("body"),
  documentElement: new FakeNode("html"),
};

const { checkPayment, overviewIsForPickedToken, requirePricesForPickedToken, tokenAmount } = await import("../src/app/payment.js");
const { state } = await import("../src/app/state.js");
const { contracts, pinnedToken, selectPaymentToken, DEFAULT_PAYMENT } = await import("../src/config.js");

const pin = pinnedToken(contracts.paymentToken);
const overviewFor = (token) => ({
  token, tokenDecimals: 8, tokenCodeHash: pin.codeHash, now: 2000000000,
  asset: { enabled: true, decimals: 8, symbol: "tKOIN", usable_from: "0" },
});

test("L-19: prices are shown, and a purchase encoded, only for the token they were read in", () => {
  state.overview = overviewFor(contracts.paymentToken);
  checkPayment();
  assert.equal(overviewIsForPickedToken(), true);
  assert.equal(tokenAmount("150000000"), "1.5 tKOIN");
  assert.doesNotThrow(requirePricesForPickedToken);

  // The buyer picks another token; the overview still holds the old prices.
  selectPaymentToken({ address: "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52", symbol: "vUSDC", decimals: 6 });
  try {
    checkPayment();
    assert.equal(overviewIsForPickedToken(), false);
    assert.equal(state.payment.mismatch, true);
    assert.match(state.payment.problems[0], /Loading the prices in vUSDC/);
    assert.equal(tokenAmount("150000000"), "? vUSDC", "no old price in the new token's units");
    assert.throws(requirePricesForPickedToken, /still being loaded for vUSDC/);
  } finally {
    selectPaymentToken(DEFAULT_PAYMENT);
  }
});
