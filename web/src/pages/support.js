/**
 * "Support the writers": a quiet, folded panel under a story or book. One
 * payment in the site's payment token, split among the writers by their
 * share, sent straight from the reader's wallet to theirs. SwarmTales takes
 * nothing, and reading never asks for it.
 */
import { contracts, network } from "../config.js";
import { encode } from "../chain.js";
import { formatUnits, shortAddress } from "../lib/money.js";
import { parseTip, splitTip, MAX_TIP_RECIPIENTS } from "../lib/tip.js";
import { h, replace } from "../ui/dom.js";
import { currentAddress, state } from "../app/state.js";
import { connectButton, failure, field, notice, statusBox } from "../app/ui.js";
import { send } from "../app/send.js";

export function supportPanel(storyId, story, credits) {
  const writers = (credits || []).filter((c) => c.chars > 0);
  if (!writers.length) return null;
  const symbol = contracts.paymentSymbol;
  const decimals = Number(contracts.paymentDecimals);
  const amount = h("input", { type: "text", inputmode: "decimal", value: "1", "aria-label": "Amount in " + symbol, class: "tip-amount" });
  const preview = h("div", { class: "tip-preview" });
  const status = statusBox();
  const button = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Send to the writers"]);
  let plan = [];
  let sending = false;
  let sentFor = "";
  // The page's payment-token check must have passed (decimals and symbol confirmed on chain, M-8).
  const tokenOk = () => !!(state.payment && !state.payment.mismatch);

  // The plan for this amount, payer and token, worked out fresh each time.
  const planFor = (me) => {
    const base = parseTip(amount.value, Number(contracts.paymentDecimals));
    return typeof base === "string" ? base : splitTip(base, writers, me);
  };

  const draw = () => {
    const me = currentAddress() || "";
    if (!tokenOk()) {
      plan = [];
      replace(preview, h("p", { class: "meta small" }, ["The payment token can't be checked on the network right now, so support is unavailable. Try again shortly."]));
      button.disabled = true;
      return;
    }
    const base = parseTip(amount.value, decimals);
    if (typeof base === "string") {
      plan = [];
      replace(preview, h("p", { class: "meta small" }, [base]));
      button.disabled = true;
      return;
    }
    plan = splitTip(base, writers, me);
    if (!plan.length) {
      replace(preview, h("p", { class: "meta small" }, [writers.every((w) => w.address === me)
        ? "You're the only writer here, so there's no one else to thank."
        : "That amount is too small to split. Try a larger one."]));
      button.disabled = true;
      return;
    }
    button.disabled = sending || sentFor === amount.value + "|" + me;
    replace(preview, h("ul", { class: "tip-list" }, plan.map((p) => h("li", {}, [
      h("span", { class: "mono small" }, [shortAddress(p.address)]),
      h("b", {}, [formatUnits(p.value.toString(), decimals) + " " + symbol]),
    ]))), writers.filter((w) => w.address !== me).length > MAX_TIP_RECIPIENTS
      ? h("p", { class: "meta small" }, ["The " + MAX_TIP_RECIPIENTS + " writers with the largest shares are paid, so one confirmation is enough."])
      : null);
  };
  amount.addEventListener("input", draw);

  button.addEventListener("click", async () => {
    const me = currentAddress();
    if (!me || sending) return;
    if (!tokenOk()) {
      replace(status, notice("bad", h("p", {}, ["The payment token's details couldn't be confirmed, so nothing was sent."])));
      return;
    }
    // Recompute with the wallet, token and amount as they are now.
    const fresh = planFor(me);
    if (typeof fresh === "string" || !fresh.length) {
      draw();
      return;
    }
    const shown = plan.map((p) => p.address + ":" + p.value).join(",");
    if (fresh.map((p) => p.address + ":" + p.value).join(",") !== shown) {
      plan = fresh;
      draw();
      replace(status, notice("warn", h("p", {}, ["The amounts changed (a different wallet or token). Check them above, then send again."])));
      return;
    }
    sending = true;
    button.disabled = true;
    try {
      const ops = [];
      for (const p of fresh) ops.push(await encode("token", "transfer", { from: me, to: p.address, value: p.value.toString() }));
      if (await send(ops, status)) {
        // Not again for the same amount by accident: change the amount to send more.
        sentFor = amount.value + "|" + me;
        replace(status, notice("ok", h("p", {}, ["Thank you. Your support went straight to the writers' wallets."])));
      }
    } catch (error) {
      failure(status, error);
    } finally {
      sending = false;
      draw();
    }
  });

  draw();
  const me = currentAddress();
  return h("details", { class: "support-panel card" }, [
    h("summary", {}, [h("span", { class: "aside-title" }, ["Support the writers"])]),
    h("p", { class: "body-2 small" }, [
      "Enjoyed it? Send a thank-you in " + symbol + ", split between the writers by how much each wrote. It goes straight from your wallet to theirs: SwarmTales takes nothing.",
      network.mainnet ? "" : " (Test version: this sends test tokens.)",
    ]),
    me
      ? h("div", { class: "stack" }, [field("Amount (" + symbol + ")", amount), preview, h("div", { class: "row" }, [button]), status,
        h("p", { class: "meta small" }, ["Your wallet shows each payment before you confirm. You pay the small network fee (mana) yourself."])])
      : h("div", {}, [connectButton("Connect a wallet to send support")]),
  ]);
}
