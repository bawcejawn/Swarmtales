/**
 * Shared page state: the three wallets, what is loaded, the wallet window
 * element, browser preferences, and the site's one configured address.
 */
import { configProblems, network, SITE } from "../config.js";
import { createKondorWallet, createVaultWallet } from "../wallet.js";
import { createTestWallet } from "../testWallet.js";
import { canonicalBase } from "../lib/site.js";

export const problems = configProblems();

export const kondor = createKondorWallet();

export const vault = createVaultWallet(network);

// Testnet only: null on mainnet, so none of its screens appear there.
export const testWallet = createTestWallet(network);

export const KONDOR_STORE = "https://chrome.google.com/webstore/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl";

export const state = {
  overview: null,
  chainError: problems.length ? problems.join(" ") : "",
  account: null,
  accountError: "",
  wallet: null,
  vaultInfo: null,
  vaultKey: "",
  notice: "",
  library: null, // { rows, truncated } once loaded
  libraryPromise: null,
  excerpts: new Map(),
  discover: { tab: "open", kind: "all", category: 0, sort: "active" },
  // Off by default: the story reads like a book. Readers can switch it on.
  showAuthors: readPref("st-show-authors-v2", "0") === "1",
  openKind: "short",
  kondorAccounts: null, // accounts Kondor shared, while the person is choosing
  payment: null, // checkPaymentToken result: may prices be shown, may things be bought (M-8)
  overviewAt: 0, // Date.now() when the overview (with the chain's head time) was read
};

export const dialog = document.createElement("dialog");
dialog.className = "sheet";
dialog.setAttribute("aria-labelledby", "wallet-title");

export function readPref(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}

export function currentAddress() {
  return state.wallet && state.wallet.getAddress ? state.wallet.getAddress() : null;
}

export function walletName() {
  if (state.wallet && state.wallet.id === "testwallet") return "Test wallet";
  return state.wallet && state.wallet.id === "koinvault" ? "KOIN Vault" : "Kondor";
}

/** Chain time now, in seconds: the head time read with the overview, plus the time since. */
export function chainNow() {
  const o = state.overview;
  const local = Math.floor(Date.now() / 1000);
  if (!o || !o.now) return local;
  return o.now + Math.max(0, Math.floor((Date.now() - (state.overviewAt || Date.now())) / 1000));
}

/**
 * The site's one configured address (SITE.url): never the address bar, so a
 * query string, hash or local copy never leaks into a link or onto the
 * chain (M-7, W1-07).
 */
export function siteBase() {
  return canonicalBase(SITE.url);
}
