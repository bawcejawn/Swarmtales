/**
 * The payment token, checked against the chain before any price is shown
 * (audit M-8, and the Shop's 7-day wait for a new token, C1-01).
 *
 * Prices are stored in the token's base units. If web/src/config.js says
 * "8 decimals" and the token really has 6, every price on the page would be
 * off by 100x. So at startup the page reads:
 *   - the token contract's own decimals()
 *   - the Shop's get_asset(token): decimals, symbol, enabled, usable_from
 * and refuses to show prices when any of them disagrees with config.js.
 * A token the Shop enabled recently (now < usable_from) is shown with its
 * prices but not offered for purchases until then.
 */

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * expected: { decimals, symbol } from config.js
 * tokenDecimals: what the token contract's decimals() returned (number or string)
 * asset: the Shop's get_asset result
 * now: chain head time in seconds
 * Returns { ok, problems, mismatch, waitUntil }:
 *   mismatch true  -> config and chain disagree: show no prices at all
 *   waitUntil > 0  -> prices are right, but nothing can be bought before then
 *   ok             -> prices can be shown and purchases offered
 */
export function checkPaymentToken({ expected, tokenDecimals, asset, now }) {
  const problems = [];
  const symbol = String((expected && expected.symbol) || "");
  const decimals = asNumber(expected && expected.decimals);
  const a = asset || {};

  const onToken = asNumber(tokenDecimals);
  if (!Number.isInteger(onToken)) {
    problems.push("This page could not read the " + symbol + " token's decimals from the chain, so it shows no prices.");
  } else if (onToken !== decimals) {
    problems.push("The " + symbol + " token has " + onToken + " decimals on the chain, but this page is set up for " + decimals +
      ". Prices are hidden so no wrong amount is shown. (Site owner: fix paymentDecimals in web/src/config.js.)");
  }
  const inShop = asNumber(a.decimals);
  if (!a.enabled && !a.symbol && !Number.isInteger(inShop)) {
    problems.push("The Shop has no record of the " + symbol + " token, so it shows no prices.");
  } else {
    if (inShop !== decimals) {
      problems.push("The Shop records " + (Number.isInteger(inShop) ? inShop : "no") + " decimals for " + symbol + ", but this page is set up for " +
        decimals + ". Prices are hidden.");
    }
    if (String(a.symbol || "") !== symbol) {
      problems.push("The Shop calls this token “" + String(a.symbol || "") + "”, but this page calls it “" + symbol + "”. Prices are hidden.");
    }
  }
  const mismatch = problems.length > 0;
  if (!mismatch && !a.enabled) {
    problems.push("The Shop doesn't accept " + symbol + " right now, so nothing can be bought.");
  }
  let waitUntil = 0;
  const from = asNumber(a.usable_from || 0);
  if (!mismatch && a.enabled && from > asNumber(now || 0)) waitUntil = from;
  return { ok: problems.length === 0 && waitUntil === 0, problems, mismatch, waitUntil };
}
