// Audit 2026-10 M-8: before any price is shown, the page checks the payment
// token's decimals (token contract) and the Shop's get_asset against
// config.js. A mismatched config shows an error, not a price.
import assert from "node:assert/strict";
import test from "node:test";
import { checkPaymentToken } from "../src/lib/payment.js";
import { contracts } from "../src/config.js";

const asset = { enabled: true, decimals: 8, symbol: "tKOIN", usable_from: "0" };
const expected = { decimals: 8, symbol: "tKOIN" };

test("M-8: the shipped config matches a token with the same decimals and symbol", () => {
  assert.equal(contracts.paymentDecimals, 8);
  const r = checkPaymentToken({ expected: { decimals: contracts.paymentDecimals, symbol: contracts.paymentSymbol }, tokenDecimals: 8, asset, now: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.mismatch, false);
  assert.deepEqual(r.problems, []);
});

test("M-8: a config with the wrong decimals shows an error, not a price", () => {
  const r = checkPaymentToken({ expected: { decimals: 6, symbol: "tKOIN" }, tokenDecimals: 8, asset, now: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.mismatch, true, "prices must be hidden");
  assert.match(r.problems.join(" "), /8 decimals on the chain.*set up for 6/);
});

test("M-8: the Shop's record must agree too (decimals, symbol), and the token must answer", () => {
  assert.equal(checkPaymentToken({ expected, tokenDecimals: 8, asset: { ...asset, decimals: 6 }, now: 1 }).mismatch, true);
  assert.equal(checkPaymentToken({ expected, tokenDecimals: 8, asset: { ...asset, symbol: "KOIN" }, now: 1 }).mismatch, true);
  assert.equal(checkPaymentToken({ expected, tokenDecimals: null, asset, now: 1 }).mismatch, true);
  assert.equal(checkPaymentToken({ expected, tokenDecimals: 8, asset: {}, now: 1 }).mismatch, true);
});

test("a disabled token or one inside its 7-day wait shows prices but offers no purchase", () => {
  const off = checkPaymentToken({ expected, tokenDecimals: 8, asset: { ...asset, enabled: false }, now: 1 });
  assert.equal(off.mismatch, false);
  assert.equal(off.ok, false);
  const waiting = checkPaymentToken({ expected, tokenDecimals: 8, asset: { ...asset, usable_from: "5000" }, now: 1000 });
  assert.equal(waiting.ok, false);
  assert.equal(waiting.mismatch, false);
  assert.equal(waiting.waitUntil, 5000);
  assert.equal(checkPaymentToken({ expected, tokenDecimals: 8, asset: { ...asset, usable_from: "5000" }, now: 5000 }).ok, true);
});
