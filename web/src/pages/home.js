/**
 * Home page and the connected wallet's desk.
 */
import { contracts } from "../config.js";
import { explainFailure } from "../lib/errors.js";
import { KIND, label, TIER } from "../lib/labels.js";
import { formatMana, formatUtc, shortAddress } from "../lib/money.js";
import { isActiveWriter } from "../lib/rules.js";
import { append, h, icons, replace } from "../ui/dom.js";
import { currentAddress, state, walletName } from "../app/state.js";
import { clip, num } from "../app/format.js";
import { tokenAmount } from "../app/payment.js";
import { charsLine, progressBar, storyCategories } from "../app/story.js";
import { loadingLine, notice, setMeta, stat } from "../app/ui.js";
import { firstLine, loadLibrary } from "../app/data.js";
import { pickFeatured, storyCard } from "./discover.js";

export function renderHome(page) {
  setMeta("", "SwarmTales is collaborative fiction: read a chapter, then write the next part. Reading is free. Every contribution is credited on the Koinos blockchain.");
  const featuredSlot = h("div", { class: "card card-lg" }, [loadingLine("Finding a story being written now…")]);
  const gridSlot = h("div", { class: "card-grid" }, [loadingLine("Reading the shelves…")]);

  append(page,     h("section", { class: "container", style: null }, [
      h("div", { class: "split section", "aria-labelledby": "home-title" }, [
        h("div", { class: "stack" }, [
          h("p", { class: "eyebrow" }, ["Collaborative fiction"]),
          h("h1", { class: "display", id: "home-title" }, ["Stories written by many hands."]),
          h("p", { class: "lede" }, [
            "Read a chapter, then write the next part. Every page is a little different because a different person wrote it. When a story is full, it becomes a finished book with everyone's name in the credits.",
          ]),
          h("div", { class: "row" }, [
            h("a", { class: "btn btn-primary", href: "#/stories" }, ["Start reading"]),
            h("a", { class: "btn btn-secondary", href: "#/how" }, ["How it works"]),
          ]),
        ]),
        featuredSlot,
      ]),
    ]),
    accountDesk(),
    h("section", { class: "section section-surface", "aria-labelledby": "how-title" }, [
      h("div", { class: "container" }, [
        h("h2", { class: "h2", id: "how-title" }, ["How a story gets written"]),
        h("p", { class: "lede" }, ["Three steps. No account to create, no password to remember."]),
        h("ol", { class: "how-grid" }, [
          h("li", {}, [icons.book(), h("h3", { class: "h3" }, ["1. Read"]), h("p", {}, ["Open any story and read it like a book. Reading is free for everyone, with or without a wallet."])]),
          h("li", {}, [icons.pen(), h("h3", { class: "h3" }, ["2. Write the next part"]), h("p", {}, ["Writing uses Ink, your writing allowance. One letter costs one Ink. Get Ink free from a promo link, or with a Writer membership."])]),
          h("li", {}, [icons.hive(), h("h3", { class: "h3" }, ["3. Finish it together"]), h("p", {}, ["When the story is full, it gets a final polish and becomes a finished book. Every writer is named in the credits, and the record can't be rewritten."])]),
        ]),
      ]),
    ]),
    h("section", { class: "section", "aria-labelledby": "now-title" }, [
      h("div", { class: "container" }, [
        h("div", { class: "spread" }, [
          h("h2", { class: "h2", id: "now-title" }, ["Being written now"]),
          h("a", { class: "link-arrow", href: "#/stories" }, ["See all stories", icons.arrow()]),
        ]),
        h("div", { style: null }, [gridSlot]),
      ]),
    ]),
    h("section", { class: "section section-dark", "aria-labelledby": "record-title" }, [
      h("div", { class: "container" }, [
        h("h2", { class: "h2", id: "record-title" }, ["Your words, on the record"]),
        h("div", { class: "trust-grid", style: null }, [
          h("p", {}, ["Every contribution is recorded publicly on the Koinos blockchain, so credits can't be quietly changed later. If an editor tidies your text, the part says so and credit stays with you."]),
          h("p", {}, ["You sign in with a wallet instead of a password. Reading is free. Writing needs Ink, from a free promo link, an invite, or a Writer membership."]),
          h("p", {}, ["Ink is a writing allowance for SwarmTales. It has no cash value and can't be sold, sent, or traded. SwarmTales is for creative fun, not investment."]),
        ]),
      ]),
    ])
  );
  gridSlot.parentElement.style.marginTop = "32px";
  const trust = page.querySelector(".trust-grid");
  if (trust) trust.style.marginTop = "32px";

  if (!state.overview) {
    const text = state.chainError ? "Stories will appear when the network answers." : "Connecting to the story network…";
    replace(featuredSlot, loadingLine(text));
    replace(gridSlot, loadingLine(text));
    return;
  }
  loadLibrary().then(async (library) => {
    const rows = pickFeatured(library ? library.stories : []);
    if (!rows.length) {
      replace(featuredSlot, 
        h("p", { class: "eyebrow muted" }, ["The shelves are empty"]),
        h("p", { class: "excerpt" }, ["No public story has been opened yet. Yours could be the first."]),
        h("div", { class: "row" }, [h("a", { class: "btn btn-primary", href: "#/open" }, ["Open a story"])])
      );
      replace(gridSlot, h("div", { class: "empty" }, [h("p", { class: "serif" }, ["Nothing here yet."]), h("p", { class: "meta" }, ["Open the first story and invite others to write the next part."])]));
      return;
    }
    const top = rows[0];
    const text = await firstLine(top.id);
    replace(featuredSlot, 
      h("p", { class: "eyebrow" }, ["Being written now"]),
      h("p", { class: "meta" }, [[storyCategories(top.story)[0], label(KIND, top.story.kind)].filter(Boolean).join(" · ")]),
      h("h2", { class: "h2" }, [top.story.title || "Untitled"]),
      h("p", { class: "excerpt" }, [clip(text, 260)]),
      progressBar(top.story, charsLine(top.story)),
      h("a", { class: "btn btn-primary btn-block", href: "#/stories/" + top.id }, ["Read from the start"])
    );
    for (const child of Array.from(featuredSlot.children).slice(1)) child.style.marginTop = "14px";
    replace(gridSlot, ...rows.slice(0, 6).map((row) => storyCard(row)));
  }).catch((error) => {
    replace(featuredSlot, notice("bad", h("p", {}, [explainFailure(error)])));
    gridSlot.replaceChildren();
  });
}

function accountDesk() {
  const address = currentAddress();
  if (!address) return null;
  const wrap = h("section", { class: "container", "aria-label": "Your wallet" });
  const card = h("div", { class: "card desk" });
  append(wrap, card);
  if (state.accountError) {
    append(card, notice("bad", h("p", {}, [state.accountError])));
    return wrap;
  }
  if (!state.account) {
    append(card, loadingLine("Reading your Ink and membership…"));
    return wrap;
  }
  const account = state.account;
  const membership = account.membership || {};
  const writer = isActiveWriter(membership, account.now);
  const until = formatUtc(membership.paid_until || "0");
  append(card, 
    h("div", {}, [h("p", { class: "eyebrow muted" }, ["Your desk"]), h("p", { class: "meta mono" }, [walletName() + " · " + shortAddress(address)])]),
    h("dl", { class: "stats" }, [
      stat("Ink", num(account.ink)),
      stat("Membership", writer ? "Writer" + (until ? ", until " + until.split(",")[0] : "") : label(TIER, membership.tier)),
      stat("Mana", formatMana(account.mana)),
      stat(contracts.paymentSymbol, tokenAmount(account.token).split(" ")[0]),
    ]),
    h("a", { class: "btn btn-secondary btn-small", href: "#/membership" }, ["Membership and Ink"])
  );
  return wrap;
}
