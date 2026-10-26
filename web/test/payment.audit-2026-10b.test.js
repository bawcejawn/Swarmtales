// Re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md) H-3, L-18 and I-2:
// payment tokens are pinned in config.js with their code hash; the page
// refuses a token whose code is not its pin and never shows an unpinned one.
import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE, PAYMENT_TOKENS, configProblems, contracts, pinnedToken } from "../src/config.js";
import { checkPaymentToken, codeHashFromMeta } from "../src/lib/payment.js";
import { AdminInputError, planAddToken, planAsset } from "../src/lib/admin.js";
import { appSource, fnBody } from "./helpers/appSource.js";
import { readFileSync } from "node:fs";

const CODE = "4251a6e9d9c9a37f3bbf67e171f63a7dcad62309e4be7d9da85a74f68520edf7";
const asset = { enabled: true, decimals: 8, symbol: "tKOIN", usable_from: "0" };
const expected = { decimals: 8, symbol: "tKOIN", codeHash: CODE };
const throwsInput = (fn, re) => assert.throws(fn, (e) => e instanceof AdminInputError && re.test(e.message));

test("H-3: the page's own token is pinned with its code hash, and the shipped config passes", () => {
  assert.deepEqual(configProblems(), []);
  const pin = pinnedToken(contracts.paymentToken);
  assert.ok(pin, "the payment token is pinned");
  assert.equal(pin.codeHash, CODE);
  assert.equal(pin.symbol, contracts.paymentSymbol);
  assert.equal(pin.decimals, contracts.paymentDecimals);
  assert.equal(pinnedToken("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52"), null);
  assert.deepEqual(PAYMENT_TOKENS.mainnet, [], "mainnet pins are filled only after review");
  assert.equal(ACTIVE, "testnet");
});

test("H-3: a token whose code is not its pin, unreadable, or unpinned shows no prices", () => {
  assert.equal(checkPaymentToken({ expected, tokenDecimals: 8, asset, now: 1, codeHash: CODE }).ok, true);
  const changed = checkPaymentToken({ expected, tokenDecimals: 8, asset, now: 1, codeHash: "cd".repeat(32) });
  assert.equal(changed.mismatch, true);
  assert.match(changed.problems.join(" "), /code on the chain is not the code this page was set up for/);
  assert.equal(checkPaymentToken({ expected, tokenDecimals: 8, asset, now: 1, codeHash: null }).mismatch, true);
  assert.equal(checkPaymentToken({ expected: { decimals: 8, symbol: "tKOIN" }, tokenDecimals: 8, asset, now: 1, codeHash: CODE }).mismatch, true);
});

test("H-3: the code hash is read from get_contract_metadata the same way as the deploy tool", () => {
  assert.equal(codeHashFromMeta({ value: { hash: "0x1220" + CODE.toUpperCase() } }), CODE);
  assert.equal(codeHashFromMeta({ value: {} }), null, "no contract");
  assert.equal(codeHashFromMeta(null), null);
  assert.equal(codeHashFromMeta({ value: { hash: "0x1220abcd" } }), null);
});

test("H-3 / L-18: other tokens come from the pins (symbol, decimals), only when the chain matches the pin", () => {
  const src = readFileSync(new URL("../src/chain.js", import.meta.url), "utf8");
  const fn = fnBody(src, "loadPaymentTokens");
  assert.match(fn, /pinnedToken\(t\)/, "a token the Shop lists but that is not pinned is never offered");
  assert.match(fn, /checkPaymentToken\(\{ expected: pin, tokenDecimals: [^,]+, asset, now: 0, codeHash \}\)/);
  assert.match(fn, /symbol: pin\.symbol, decimals: pin\.decimals/, "symbol and decimals come from the pin, not the node");
  assert.doesNotMatch(fn, /String\(asset\.symbol\)/);
  const overview = fnBody(src, "loadOverview");
  assert.match(overview, /codeHashOf\(contracts\.paymentToken\)/);
  assert.match(fnBody(appSource(), "checkPayment"), /codeHash: o\.tokenCodeHash/);
});

test("H-3: the admin page turns a token on only with its pin and its pinned code", () => {
  const T = "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju";
  const pin = pinnedToken(T);
  const on = (extra) => planAsset({ token: T, enabled: true, decimals: "8", symbol: "tKOIN", pin, codeHash: CODE, ...extra });
  assert.deepEqual(on({}).args, { token: T, enabled: true, decimals: 8, symbol: "tKOIN" });
  throwsInput(() => on({ pin: null }), /not pinned/);
  throwsInput(() => on({ codeHash: null }), /no token contract/);
  throwsInput(() => on({ codeHash: "cd".repeat(32) }), /not the pinned code/);
  throwsInput(() => on({ decimals: "6" }), /pinned as tKOIN with 8 decimals/);
  throwsInput(() => planAddToken({ token: T, symbol: "tKOIN", decimals: "8", prices: { 1: "1" }, pin, codeHash: "cd".repeat(32) }), /not the pinned code/);
  // Turning off never needs the pin: it must always work.
  assert.equal(planAsset({ token: T, enabled: false }).args.enabled, false);
});
