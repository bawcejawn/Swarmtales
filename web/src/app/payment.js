/**
 * The payment token: amounts in its units, and whether prices may be shown
 * and things bought (checked against the chain at startup, audit M-8).
 */
import { contracts } from "../config.js";
import { formatUnits, formatUtc } from "../lib/money.js";
import { h } from "../ui/dom.js";
import { checkPaymentToken } from "../lib/payment.js";
import { state } from "./state.js";
import { notice } from "./ui.js";

export function tokenAmount(base) {
  // Never print an amount with decimals the chain doesn't confirm (M-8).
  if (!state.payment || state.payment.mismatch) return "? " + contracts.paymentSymbol;
  try {
    return formatUnits(base || "0", contracts.paymentDecimals) + " " + contracts.paymentSymbol;
  } catch {
    return "? " + contracts.paymentSymbol;
  }
}

/** Recheck the payment token against config.js whenever the overview loads (M-8). */
export function checkPayment() {
  const o = state.overview;
  state.payment = o
    ? checkPaymentToken({
      expected: { decimals: contracts.paymentDecimals, symbol: contracts.paymentSymbol },
      tokenDecimals: o.tokenDecimals,
      asset: o.asset,
      now: o.now,
    })
    : null;
}

/**
 * Why nothing can be bought right now, as a notice, or null when buying is
 * fine: the token doesn't match config.js (no prices at all), the Shop
 * doesn't accept it, or it was enabled less than 7 days ago.
 */
export function paymentBlock() {
  const p = state.payment;
  if (!p) return notice("warn", h("p", {}, ["Checking the payment token…"]));
  if (p.mismatch) return notice("bad", [h("p", {}, ["Prices are hidden: the payment token on the chain doesn't match this page's settings."]), h("ul", {}, p.problems.map((t) => h("li", {}, [t])))]);
  if (p.problems.length) return notice("warn", p.problems.map((t) => h("p", {}, [t])));
  if (p.waitUntil) {
    return notice("warn", h("p", {}, [
      "The Shop added " + contracts.paymentSymbol + " recently. It can be used from " + formatUtc(p.waitUntil) +
        ", so nothing can be bought with it until then.",
    ]));
  }
  return null;
}
