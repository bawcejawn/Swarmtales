/**
 * Editions of a finished book (Wave 3), on the book page:
 *   - the opener and writers claim their free First or Contributor Edition;
 *   - readers buy a numbered Collector's Edition at the price shown, split
 *     on chain between the writers and SwarmTales;
 *   - writers collect what the book's editions earned them;
 *   - the opener can choose the book's price inside the allowed range.
 * Hidden until the Editions contract is set in config.js.
 */
import { contracts, network } from "../config.js";
import { encode, read } from "../chain.js";
import { formatUnits } from "../lib/money.js";
import { parseTip } from "../lib/tip.js";
import { kindLabel, splitSale, writerEdition } from "../lib/editions.js";
import { h, replace } from "../ui/dom.js";
import { currentAddress, state } from "../app/state.js";
import { connectButton, failure, field, notice, statusBox } from "../app/ui.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

export function editionsPanel(storyId, story, credits) {
  if (!contracts.editions || Number(story.status) !== 4) return null;
  const body = h("div", { class: "stack" }, [h("p", { class: "meta small" }, ["Loading editions…"])]);
  const box = h("section", { class: "editions-panel card no-print" }, [
    h("h2", { class: "h3" }, ["Editions"]),
    body,
  ]);
  draw(body, storyId, story, credits).catch((error) => replace(body, h("p", { class: "meta small" }, [String(error && error.message ? error.message : error)])));
  return box;
}

async function draw(body, storyId, story, credits) {
  const me = currentAddress() || "";
  const token = contracts.paymentToken;
  const symbol = contracts.paymentSymbol;
  const decimals = Number(contracts.paymentDecimals);
  const tokenOk = !!(state.payment && !state.payment.mismatch);
  const id = String(storyId);
  const [cfg, book, priceRes, settings] = await Promise.all([
    read("editions", "get_config", {}),
    read("editions", "get_book_editions", { story_id: id }),
    read("editions", "get_price", { story_id: id, token }),
    read("editions", "get_token_settings", { token }),
  ]);
  const price = BigInt((priceRes && priceRes.value) || "0");
  const bps = Number((cfg && cfg.platform_bps) || 0);
  const sold = Number((book && book.collector_count) || 0);
  const paused = !!(cfg && cfg.paused);
  const parts = [];

  // Readers: the Collector's Edition.
  const buyStatus = statusBox();
  if (price > 0n && !story.needs_new_pdf && story.sum_tracked) {
    const { toWriters, toTreasury } = splitSale(price, bps);
    const buy = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Buy No. " + (sold + 1) + " for " + formatUnits(price.toString(), decimals) + " " + symbol]);
    buy.disabled = !me || !tokenOk || paused;
    buy.addEventListener("click", async () => {
      const who = currentAddress();
      if (!who) return;
      buy.disabled = true;
      try {
        // The price as it is now: never more than the button showed.
        const now = BigInt(((await read("editions", "get_price", { story_id: id, token })) || {}).value || "0");
        if (now !== price) throw new Error("The price changed to " + formatUnits(now.toString(), decimals) + " " + symbol + ". Reload the page to see it.");
        const approve = await encode("token", "approve", { owner: who, spender: contracts.editions, value: price.toString() });
        const op = await encode("editions", "buy_edition", { buyer: who, story_id: id, token, max_price: price.toString() });
        if (await send([approve, op], buyStatus)) renderPage();
      } catch (error) {
        failure(buyStatus, error);
      } finally {
        buy.disabled = false;
      }
    });
    parts.push(h("div", { class: "stack" }, [
      h("h3", { class: "h4" }, ["Collector's Edition"]),
      h("p", { class: "body-2" }, [
        "A numbered keepsake of this book, kept in your wallet. " + formatUnits(toWriters.toString(), decimals) + " " + symbol +
        " of the price goes to the book's writers, by how much of their writing survived into it, and " +
        formatUnits(toTreasury.toString(), decimals) + " " + symbol + " to SwarmTales. " +
        (sold ? plural(sold, "copy has", "copies have") + " been collected so far." : "Be the first to collect it."),
      ]),
      h("p", { class: "meta small" }, ["It's a keepsake, not an investment, and doesn't give you any copyright in the book. You can send it to another wallet yourself, as a gift or a private sale; SwarmTales takes nothing from that." +
        (network.mainnet ? "" : " (Test version: this uses test tokens.)")]),
      me ? h("div", { class: "row" }, [buy]) : connectButton("Connect a wallet to collect it"),
      paused ? notice("warn", h("p", {}, ["Editions are paused for a moment. Please try again later."])) : null,
      me && !tokenOk ? h("p", { class: "meta small" }, ["The payment token can't be checked on the network right now. Try again shortly."]) : null,
      buyStatus,
    ]));
  } else if (!story.sum_tracked) {
    parts.push(h("p", { class: "meta small" }, ["This book was finished before Collector's Editions could share their sales with its writers, so it isn't sold as one. Its writers can still claim their free editions."]));
  } else if (story.needs_new_pdf) {
    parts.push(h("p", { class: "meta small" }, ["This book is being updated after a part was taken down. Collector's Editions are on sale again once it's republished."]));
  }

  if (me) {
    // Writers: the free edition.
    const claimStatus = statusBox();
    const mineRes = await read("editions", "get_writer_edition", { story_id: id, writer: me });
    const mine = Number((mineRes && mineRes.value) || 0);
    const which = writerEdition(story, me, credits);
    if (mine) {
      const ed = await read("editions", "get_edition", { token_number: String(mine) });
      parts.push(h("p", { class: "body-2" }, ["You hold this book's " + kindLabel(ed && ed.kind) + " (edition " + mine + " in your wallet)."]));
    } else if (which.kind) {
      const claim = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Claim your " + (which.kind === "first" ? "First Edition" : "Contributor Edition") + " (free)"]);
      claim.disabled = paused;
      claim.addEventListener("click", async () => {
        claim.disabled = true;
        try {
          const op = await encode("editions", "claim_writer_edition", { writer: currentAddress(), story_id: id });
          if (await send([op], claimStatus)) renderPage();
        } catch (error) {
          failure(claimStatus, error);
        } finally {
          claim.disabled = false;
        }
      });
      parts.push(h("div", { class: "stack" }, [
        h("h3", { class: "h4" }, [which.kind === "first" ? "Your First Edition" : "Your Contributor Edition"]),
        h("p", { class: "body-2" }, [which.kind === "first"
          ? "You opened this story. Your First Edition is free and stays in your wallet as proof you started it."
          : "You wrote part of this book. Your Contributor Edition is free and stays in your wallet as proof of it."]),
        h("div", { class: "row" }, [claim]),
        claimStatus,
      ]));
    } else if (which.reason) {
      parts.push(h("p", { class: "meta small" }, [which.reason]));
    }

    // Writers: what the book's editions earned them.
    const earnings = await read("editions", "get_earnings", { story_id: id, token, writer: me });
    const owed = BigInt((earnings && earnings.owed) || "0");
    const paid = BigInt((earnings && earnings.paid) || "0");
    if (owed > 0n || paid > 0n) {
      const collectStatus = statusBox();
      const collect = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Collect " + formatUnits(owed.toString(), decimals) + " " + symbol]);
      collect.disabled = owed === 0n;
      collect.addEventListener("click", async () => {
        collect.disabled = true;
        try {
          const op = await encode("editions", "claim_earnings", { writer: currentAddress(), story_id: id, token });
          if (await send([op], collectStatus)) renderPage();
        } catch (error) {
          failure(collectStatus, error);
        } finally {
          collect.disabled = false;
        }
      });
      parts.push(h("div", { class: "stack" }, [
        h("h3", { class: "h4" }, ["Your earnings from this book"]),
        h("p", { class: "body-2" }, ["Collected so far: " + formatUnits(paid.toString(), decimals) + " " + symbol + ". Ready to collect: " + formatUnits(owed.toString(), decimals) + " " + symbol + "."]),
        h("div", { class: "row" }, [collect]),
        collectStatus,
      ]));
    }

    // The opener: the book's price.
    if (story.opener === me && settings && settings.enabled) {
      const priceStatus = statusBox();
      const input = h("input", { type: "text", inputmode: "decimal", value: formatUnits(price.toString(), decimals), "aria-label": "Price in " + symbol });
      const save = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Set the price"]);
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const value = parseTip(input.value, decimals);
          if (typeof value === "string") throw new Error(value);
          if (value < BigInt(settings.min_price) || value > BigInt(settings.max_price)) {
            throw new Error("Choose a price from " + formatUnits(settings.min_price, decimals) + " to " + formatUnits(settings.max_price, decimals) + " " + symbol + ".");
          }
          const op = await encode("editions", "set_book_price", { opener: currentAddress(), story_id: id, token, price: value.toString() });
          if (await send([op], priceStatus)) renderPage();
        } catch (error) {
          failure(priceStatus, error);
        } finally {
          save.disabled = false;
        }
      });
      parts.push(h("details", { class: "edit-note" }, [
        h("summary", {}, ["Choose the Collector's Edition price"]),
        h("p", { class: "meta small" }, ["Any price from " + formatUnits(settings.min_price, decimals) + " to " + formatUnits(settings.max_price, decimals) + " " + symbol + ". The usual price is " + formatUnits(settings.default_price, decimals) + " " + symbol + "."]),
        field("Price (" + symbol + ")", input),
        h("div", { class: "row" }, [save]),
        priceStatus,
      ]));
    }
  }

  if (!parts.length) parts.push(h("p", { class: "meta small" }, ["Editions of this book aren't available yet."]));
  replace(body, ...parts);
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}
