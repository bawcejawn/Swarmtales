/**
 * Membership page: Writer months, Ink packs, collecting monthly Ink, and
 * paying for someone else's Writer month.
 */
import { contracts } from "../config.js";
import { encode, read } from "../chain.js";
import { label, TIER } from "../lib/labels.js";
import { formatUtc, shortAddress } from "../lib/money.js";
import { assessWriterBuy, isActiveWriter, writerMinInk } from "../lib/rules.js";
import { append, h, icons, replace } from "../ui/dom.js";
import { currentAddress, state } from "../app/state.js";
import { num, plural } from "../app/format.js";
import { paymentBlock, tokenAmount, tokenPicker } from "../app/payment.js";
import { connectButton, failure, field, loadingLine, notice, problemsNotice, setMeta, statusBox, walletNote } from "../app/ui.js";
import { refreshAccount, switchPaymentToken } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

export function renderMembership(page) {
  setMeta("Membership", "A Writer membership on SwarmTales comes with Ink, your writing allowance. Reading is always free.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container, 
    h("p", { class: "eyebrow" }, ["Membership"]),
    h("h1", { class: "title" }, ["Ink for writing"]),
    h("p", { class: "lede" }, ["Reading is always free. To write, you need Ink: from a promo link, a Writer membership, or an invited story whose opener pays from a writers' pool."])
  );
  const picker = tokenPicker(switchPaymentToken);
  if (picker) append(container, picker);
  const grid = h("div", { class: "card-grid" });
  grid.style.marginTop = "40px";
  append(container, grid);
  if (!state.overview) {
    append(grid, loadingLine(state.chainError ? "Prices will appear when the network answers." : "Reading the Shop…"));
    return;
  }
  const cfg = state.overview.shopCfg;
  const address = currentAddress();

  // Writer month
  const buyStatus = statusBox();
  const buyButton = h("button", { type: "button", class: "btn btn-primary btn-block" }, ["Buy one Writer month"]);
  const writerCard = h("section", { class: "card card-lg", "aria-labelledby": "writer-title" }, [
    h("p", { class: "eyebrow" }, ["Writer"]),
    h("h2", { class: "h2", id: "writer-title" }, [tokenAmount(state.overview.writerPrice)]),
    h("p", { class: "meta" }, ["per month"]),
    h("ul", { class: "how-list" }, [
      h("li", {}, [num(cfg.writer_ink) + " Ink each month"]),
      h("li", {}, ["Write in any public story"]),
      h("li", {}, ["Ink has no cash value and can't be sent or sold"]),
    ]),
  ]);
  append(grid, writerCard);
  const payBlock = paymentBlock();
  if (cfg.paused) append(writerCard, notice("warn", h("p", {}, ["The Shop is paused for maintenance. Please check back soon."])));
  else if (payBlock) append(writerCard, payBlock);
  else if (!address) append(writerCard, connectButton());
  else if (!state.account) append(writerCard, loadingLine("Reading your balance…"));
  else {
    const minInk = writerMinInk(state.account.membership, state.account.now, cfg);
    append(writerCard, buyButton, h("p", { class: "meta small" }, [
      "You hold " + tokenAmount(state.account.token) + ". One confirmation approves exactly this price and buys the month, with at least " +
        num(minInk) + " Ink a month, or nothing is charged.",
    ]), walletNote(), buyStatus);
    buyButton.addEventListener("click", async () => {
      buyStatus.replaceChildren();
      buyButton.disabled = true;
      try {
        const plan = assessWriterBuy({ price: state.overview.writerPrice, balance: state.account.token, paused: !!cfg.paused });
        if (!plan.ok) {
          append(buyStatus, problemsNotice(plan.problems));
          return;
        }
        const approve = await encode("token", "approve", { owner: address, spender: contracts.shop, value: plan.price });
        const buy = await encode("shop", "buy_membership", {
          payer: address, tier: 2, months: 1, token: contracts.paymentToken, max_price: plan.price,
          // The Ink a month the page showed (M-2): an active Writer term keeps its own amount.
          min_ink: writerMinInk(state.account.membership, state.account.now, cfg),
        });
        const sent = await send([approve, buy], buyStatus);
        if (sent) {
          await refreshAccount();
          renderPage();
        }
      } catch (error) {
        failure(buyStatus, error);
      } finally {
        buyButton.disabled = false;
      }
    });
  }

  // Ink packs (active Writers only)
  const packs = (state.overview.packs || []).filter((p) => p.price !== "0" && p.ink !== "0");
  if (packs.length) {
    const writerNow = !!(state.account && isActiveWriter(state.account.membership, state.account.now));
    const packStatus = statusBox();
    const packCard = h("section", { class: "card", "aria-labelledby": "packs-title" }, [
      h("p", { class: "eyebrow" }, ["More Ink"]),
      h("h2", { class: "h3", id: "packs-title" }, ["Ink packs"]),
      h("p", { class: "body-2" }, ["Top up your writing allowance any time during a Writer month. Ink has no cash value and can't be sent or sold."]),
    ]);
    const list = h("div", { class: "pack-list" });
    for (const pack of packs) {
      const button = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Buy"]);
      append(list, h("div", { class: "pack" }, [
        h("div", {}, [h("b", {}, [num(pack.ink) + " Ink"]), h("span", { class: "meta" }, [pack.name + " · " + tokenAmount(pack.price)])]),
        button,
      ]));
      button.disabled = !address || !state.account || !writerNow || !!cfg.paused || !!payBlock;
      button.addEventListener("click", async () => {
        replace(packStatus);
        button.disabled = true;
        try {
          if (BigInt(state.account.token || "0") < BigInt(pack.price)) {
            throw new Error("Your " + contracts.paymentSymbol + " balance is below this pack's price.");
          }
          const approve = await encode("token", "approve", { owner: address, spender: contracts.shop, value: pack.price });
          const buy = await encode("shop", "buy_pack", {
            payer: address, pack: pack.item, token: contracts.paymentToken, max_price: pack.price,
            min_ink: String(pack.ink), // the Ink shown: the Shop gives no less, or charges nothing (M-2)
          });
          const sent = await send([approve, buy], packStatus);
          if (sent) {
            await refreshAccount();
            renderPage();
          }
        } catch (error) {
          failure(packStatus, error);
        } finally {
          button.disabled = false;
        }
      });
    }
    append(packCard, list);
    if (payBlock) append(packCard, payBlock.cloneNode(true));
    else if (!address) append(packCard, h("p", { class: "meta" }, ["Connect a wallet to buy a pack."]));
    else if (state.account && !writerNow) append(packCard, h("p", { class: "meta" }, ["Packs are for active Writers. Start a Writer month first."]));
    append(packCard, packStatus);
    append(grid, packCard);
  }

  // Your membership
  if (address && state.account) {
    const account = state.account;
    const m = account.membership || {};
    const writer = isActiveWriter(m, account.now);
    const until = formatUtc(m.paid_until || "0");
    const unclaimed = Number(m.months_unclaimed || 0);
    const nextClaim = Number(m.next_claim_at || 0);
    const canClaim = unclaimed > 0 && Number(account.now || 0) >= nextClaim;
    const claimStatus = statusBox();
    const mine = h("section", { class: "card", "aria-labelledby": "mine-title" }, [
      h("h2", { class: "h3", id: "mine-title" }, ["Your membership"]),
      h("dl", { class: "facts" }, [
        h("div", {}, [h("dt", {}, ["Ink"]), h("dd", {}, [num(account.ink)])]),
        h("div", {}, [h("dt", {}, ["Membership"]), h("dd", {}, [writer ? "Writer" : label(TIER, m.tier)])]),
        until ? h("div", {}, [h("dt", {}, [writer ? "Paid until" : "Ended"]), h("dd", {}, [until])]) : null,
        h("div", {}, [h("dt", {}, ["Promo"]), h("dd", {}, [account.promo === "0" ? "Not claimed yet" : "Claimed"])]),
      ]),
    ]);
    if (unclaimed > 0) {
      const claimButton = h("button", { type: "button", class: "btn btn-primary", disabled: !canClaim }, ["Collect this month's Ink"]);
      append(mine, h("div", { class: "actions" }, [
        claimButton,
        h("p", { class: "meta" }, [
          canClaim
            ? plural(unclaimed, "month") + " of Ink waiting. Collect one month at a time."
            : "Your next month of Ink is ready on " + formatUtc(nextClaim) + ".",
        ]),
      ]), claimStatus);
      claimButton.addEventListener("click", async () => {
        claimStatus.replaceChildren();
        claimButton.disabled = true;
        try {
          const op = await encode("shop", "claim_writer_ink", { account: address });
          const sent = await send([op], claimStatus);
          if (sent) {
            await refreshAccount();
            renderPage();
          }
        } catch (error) {
          failure(claimStatus, error);
        } finally {
          claimButton.disabled = false;
        }
      });
    }
    append(grid, mine);
  }

  append(grid, h("section", { class: "card", "aria-labelledby": "free-title" }, [
    h("h2", { class: "h3", id: "free-title" }, ["Free ways to start"]),
    h("ul", { class: "how-list" }, [
      h("li", {}, [h("b", {}, ["Promo links."]), " SwarmTales sometimes shares a link on Discord, Telegram or X. Open it and claim free Ink. One claim per wallet, ever."]),
      h("li", {}, [h("b", {}, ["Invites."]), " A story's opener can invite you to a private story. Joining is free, and the opener's writers' pool pays for your parts while it lasts. You need a Writer month there, which the opener can pay for."]),
      h("li", {}, [h("b", {}, ["Open your own."]), " Opening a story comes with starter Ink for your first part."]),
    ]),
    h("p", {}, [h("a", { class: "link-arrow", href: "#/how" }, ["How Ink works", icons.arrow()])]),
  ]));
}

/** Pay for someone else's Writer month (their membership and Ink go to them). */
export function giftSection(me) {
  const who = h("input", { type: "text", placeholder: "Writer's wallet address (starts with 1)", autocomplete: "off", spellcheck: "false" });
  const status = statusBox();
  const give = h("button", { type: "submit", class: "btn btn-secondary btn-small" }, ["Pay for their Writer month"]);
  const price = state.overview ? state.overview.writerPrice : "0";
  return h("form", { class: "gift-form", onSubmit: async (event) => {
    event.preventDefault();
    give.disabled = true;
    try {
      const account = who.value.trim();
      if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(account)) throw new Error("That doesn't look like a wallet address.");
      const plan = assessWriterBuy({ price, balance: state.account ? state.account.token : "0", paused: state.overview && state.overview.shopCfg.paused });
      if (!plan.ok) {
        replace(status, problemsNotice(plan.problems));
        return;
      }
      const blocked = paymentBlock();
      if (blocked) {
        replace(status, blocked);
        return;
      }
      const theirs = await read("shop", "get_membership", { account });
      const now = state.account ? state.account.now : 0;
      const active = isActiveWriter(theirs || {}, now);
      status.textContent = active
        ? "They already have a Writer month until " + (formatUtc(theirs.paid_until) || "later") + ". This adds one more month."
        : "";
      const approve = await encode("token", "approve", { owner: me, spender: contracts.shop, value: plan.price });
      const buy = await encode("shop", "buy_membership", {
        payer: me, tier: 2, months: 1, token: contracts.paymentToken, beneficiary: account, max_price: plan.price,
        // Their Ink a month as shown: an active Writer term keeps its own amount (M-2).
        min_ink: writerMinInk(theirs || {}, now, state.overview ? state.overview.shopCfg : {}),
      });
      if (await send([approve, buy], status)) {
        who.value = "";
        append(status, notice("ok", h("p", {}, ["Done. " + shortAddress(account) + " has a Writer month, and its Ink went to them."])));
        await refreshAccount();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      give.disabled = false;
    }
  } }, [
    h("p", { class: "meta small" }, [
      "Invited writers need an active Writer month to write here. You can pay for theirs: " + tokenAmount(price) +
        " from your wallet. The month and its Ink go to them. This is optional; they can also buy their own.",
    ]),
    field("Writer's wallet", who),
    h("div", { class: "actions" }, [give]),
    status,
  ]);
}
