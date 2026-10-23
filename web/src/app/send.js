/**
 * Sign with the connected wallet, send, and wait for the transaction's own
 * receipt before saying "Done".
 */
import { network } from "../config.js";
import { waitForConfirmation } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { TX_CONFIRMED, TX_REVERTED } from "../lib/confirm.js";
import { formatUtc, VAULT_MANA_CEILING } from "../lib/money.js";
import { kondorHint } from "../wallet.js";
import { vaultManaDecision } from "../lib/vaultApi.js";
import { h, replace } from "../ui/dom.js";
import { problems, state } from "./state.js";
import { notice } from "./ui.js";

export async function send(operations, status) {
  if (!state.wallet) throw new Error("Connect a wallet first.");
  if (problems.length) throw new Error(problems.join(" "));
  const manaDecision = state.wallet.id === "koinvault" && state.account
    ? vaultManaDecision(state.account.mana, VAULT_MANA_CEILING)
    : null;
  if (manaDecision && manaDecision.blocked) throw new Error(manaDecision.message);
  replace(status, notice("info", h("p", {}, [
    state.wallet.id === "testwallet" ? "Signing with the test wallet and sending…" :
    state.wallet.id === "koinvault" ? "Sending the request to KOIN Vault…" : "Kondor should open now. Check the details, then confirm. " + kondorHint(network.mainnet),
  ])));
  const sent = await state.wallet.signAndSend(operations, {
    onProgress(progress) {
      if (progress.phase === "awaiting-approval") {
        const when = progress.expiresAt ? " It expires " + formatUtc(Math.floor(progress.expiresAt / 1000)) + "." : "";
        replace(status, notice("info", h("p", {}, [
          "Approve this in KOIN Vault with your passkey, fingerprint, or PIN." + when + " ",
          h("a", { href: "https://koinvault.app/", target: "_blank", rel: "noopener noreferrer" }, ["Open KOIN Vault"]),
        ])));
      } else if (progress.phase === "submitting") {
        replace(status, notice("info", h("p", {}, ["Submitting and waiting for the next block. This can take about a minute. Please don't send it again."])));
      } else if (progress.phase === "verifying") {
        replace(status, notice("info", h("p", {}, ["KOIN Vault says it's sent. Checking on the network that it's exactly what you approved…"])));
      }
    },
  });
  const id = sent.transactionId || "";
  if (sent.receipt && sent.receipt.reverted) {
    const logs = Array.isArray(sent.receipt.logs) ? sent.receipt.logs.join(" ") : "";
    replace(status, notice("bad", h("p", {}, [explainFailure(new Error(logs || "The network refused it."))])));
    return false;
  }
  // Wait for the block and read this transaction's own receipt. Only a
  // receipt that did not revert counts as done (AB-004): callers show links,
  // "Ink has arrived" and so on only when this returns true.
  if (id) replace(status, notice("info", h("p", {}, ["Sent. Waiting for the next block (usually under a minute)…"])));
  const outcome = await waitForConfirmation(id);
  if (outcome.state === TX_REVERTED) {
    const logs = outcome.logs.join(" ");
    replace(status, notice("bad", [
      h("p", {}, [explainFailure(new Error(logs || "The network refused it."))]),
      h("p", { class: "mono small" }, ["Transaction " + id]),
    ]));
    return false;
  }
  if (outcome.state !== TX_CONFIRMED) {
    replace(status, notice("warn", [
      h("p", {}, [
        "We couldn't confirm this yet. It may still go through. Reload the page in a minute to check, and don't send it again until you have, so you aren't charged twice.",
      ]),
      id ? h("p", { class: "mono small" }, ["Transaction " + id]) : null,
    ]));
    return false;
  }
  replace(status, notice("ok", [
    h("p", {}, ["Done. It's on the record."]),
    h("p", { class: "mono small" }, ["Transaction " + id]),
  ]));
  return true;
}
