/**
 * Open a story (book or short story).
 */
import { contracts } from "../config.js";
import { encode, quoteCost } from "../chain.js";
import { assessOpen } from "../lib/rules.js";
import { checkStoryText, inkCost, normalizePasted } from "../lib/text.js";
import { append, h, replace } from "../ui/dom.js";
import { currentAddress, state } from "../app/state.js";
import { num } from "../app/format.js";
import { paymentBlock, tokenAmount } from "../app/payment.js";
import { minContribution, termsVersion } from "../app/story.js";
import { aiToggle, citationField, connectButton, failure, field, loadingLine, notice, problemsNotice, rightsBox, setMeta, statusBox, walletNote } from "../app/ui.js";
import { loadLibrary, newestOpenedStory, refreshAccount, reloadOverview } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

const OPEN_KINDS = {
  short: { kind: 2, name: "short story", title: "Open a short story", min: 10000, max: 99999, priceKey: "shortPrice", starterKey: "starter_short",
    blurb: "10,000 to 99,999 characters. Quick to fill, good for a first story." },
  book: { kind: 1, name: "book", title: "Open a book", min: 100000, max: 1000000, priceKey: "bookPrice", starterKey: "starter_book",
    blurb: "100,000 to 1,000,000 characters. A long project with many chapters and writers." },
};

export function renderOpen(page) {
  const kindInfo = OPEN_KINDS[state.openKind] || OPEN_KINDS.short;
  setMeta("Open a story", "Start a new collaborative book or short story on SwarmTales and invite others to write the next part.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container, 
    h("p", { class: "eyebrow" }, ["Start something"]),
    h("h1", { class: "title" }, ["Open a story"]),
    h("p", { class: "lede" }, ["Give it a title and a first part. Then other writers take it from there."])
  );
  const kindPicker = h("div", { class: "kind-picker", role: "group", "aria-label": "What are you opening?" },
    Object.entries(OPEN_KINDS).map(([key, info]) => h("button", {
      type: "button",
      class: "kind-choice",
      "aria-pressed": String(info === kindInfo),
      onClick: () => { if (state.openKind !== key) { state.openKind = key; renderPage(); } },
    }, [h("b", {}, [info.name.charAt(0).toUpperCase() + info.name.slice(1)]), h("span", {}, [info.blurb])])));
  append(container, kindPicker);
  const body = h("div", { class: "split" });
  body.style.alignItems = "flex-start";
  body.style.marginTop = "40px";
  append(container, body);

  if (!state.overview) {
    append(body, loadingLine(state.chainError ? "Prices will appear when the network answers." : "Reading prices…"));
    return;
  }
  const multiplier = state.account && state.account.openMultiplier ? state.account.openMultiplier : 1;
  const basePrice = BigInt(state.overview[kindInfo.priceKey] || "0");
  const fullPrice = Number(state.overview.storiesCfg.full_price_projects || 3);
  const ceiling = Number(state.overview.storiesCfg.max_price_multiplier || 4);
  const facts = h("div", { class: "card" }, [
    h("h2", { class: "h3" }, ["What opening includes"]),
    h("dl", { class: "facts" }, [
      h("div", {}, [h("dt", {}, ["Price"]), h("dd", {}, [
        tokenAmount((basePrice * BigInt(multiplier)).toString()),
        multiplier > 1 ? h("span", { class: "meta" }, [" (" + multiplier + "× the normal " + tokenAmount(basePrice.toString()) + ")"]) : null,
      ])]),
      h("div", {}, [h("dt", {}, ["Starter Ink"]), h("dd", {}, [num(state.overview.shopCfg[kindInfo.starterKey]) + " Ink, or nothing is charged"])]),
      h("div", {}, [h("dt", {}, ["Length"]), h("dd", {}, ["No fixed length. It can be finished once it reaches " + num(kindInfo.min) + " characters, and it can grow to " + num(kindInfo.max) + "."])]),
    ]),
    h("p", { class: "body-2 small" }, [
      "Your first " + fullPrice + " open projects cost the normal price. Each one after that doubles it, up to " + ceiling +
        "× the normal price. Finishing or archiving a story frees its slot.",
    ]),
    h("p", { class: "body-2 small" }, [
      "One confirmation in your wallet does two things: it lets the Shop take exactly the price above, then opens the story. The starter Ink pays for your first part. If the price went up or the starter Ink went down since this page loaded, nothing happens and nothing is charged.",
    ]),
    h("p", { class: "body-2 small" }, ["Private only limits who can write. The words are still public on the blockchain."]),
  ]);
  const formSlot = h("div", { class: "card card-lg" });
  append(body, formSlot, facts);
  const factParas = facts.querySelectorAll("p");
  factParas.forEach((p) => { p.style.marginTop = "16px"; });

  const address = currentAddress();
  if (!address) {
    append(formSlot, h("h2", { class: "h3" }, ["Connect a wallet to begin"]), h("p", { class: "body-2" }, ["Opening a story is signed by your wallet. Nothing is sent until you confirm."]), connectButton());
    return;
  }
  if (!state.account) {
    append(formSlot, state.accountError ? notice("bad", h("p", {}, [state.accountError])) : loadingLine("Reading your balance…"));
    return;
  }
  const blocked = paymentBlock();
  if (blocked) {
    append(formSlot, h("h2", { class: "h3" }, ["Opening is paid in " + contracts.paymentSymbol]), blocked);
    return;
  }
  const title = h("input", { type: "text", maxlength: "100", required: true, autocomplete: "off" });
  const categories = state.overview.categories.filter((item) => item.active);
  const cat1 = h("select", {}, [h("option", { value: "" }, ["Choose one"]), ...categories.map((item) => h("option", { value: String(item.id) }, [item.name]))]);
  const cat2 = h("select", {}, [h("option", { value: "0" }, ["None"]), ...categories.map((item) => h("option", { value: String(item.id) }, [item.name]))]);
  const visibility = h("select", {}, [
    h("option", { value: "1" }, ["Public: listed, anyone can write"]),
    h("option", { value: "3" }, ["Private: not listed, invited writers only"]),
  ]);
  const free = h("select", {}, [
    h("option", { value: "0" }, ["None: members only"]),
    h("option", { value: "1", selected: true }, ["The first chapter (recommended)"]),
    h("option", { value: "2" }, ["The first 2 chapters"]),
    h("option", { value: "3" }, ["The first 3 chapters"]),
    h("option", { value: "4" }, ["The first 4 chapters"]),
    h("option", { value: "5" }, ["The first 5 chapters"]),
  ]);
  const edition = h("input", { type: "number", min: "0", value: "1000", step: "1", inputmode: "numeric" });
  const pool = h("input", { type: "number", min: String(kindInfo.min), value: String(kindInfo.min), step: "1", inputmode: "numeric" });
  const poolNote = h("p", { class: "meta" });
  const poolField = field("Writers' pool (Ink)", pool,
    "Private stories are invite-only. You set Ink aside for the writers you invite: their parts are paid from this pool, " +
      "so they don't spend their own Ink while it lasts. At least " + num(kindInfo.min) + " Ink, enough for the story to reach the length where it can be finished. " +
      "You can add more later, and whatever is left comes back to you when the story is finished or archived. " +
      "Invited writers also need an active Writer month; you can give them one from the story's Share & invite panel.");
  const poolBox = h("div", { hidden: true }, [poolField, poolNote]);
  const opening = h("textarea", { rows: "8", spellcheck: "true" });
  const costLine = h("p", { class: "counter" }, ["0 Ink"]);
  const openRights = rightsBox();
  const openCitation = citationField();
  opening.addEventListener("paste", () => setTimeout(() => {
    const tidy = normalizePasted(opening.value);
    if (tidy !== opening.value) {
      opening.value = tidy;
      opening.dispatchEvent(new Event("input"));
    }
  }, 0));
  const refreshPool = () => {
    const invite = visibility.value !== "1";
    poolBox.hidden = !invite;
    const first = opening.value && checkStoryText(opening.value, true).ok ? inkCost(opening.value) : 0;
    const fund = invite ? Number(pool.value || 0) : 0;
    const have = Number(state.account.ink || 0) + Number(state.overview.shopCfg[kindInfo.starterKey] || 0);
    poolNote.textContent = invite
      ? "Ink needed: " + num(first) + " for the first part + " + num(fund) + " for the pool = " + num(first + fund) +
        ". You have " + num(state.account.ink) + ", plus " + num(state.overview.shopCfg[kindInfo.starterKey]) + " starter Ink with this open" +
        (first + fund > have ? ". Buy an Ink pack on the Membership page first." : ".")
      : "";
  };
  opening.addEventListener("input", () => {
    const check = checkStoryText(opening.value, true);
    costLine.textContent = !opening.value ? "0 Ink" : check.ok ? num(inkCost(opening.value)) + " Ink, paid from your starter Ink" : check.reason;
    refreshPool();
  });
  visibility.addEventListener("change", refreshPool);
  pool.addEventListener("input", refreshPool);
  const aiBox = aiToggle();
  const ai = aiBox.input;
  const list = h("div");
  const status = statusBox();
  const button = h("button", { type: "submit", class: "btn btn-primary" }, ["Open the " + kindInfo.name]);

  append(formSlot, h("form", { onSubmit: (event) => { event.preventDefault(); go(); } }, [
    field("Title", title),
    h("div", { class: "form-grid" }, [
      field("Category", cat1),
      field("Second category", cat2, "Optional"),
      field("Who can write", visibility),
    ]),
    poolBox,
    field("The first part", opening, "At least " + (Number(minContribution()) || 1) + " characters. Readers see this first."),
    costLine,
    aiBox.node,
    openCitation.node,
    openRights.node,
    h("details", { class: "more-options" }, [
      h("summary", {}, ["Reading preview and keepsake copies (optional)"]),
      h("p", { class: "meta" }, ["You can leave these as they are. Both are saved with the story now and take effect when memberships and finished books launch."]),
      field("Free preview for visitors", free,
        "How many chapters someone without a membership can read before being asked to join. Writers and members can always read everything. While SwarmTales is in testing, every story is free to read."),
      field("Words needed for a keepsake copy", edition,
        "When the story is finished, every writer with at least this many characters in the final version gets a free Contributor Edition: a keepsake copy of the book with their name in the credits. 1,000 characters is about a long paragraph. Enter 0 to give one to every writer."),
    ]),
    list,
    h("div", { class: "actions" }, [button, h("p", { class: "meta" }, ["You hold " + tokenAmount(state.account.token) + "."])]),
    walletNote(),
    status,
  ]));

  async function go() {
    list.replaceChildren();
    status.replaceChildren();
    button.disabled = true;
    try {
      opening.value = normalizePasted(opening.value).trim();
      const plan = assessOpen({
        title: title.value,
        openingText: opening.value,
        maxChars: "0",
        fund: pool.value,
        multiplier,
        category1: cat1.value,
        category2: cat2.value,
        visibility: visibility.value,
        freeChapters: Number(free.value),
        editionMin: edition.value,
        cap: state.overview.storiesCfg.contribution_cap,
        inkBalance: state.account.ink,
        starter: state.overview.shopCfg[kindInfo.starterKey] || "0",
        kind: kindInfo.kind,
        openCount: state.account.openCount,
        openLimit: state.overview.storiesCfg.open_limit,
        price: state.overview[kindInfo.priceKey],
        tokenBalance: state.account.token,
        minContribution: minContribution(),
        rightsConfirmed: openRights.input.checked,
        blocked: state.account.blocked,
      });
      if (!plan.ok) {
        append(list, problemsNotice(plan.problems));
        return;
      }
      status.textContent = "Checking the Ink count with the story contract…";
      const quoted = await quoteCost(opening.value);
      if (quoted !== plan.cost) {
        replace(status, notice("warn", h("p", {}, ["The network counted " + quoted + " Ink and this page counted " + plan.cost + ". Nothing was signed."])));
        return;
      }
      const nextId = String(state.overview.storiesCfg.next_story_id || "");
      // The starter Ink the page showed: if the Shop would now mint less, the
      // whole open fails and nothing is charged (M-2).
      const starterInk = String(state.overview.shopCfg[kindInfo.starterKey] || "0");
      const approve = await encode("token", "approve", { owner: address, spender: contracts.shop, value: plan.price });
      const open = await encode("stories", "open_story", {
        opener: address,
        kind: kindInfo.kind,
        title: title.value,
        max_chars: "0",
        category_1: Number(cat1.value),
        category_2: Number(cat2.value || 0),
        visibility: Number(visibility.value),
        free_chapters: Number(free.value),
        contributor_edition_min: String(edition.value || "0"),
        opening_text: opening.value,
        ai_assisted: ai.checked,
        expected_ink: plan.cost,
        token: contracts.paymentToken,
        rights_confirmed: true,
        terms_version: termsVersion(),
        fund: plan.fund,
        citation: openCitation.value(),
        max_price: plan.price,   // the price shown and approved: Shop charges no more (AB-017)
        min_ink: starterInk,     // the starter Ink shown: Shop mints no less (M-2)
      });
      const sent = await send([approve, open], status);
      if (sent) {
        await refreshAccount();
        await reloadOverview();
        loadLibrary(true).catch(() => {});
        const newest = await newestOpenedStory(address).catch(() => "");
        const target = newest || (Number(nextId) > 0 ? nextId : "");
        append(status, notice("ok", h("p", {}, [
          "Your story is open. ",
          target ? "Taking you there…" : h("a", { href: "#/mine" }, ["Find it under My stories"]),
        ])));
        if (target) setTimeout(() => { location.hash = "#/stories/" + target + "?new=1"; }, 1200);
      }
    } catch (error) {
      failure(status, error);
    } finally {
      button.disabled = false;
    }
  }
}
