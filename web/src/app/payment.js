/**
 * The payment token: amounts in its units, and whether prices may be shown
 * and things bought (checked against the chain at startup, audit M-8).
 */
import { contracts, pinnedToken, selectPaymentToken } from "../config.js";
import { formatUnits, formatUtc } from "../lib/money.js";
import { h } from "../ui/dom.js";
import { checkPaymentToken } from "../lib/payment.js";
import { state } from "./state.js";
import { notice } from "./ui.js";

const PICK_KEY = "swarmtales.payToken";

/** The token saved last time in this browser, if the Shop still takes it. */
export function restorePaymentToken() {
  let saved = "";
  try {
    saved = localStorage.getItem(PICK_KEY) || "";
  } catch {
    saved = "";
  }
  const t = (state.payTokens || []).find((x) => x.address === saved);
  if (t) selectPaymentToken(t);
}

/**
 * "Pay with" when the Shop takes more than one token. Picking one switches
 * every price, balance and payment on the page to it.
 */
export function tokenPicker(onChange) {
  const list = state.payTokens || [];
  if (list.length < 2) return null;
  const select = h("select", { "aria-label": "Pay with" }, list.map((t) => h("option", { value: t.address }, [t.symbol])));
  select.value = contracts.paymentToken;
  select.addEventListener("change", async () => {
    const t = list.find((x) => x.address === select.value);
    selectPaymentToken(t);
    try {
      localStorage.setItem(PICK_KEY, t.address);
    } catch {
      /* not kept */
    }
    if (onChange) await onChange();
  });
  return h("label", { class: "field pay-with" }, [h("span", {}, ["Pay with"]), select]);
}

export function tokenAmount(base) {
  // Never print an amount with decimals the chain doesn't confirm (M-8).
  if (!state.payment || state.payment.mismatch) return "? " + contracts.paymentSymbol;
  try {
    return formatUnits(base || "0", contracts.paymentDecimals) + " " + contracts.paymentSymbol;
  } catch {
    return "? " + contracts.paymentSymbol;
  }
}

/**
 * True when the prices on screen are in the token the buyer picked (audit
 * L-19): after a switch, the old token's prices stay in state.overview until
 * the new ones load.
 */
export function overviewIsForPickedToken() {
  return !!state.overview && state.overview.token === contracts.paymentToken;
}

/** Stop before encoding a purchase whose prices were read for another token (audit L-19). */
export function requirePricesForPickedToken() {
  if (!overviewIsForPickedToken()) {
    throw new Error("The prices on this page are still being loaded for " + contracts.paymentSymbol + ". Wait a moment and try again. Nothing was signed.");
  }
}

/** Recheck the payment token against config.js (its pin) whenever the overview loads (M-8, H-3). */
export function checkPayment() {
  const o = state.overview;
  if (o && !overviewIsForPickedToken()) {
    // Prices for the old token: show none until the picked token's load (L-19).
    state.payment = { ok: false, mismatch: true, waitUntil: 0, problems: ["Loading the prices in " + contracts.paymentSymbol + "…"] };
    return;
  }
  const pin = pinnedToken(contracts.paymentToken);
  state.payment = o
    ? checkPaymentToken({
      expected: { decimals: contracts.paymentDecimals, symbol: contracts.paymentSymbol, codeHash: pin && pin.decimals === contracts.paymentDecimals &&
        pin.symbol === contracts.paymentSymbol ? pin.codeHash : "" },
      tokenDecimals: o.tokenDecimals,
      asset: o.asset,
      now: o.now,
      codeHash: o.tokenCodeHash,
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
