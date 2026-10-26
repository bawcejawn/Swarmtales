/**
 * The wallet window: Kondor, KOIN Vault and (testnet only) the test wallet.
 */
import { network } from "../config.js";
import { explainFailure } from "../lib/errors.js";
import { formatUtc } from "../lib/money.js";
import { clearSavedSession, saveSession } from "../wallet.js";
import { fetchVaultConfig, vaultPairingDecision } from "../lib/vaultApi.js";
import { storedTestAddress } from "../testWallet.js";
import { append, h, replace } from "../ui/dom.js";
import { currentAddress, dialog, kondor, KONDOR_STORE, state, testWallet, vault, walletName } from "./state.js";
import { avatar } from "./story.js";
import { notice } from "./ui.js";
import { refreshAccount } from "./data.js";
import { renderChip, renderPage } from "./shell.js";

export function openWallet() {
  state.notice = "";
  renderDialog();
  if (!dialog.open) dialog.showModal();
}

export function renderDialog() {
  const body = h("div", { class: "sheet-body" });
  append(body, h("div", { class: "sheet-head" }, [
    h("h2", { id: "wallet-title" }, ["Your wallet"]),
    h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => dialog.close() }, ["Close"]),
  ]));
  append(body, h("p", { class: "body-2" }, ["SwarmTales never asks for your private key or recovery words. Your wallet signs, and shows you what you're signing first."]));
  const address = currentAddress();
  if (address && state.wallet) {
    const connected = h("div", { class: "wallet-option" }, [
      h("h3", {}, [walletName() + " is connected"]),
      h("p", { class: "mono" }, [address]),
    ]);
    if (state.wallet.id === "koinvault" && state.wallet.getExpiry) {
      const when = formatUtc(Math.floor((state.wallet.getExpiry() || 0) / 1000));
      if (when) append(connected, h("p", { class: "meta" }, ["This pairing ends " + when + ". It doesn't renew itself."]));
    }
    append(connected, h("div", { class: "row" }, [state.wallet.id === "kondor" ? h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => connectKondor(true) }, ["Use a different account"]) : null, h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
      await state.wallet.disconnect();
      if (state.wallet === kondor || state.wallet === vault || state.wallet === testWallet) state.wallet = null;
      clearSavedSession();
      state.account = null;
      renderChip();
      renderDialog();
      renderPage();
    } }, ["Disconnect"])]));
    append(body, connected);
  }
  append(body, kondorSection());
  if (testWallet) append(body, testWalletSection());
  append(body, h("div", { class: "wallet-option" }, [h("h3", {}, ["KOIN Vault"]), vaultSection()]));
  replace(dialog, body);
}

function vaultSection() {
  const box = h("div");
  const info = state.vaultInfo;
  if (info && info.phase === "pairing") {
    const uri = info.uri || vault.getPairingUri();
    append(box, h("p", {}, ["Open KOIN Vault, approve SwarmTales with your passkey, then come back to this tab. The 30-minute session starts when the code is created."]));
    if (uri) {
      append(box, h("p", {}, [h("a", { href: uri, target: "_blank", rel: "noopener noreferrer", referrerpolicy: "no-referrer" }, ["Open KOIN Vault"])]));
      const qr = h("div", { class: "qr", hidden: true });
      const show = h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
        show.disabled = true;
        try {
          const QR = await import("qrcode");
          const svg = await QR.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
          const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
          qr.hidden = false;
          replace(qr, document.importNode(parsed.documentElement, true));
        } catch {
          qr.hidden = false;
          qr.textContent = "The code could not be drawn. Use the link instead.";
        }
      } }, ["Show pairing code"]);
      append(box, h("p", { class: "meta" }, ["The code is a key for this session. Don't share your screen while it's visible."]), show, qr);
    }
    append(box, h("p", { id: "vault-live", class: "meta" }));
    append(box, h("button", { type: "button", class: "text-button", onClick: async () => {
      await vault.disconnect();
      state.vaultInfo = null;
      if (state.wallet === vault) state.wallet = null;
      renderDialog();
    } }, ["Cancel pairing"]));
    return box;
  }
  append(box, h("p", {}, ["A phone wallet. You approve with a passkey, with no extension to install."]));
  const button = h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: connectVault }, ["Connect KOIN Vault"]);
  const note = h("p", { class: "meta" }, ["Checking KOIN Vault…"]);
  append(box, h("div", { class: "row" }, [button]), note);
  fetchVaultConfig().then((config) => {
    const decision = vaultPairingDecision(network, config, location.protocol);
    note.textContent = decision.ok ? "KOIN Vault is on " + config.network + "." : decision.reason;
    if (!decision.ok) button.disabled = true;
  }).catch((error) => {
    note.textContent = explainFailure(error);
    button.disabled = true;
  });
  return box;
}

/**
 * Kondor's "Optimize mana" asks Kondor's mana-meter account to pay for a trial
 * run. On the Foundation testnet that account has no mana, so the check fails
 * and Kondor loops on "Refresh check". The way out is in Kondor's own window.
 */
function kondorTestnetHelp(open) {
  return h("details", { class: "more-options", open: open || null }, [
    h("summary", {}, ["Kondor keeps asking to “Refresh check”?"]),
    h("p", { class: "body-2" }, [
      "Some Kondor versions can't check transactions on the testnet yet. Nothing is wrong with your wallet or the transaction. Try this:",
    ]),
    h("ol", { class: "how-list" }, [
      h("li", {}, ["Press ", h("b", {}, ["Use free mana"]), " in Kondor's window. If your Kondor has an ", h("b", {}, ["Optimize mana"]), " switch under Technical details, switch it off."]),
      h("li", {}, ["If it still asks to “Refresh check”, cancel it and use the ", h("b", {}, ["Test wallet (testnet only)"]), " further down this window instead."]),
    ]),
    h("p", { class: "meta" }, ["On the main network, Kondor works normally."]),
  ]);
}

function kondorSection() {
  const box = h("div", { class: "wallet-option" }, [
    h("h3", {}, ["Kondor"]),
    h("p", {}, ["A free browser extension for Chrome, Brave and Edge on a computer. It asks you to confirm in a small window."]),
  ]);
  if (!network.mainnet) append(box, kondorTestnetHelp(false));
  const list = state.kondorAccounts;
  if (!list) {
    append(box, h("div", { class: "row" }, [
      h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => connectKondor(false) }, ["Connect Kondor"]),
      h("a", { href: KONDOR_STORE, target: "_blank", rel: "noopener noreferrer" }, ["Install Kondor"]),
    ]));
    return box;
  }
  const current = currentAddress();
  append(box,
    h("p", { class: "body-2" }, [list.length === 1 ? "Kondor shared one account with this site:" : "Kondor shared " + list.length + " accounts. Pick the one to write with:"]),
    h("ul", { class: "account-list" }, list.map((account) => h("li", {}, [
      h("button", {
        type: "button",
        class: "account-choice",
        "aria-pressed": String(account.address === current),
        onClick: () => chooseKondorAccount(account.address),
      }, [
        avatar(account.address),
        h("span", {}, [
          account.name ? h("b", {}, [account.name]) : null,
          h("span", { class: "mono" }, [account.address]),
        ]),
      ]),
    ]))),
    h("p", { class: "meta" }, [
      "Don't see the account you want? Press Check again. Kondor opens its window, where you can tick every account you want to share with SwarmTales.",
    ]),
    h("div", { class: "row" }, [
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => connectKondor(true) }, ["Check again"]),
      h("button", { type: "button", class: "text-button", onClick: () => { state.kondorAccounts = null; renderDialog(); } }, ["Cancel"]),
    ])
  );
  return box;
}

/** Ask Kondor which accounts it shares. With one account and no request to choose, use it. */
async function connectKondor(choose) {
  try {
    const accounts = await kondor.listAccounts();
    if (accounts.length === 1 && !choose) {
      await chooseKondorAccount(accounts[0].address);
      return;
    }
    state.kondorAccounts = accounts;
    renderDialog();
  } catch (error) {
    const body = dialog.querySelector(".sheet-body") || dialog;
    append(body, notice("bad", h("p", {}, [explainFailure(error)])));
  }
}

async function chooseKondorAccount(address) {
  try {
    if (vault.getAddress() || vault.getPairingUri()) await vault.disconnect();
    state.vaultInfo = null;
    kondor.useAccount(address);
    state.wallet = kondor;
    state.kondorAccounts = null;
    await refreshAccount();
    renderDialog();
    renderPage();
  } catch (error) {
    const body = dialog.querySelector(".sheet-body") || dialog;
    append(body, notice("bad", h("p", {}, [explainFailure(error)])));
  }
}

/** Testnet only: a throwaway key kept in this browser. */
function testWalletSection() {
  const existing = storedTestAddress();
  const inUse = state.wallet === testWallet;
  const box = h("div", { class: "wallet-option" }, [
    h("h3", {}, ["Test wallet (testnet only)"]),
    h("p", {}, [
      "A throwaway wallet kept in this browser, for trying SwarmTales without an extension. ",
      "It only exists on the testnet. Only ever send it test KOIN (tKOIN).",
    ]),
  ]);
  if (existing) {
    append(box,
      h("p", { class: "meta" }, ["Address (send tKOIN here so it has mana):"]),
      h("p", { class: "mono" }, [existing]),
      h("div", { class: "row" }, [
        inUse ? null : h("button", { type: "button", class: "btn btn-primary btn-small", onClick: useTestWallet }, ["Use the test wallet"]),
        h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
          try {
            await navigator.clipboard.writeText(existing);
          } catch {
            /* the address is shown above */
          }
        } }, ["Copy address"]),
      ]),
      h("details", { class: "more-options" }, [
        h("summary", {}, ["Forget this test wallet"]),
        h("p", { class: "meta" }, ["This deletes the key from this browser. Any tKOIN, Ink or stories on it can't be used again. There's no undo."]),
        h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => {
          testWallet.forget();
          if (state.wallet === testWallet) {
            state.wallet = null;
            state.account = null;
            clearSavedSession();
          }
          renderChip();
          renderDialog();
          renderPage();
        } }, ["Delete the test key"]),
      ])
    );
  } else {
    append(box,
      h("p", { class: "meta" }, ["After you create it, send it some tKOIN from Kondor's own Send screen. Holding tKOIN gives it mana, so it can sign."]),
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: useTestWallet }, ["Create a test wallet"])
    );
  }
  return box;
}

async function useTestWallet() {
  try {
    if (vault.getAddress() || vault.getPairingUri()) await vault.disconnect();
    state.vaultInfo = null;
    state.kondorAccounts = null;
    await testWallet.connect();
    state.wallet = testWallet;
    saveSession({ kind: "testwallet" });
    await refreshAccount();
    renderDialog();
    renderPage();
  } catch (error) {
    const body = dialog.querySelector(".sheet-body") || dialog;
    append(body, notice("bad", h("p", {}, [explainFailure(error)])));
  }
}

async function connectVault() {
  try {
    if (state.wallet === kondor || state.wallet === testWallet) {
      await kondor.disconnect();
      state.wallet = null;
      state.account = null;
    }
    await vault.connect();
    state.wallet = vault;
    renderDialog();
  } catch (error) {
    const body = dialog.querySelector(".sheet-body") || dialog;
    append(body, notice("bad", h("p", {}, [explainFailure(error)])));
  }
}
