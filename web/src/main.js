import { contracts, configProblems, network } from "./config.js";
import {
  encode,
  listStories,
  loadAccount,
  loadOverview,
  loadStory,
  lookupTransaction,
  quoteCost,
  verifyChain,
  writerFlags,
} from "./chain.js";
import { explainFailure } from "./lib/errors.js";
import { KIND, STORY_STATUS, TIER, VISIBILITY, label } from "./lib/labels.js";
import { VAULT_MANA_CEILING, formatMana, formatUnits, formatUtc, kondorManaNote, shortAddress } from "./lib/money.js";
import { assessOpen, assessPromo, assessWrite, assessWriterBuy, isActiveWriter } from "./lib/rules.js";
import { checkStoryText, costNote } from "./lib/text.js";
import {
  KONDOR_HINT,
  VAULT_MANA_EXPLANATION,
  clearSavedSession,
  createKondorWallet,
  createVaultWallet,
  loadSavedSession,
} from "./wallet.js";
import { fetchVaultConfig, vaultManaDecision, vaultPairingDecision } from "./lib/vaultApi.js";
import { linkSecretFromHash, signPromoClaim, signInviteJoin } from "./lib/links.js";

const problems = configProblems();
const kondor = createKondorWallet();
const vault = createVaultWallet(network);

const state = {
  overview: null,
  chainError: problems.length ? problems.join(" ") : "",
  account: null,
  accountError: "",
  wallet: null,
  vaultInfo: null,
  vaultKey: "",
  notice: "",
};

const dialog = document.createElement("dialog");
dialog.className = "sheet";
dialog.setAttribute("aria-label", "Wallet");

function h(tag, attrs, children) {
  const node = document.createElement(tag);
  const props = attrs || {};
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : children == null ? [] : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const path = raw.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "stories" && parts[1] && /^[1-9][0-9]*$/.test(parts[1])) return { name: "story", id: parts[1] };
  if (parts[0] === "stories") return { name: "stories" };
  if (parts[0] === "open") return { name: "open" };
  if (parts[0] === "shop") return { name: "shop" };
  if (parts[0] === "promo" && parts[1] && /^[1-9][0-9]*$/.test(parts[1])) return { name: "shop", campaign: parts[1] };
  if (parts[0] === "join" && parts[1] && parts[2] && /^[1-9][0-9]*$/.test(parts[1]) && /^[1-9][0-9]*$/.test(parts[2])) {
    return { name: "join", storyId: parts[1], inviteId: parts[2] };
  }
  return { name: "home" };
}

function currentAddress() {
  return state.wallet && state.wallet.getAddress ? state.wallet.getAddress() : null;
}

function tokenAmount(base) {
  return formatUnits(base || "0", contracts.paymentDecimals) + " " + contracts.paymentSymbol;
}

function inkAmount(base) {
  return (base || "0") + " Ink";
}

function categoryName(id) {
  const n = Number(id || 0);
  if (!n || !state.overview) return n ? "Category " + n : "";
  const found = state.overview.categories.find((item) => item.id === n);
  return found ? found.name : "Category " + n;
}

function field(labelText, control) {
  return h("label", { class: "field" }, [labelText, control]);
}

function problemsList(items) {
  if (!items || !items.length) return null;
  return h("ul", { class: "problems" }, items.map((item) => h("li", {}, [item])));
}

function statusBox() {
  return h("div", { class: "hint", role: "status", "aria-live": "polite" });
}

function inkEditor(onText) {
  const area = h("textarea", { rows: "8", spellcheck: "true" });
  const meter = h("p", { class: "meter" }, ["0 Ink. The count updates as you type."]);
  area.addEventListener("input", () => {
    const text = area.value;
    const check = checkStoryText(text, true);
    meter.textContent = check.ok ? costNote(text) : check.reason;
    if (onText) onText(text, check);
  });
  return { area, meter, value: () => area.value };
}

async function refreshAccount() {
  const address = currentAddress();
  state.account = null;
  state.accountError = "";
  renderChip();
  if (!address) return;
  try {
    state.account = await loadAccount(address);
  } catch (error) {
    state.accountError = explainFailure(error);
  }
  renderChip();
}

function renderChip() {
  const slot = document.getElementById("chip");
  if (!slot) return;
  slot.replaceChildren();
  const address = currentAddress();
  if (!address) {
    slot.append(h("button", { type: "button", onClick: openWallet }, ["Connect a wallet"]));
    return;
  }
  const kind = state.wallet.id === "koinvault" ? "KOIN Vault" : "Kondor";
  slot.append(h("button", { type: "button", class: "ghost", onClick: openWallet }, [kind + " · " + shortAddress(address)]));
}

function renderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const here = route().name;
  const items = [
    ["home", "#/", "Home"],
    ["stories", "#/stories", "Stories"],
    ["open", "#/open", "Open a story"],
    ["shop", "#/shop", "Shop"],
  ];
  nav.replaceChildren(...items.map(([name, href, text]) => {
    const current = (name === "home" && here === "home") || (name !== "home" && here === name) || (name === "stories" && here === "story");
    return h("a", { href, ...(current ? { "aria-current": "page" } : {}) }, [text]);
  }));
}

function walletHint() {
  if (state.wallet && state.wallet.id === "koinvault") return VAULT_MANA_EXPLANATION;
  const extra = state.account ? kondorManaNote(state.account.mana) : "";
  return extra ? extra + " " + KONDOR_HINT : KONDOR_HINT;
}

function boot() {
  const app = document.getElementById("app");
  app.append(
    h("a", { class: "skip", href: "#page" }, ["Skip to content"]),
    h("div", { class: "banner" }, [
      h("p", {}, [network.mainnet ? "Koinos mainnet" : "Koinos testnet"]),
      h("p", {}, [
        network.mainnet
          ? "Mainnet. Real tokens. Ink is still not money: it cannot be sent, sold, or cashed out."
          : "Testnet. The coins here are play money. Ink is a writing allowance with no cash value. It cannot be sent, sold, or traded.",
      ]),
    ]),
    h("div", { class: "wrap" }, [
      h("header", { class: "top" }, [
        h("a", { class: "brand", href: "#/" }, ["SwarmTales", h("small", {}, [network.name + " · no server, no account"])]),
        h("div", { id: "chip" }),
      ]),
      h("nav", { id: "nav", class: "sections", "aria-label": "Sections" }),
      h("main", { id: "page" }),
      h("footer", { class: "colophon" }, [
        h("p", {}, ["This page is static files. It talks to " + network.rpc + " from your browser. You sign with your own wallet. The page never asks for a private key."]),
        h("p", {}, ["Ink ", h("span", { class: "addr" }, [contracts.ink])]),
        h("p", {}, ["Shop ", h("span", { class: "addr" }, [contracts.shop])]),
        h("p", {}, ["Stories ", h("span", { class: "addr" }, [contracts.stories])]),
        h("p", {}, [contracts.paymentSymbol + " ", h("span", { class: "addr" }, [contracts.paymentToken])]),
      ]),
    ]),
    dialog
  );
  window.addEventListener("hashchange", () => {
    renderNav();
    renderPage();
  });
  vault.setListener((info) => {
    state.vaultInfo = info;
    const key = (info.phase || "") + "|" + (info.address || "");
    const changed = key !== state.vaultKey;
    state.vaultKey = key;
    if (changed && info.phase === "connected" && info.address) {
      state.wallet = vault;
      refreshAccount().then(() => renderPage());
    }
    if (info.phase === "ended") {
      if (state.wallet === vault) state.wallet = null;
      state.account = null;
      renderChip();
    }
    const live = document.getElementById("vault-live");
    if (live && info.phase === "degraded") {
      live.textContent = "KOIN Vault is not answering just now. This page will keep the session and try again.";
    }
    if (info.reason && info.phase === "ended") state.notice = info.reason;
    if (dialog.open && changed) renderDialog();
    renderChip();
  });
  renderNav();
  renderChip();
  renderPage();
  start();
}

async function start() {
  if (problems.length) return;
  try {
    await verifyChain();
    state.overview = await loadOverview();
    state.chainError = "";
  } catch (error) {
    state.chainError = explainFailure(error);
  }
  const saved = loadSavedSession();
  if (saved && saved.kind === "kondor") {
    kondor.restore(saved);
    state.wallet = kondor;
  } else if (saved && saved.kind === "koinvault") {
    state.wallet = vault;
    try {
      await vault.restore(saved);
    } catch (error) {
      state.notice = explainFailure(error);
      clearSavedSession();
      state.wallet = null;
    }
    if (!vault.getAddress() && !vault.getPairingUri()) state.wallet = null;
  }
  renderChip();
  if (currentAddress()) await refreshAccount();
  renderPage();
}

function renderPage() {
  const page = document.getElementById("page");
  if (!page) return;
  const here = route();
  page.replaceChildren();
  if (state.chainError) page.append(h("p", { class: "note-bad" }, [state.chainError]));
  if (state.notice) page.append(h("p", { class: "note-warn" }, [state.notice]));
  if (problems.length) page.append(h("p", { class: "note-bad" }, [problems.join(" ")]));
  if (here.name === "stories") renderStories(page);
  else if (here.name === "story") renderStory(page, here.id);
  else if (here.name === "open") renderOpen(page);
  else if (here.name === "shop") renderShop(page, here.campaign);
  else if (here.name === "join") renderJoin(page, here.storyId, here.inviteId);
  else renderHome(page);
  const heading = page.querySelector("h1");
  if (heading) heading.setAttribute("tabindex", "-1");
}

function accountPanel() {
  const address = currentAddress();
  if (!address) {
    return h("div", { class: "panel" }, [
      h("h2", {}, ["Wallet"]),
      h("p", {}, ["Connect Kondor on a computer, or KOIN Vault on a phone, to see balances and to sign."]),
      h("button", { type: "button", onClick: openWallet }, ["Connect a wallet"]),
    ]);
  }
  const box = h("div", { class: "panel" }, [
    h("h2", {}, ["This wallet"]),
    h("p", { class: "addr" }, [address]),
  ]);
  if (state.accountError) box.append(h("p", { class: "note-bad" }, [state.accountError]));
  if (!state.account) {
    box.append(h("p", {}, ["Reading balances…"]));
    return box;
  }
  const account = state.account;
  const membership = account.membership || {};
  const active = isActiveWriter(membership, account.now);
  const until = formatUtc(membership.paid_until || "0");
  box.append(h("div", { class: "stats" }, [
    stat("Address", shortAddress(address)),
    stat(contracts.paymentSymbol, tokenAmount(account.token)),
    stat("Mana", formatMana(account.mana)),
    stat("Ink", inkAmount(account.ink)),
    stat("Membership", label(TIER, membership.tier) + (until ? " until " + until : "") + (Number(membership.tier) === 2 ? (active ? " (active)" : " (ended)") : "")),
    stat("Promo claim", account.promo === "0" ? "Never claimed" : "Claimed campaign " + account.promo),
  ]));
  if (state.wallet && state.wallet.id === "kondor") {
    const note = kondorManaNote(account.mana);
    box.append(h("p", { class: note ? "note-warn" : "hint" }, [note ? note + " " + KONDOR_HINT : KONDOR_HINT]));
  }
  if (state.wallet && state.wallet.id === "koinvault") {
    const decision = vaultManaDecision(account.mana, VAULT_MANA_CEILING);
    box.append(h("p", { class: decision.blocked ? "note-warn" : "hint" }, [decision.blocked ? decision.message : "KOIN Vault can sign from this account. It still sets the mana limit itself."]));
  }
  return box;
}

function stat(name, value) {
  return h("div", { class: "stat" }, [h("b", {}, [name]), h("span", {}, [value])]);
}

function renderHome(page) {
  page.append(
    h("h1", {}, ["Write together, on chain"]),
    h("p", {}, ["SwarmTales is a group story. A Writer month or a promo gives you Ink. Spending Ink adds text to a story. Ink is not a coin. Nobody can transfer it, and it has no cash value."]),
    h("p", {}, ["A normal letter costs 1 Ink. Most emoji cost 2. A skin tone or a flag costs 4. A family emoji costs 8. The number you see before you sign is the number the contract charges."]),
    accountPanel(),
    h("p", {}, [h("a", { href: "#/stories" }, ["Browse stories"]), " · ", h("a", { href: "#/open" }, ["Open a short story"]), " · ", h("a", { href: "#/shop" }, ["Shop"])])
  );
}

function renderStories(page) {
  page.append(h("h1", {}, ["Stories"]));
  page.append(h("p", { class: "hint" }, ["Every story id on the contract is listed, including unlisted ones. Private limits who may write. The text is still public, because anyone can read the chain."]));
  if (!state.overview) {
    page.append(h("p", {}, [state.chainError ? "Stories cannot be loaded until the node answers." : "Reading the chain…"]));
    return;
  }
  const next = state.overview.storiesCfg.next_story_id || "1";
  const holder = h("div", { class: "cards" });
  page.append(holder);
  holder.append(h("p", {}, ["Reading stories…"]));
  listStories(next).then((result) => {
    holder.replaceChildren();
    if (!result.stories.length) {
      holder.append(h("p", {}, ["No stories yet."]));
      return;
    }
    if (result.truncated) holder.append(h("p", { class: "hint" }, ["Showing the first 200 story ids."]));
    for (const row of result.stories) {
      const story = row.story;
      const cats = [categoryName(story.category_1), categoryName(story.category_2)].filter(Boolean).join(" · ");
      holder.append(h("a", { class: "card", href: "#/stories/" + row.id }, [
        h("h2", {}, [story.title || "Untitled"]),
        h("p", { class: "meta" }, [
          label(KIND, story.kind) + " · " + label(STORY_STATUS, story.status) + " · " + label(VISIBILITY, story.visibility),
        ]),
        h("p", { class: "meta" }, [
          (cats || "No category") + " · " + (story.used_chars || "0") + " / " + (story.max_chars || "0") + " characters · " +
            (story.contributor_count || "0") + " contributors",
        ]),
      ]));
    }
  }).catch((error) => {
    holder.replaceChildren(h("p", { class: "note-bad" }, [explainFailure(error)]));
  });
}

function renderStory(page, id) {
  page.dataset.wantsAccount = "1";
  page.append(h("h1", {}, ["Story " + id]));
  const body = h("div");
  page.append(body);
  body.append(h("p", {}, ["Reading the story from the chain…"]));
  loadStory(id).then(async (bundle) => {
    body.replaceChildren();
    const story = bundle.story;
    if (!story || Number(story.status || 0) === 0) {
      body.append(h("p", {}, ["There is no story with this id."]));
      return;
    }
    const cats = [categoryName(story.category_1), categoryName(story.category_2)].filter(Boolean).join(" and ");
    body.append(h("h2", {}, [story.title || "Untitled"]));
    body.append(h("div", { class: "stats" }, [
      stat("Kind", label(KIND, story.kind)),
      stat("Status", label(STORY_STATUS, story.status)),
      stat("Who can write", label(VISIBILITY, story.visibility)),
      stat("Category", cats || "None"),
      stat("Characters", (story.used_chars || "0") + " of " + (story.max_chars || "0")),
      stat("Contributors", String(story.contributor_count || "0")),
      stat("Opener", story.opener || ""),
    ]));
    if (Number(story.visibility) === 3) {
      body.append(h("p", { class: "hint" }, ["Private means only certain wallets may add text. The text below is still stored in public contract data."]));
    }
    const active = [];
    const removed = [];
    bundle.segments.forEach((segment, index) => {
      const block = { segment, index: index + 1 };
      if (Number(segment.status) === 2) removed.push(block);
      else active.push(block);
    });
    body.append(h("h2", {}, ["The story"]));
    if (!active.length) body.append(h("p", {}, ["No active text is stored for this story."]));
    for (const block of active) body.append(segmentBlock(block));
    if (removed.length) {
      const details = h("details", {}, [h("summary", {}, [removed.length + " removed segment" + (removed.length === 1 ? "" : "s")])]);
      for (const block of removed) details.append(segmentBlock(block));
      body.append(details);
    }
    body.append(h("p", { class: "hint" }, ["Each block is one segment, in order. The words are the text stored on the chain. Up to 10 segments are read at a time; this page walks the whole list."]));
    body.append(writePanel(id, story));
  }).catch((error) => {
    body.replaceChildren(h("p", { class: "note-bad" }, [explainFailure(error)]));
  });
}

function segmentBlock(block) {
  const segment = block.segment;
  const removed = Number(segment.status) === 2;
  return h("article", {}, [
    h("p", { class: "byline" }, [
      "Segment " + block.index + " · " + (segment.author || "unknown") + " · " + (segment.current_cost || segment.charged || "0") + " Ink" +
        (removed ? " · removed" : "") + (segment.ai_assisted ? " · marked as written with AI help" : ""),
    ]),
    h("div", { class: "story-text" }, [segment.text || ""]),
  ]);
}

function writePanel(id, story) {
  const panel = h("div", { class: "panel" }, [h("h2", {}, ["Add to this story"])]);
  const address = currentAddress();
  if (!address) {
    panel.append(h("p", {}, ["Connect a wallet to write."]));
    panel.append(h("button", { type: "button", onClick: openWallet }, ["Connect a wallet"]));
    return panel;
  }
  if (!state.account || !state.overview) {
    panel.append(h("p", {}, ["Waiting for your Ink balance and the story rules…"]));
    return panel;
  }
  const editor = inkEditor();
  const chapter = h("input", { type: "checkbox" });
  const ai = h("input", { type: "checkbox" });
  const list = h("div");
  const status = statusBox();
  const button = h("button", { type: "button" }, ["Check, then sign"]);
  panel.append(
    h("p", { class: "hint" }, ["The opener of a story can write without a Writer month. Everyone else needs an active Writer month, or a promo claim with trial characters left."]),
    field("Your text", editor.area),
    editor.meter,
    h("label", { class: "check" }, [chapter, "Start a new chapter"]),
    h("label", { class: "check" }, [ai, "Mark this as written with AI help"]),
    list,
    h("p", { class: "hint" }, [walletHint()]),
    h("div", { class: "row" }, [button, h("button", { type: "button", class: "secondary", onClick: () => runQuote(false) }, ["Check with the chain"])]),
    status
  );

  async function context() {
    const flags = await writerFlags(id, address);
    const privileged = story.opener === address || flags.editor;
    return assessWrite({
      text: editor.value(),
      cap: state.overview.storiesCfg.contribution_cap,
      maxChars: story.max_chars,
      usedChars: story.used_chars || "0",
      balance: state.account.ink,
      status: story.status,
      visibility: story.visibility,
      privileged,
      allowed: flags.allowed,
      writerActive: isActiveWriter(state.account.membership, state.account.now),
      promoClaimed: state.account.promo !== "0",
      trialUsed: state.account.trial,
      trialLimit: state.overview.storiesCfg.trial_limit,
    });
  }

  async function runQuote(andSign) {
    list.replaceChildren();
    status.replaceChildren();
    button.disabled = true;
    try {
      const plan = await context();
      const cap = state.overview.storiesCfg.contribution_cap;
      const space = plan.spaceLeft;
      list.append(h("p", {}, [
        "Cost " + plan.cost + " Ink. Balance " + state.account.ink + ". Cap " + cap + ". Space left " + space + ".",
        plan.usesTrial ? " This would use trial characters." : "",
      ]));
      if (!plan.ok) {
        list.append(problemsList(plan.problems));
        return;
      }
      status.textContent = "Asking the contract what this text costs…";
      let quoted;
      try {
        quoted = await quoteCost(editor.value());
      } catch (error) {
        status.replaceChildren(h("span", { class: "note-bad" }, [explainFailure(error)]));
        return;
      }
      if (quoted !== plan.cost) {
        status.textContent = "The chain counted " + quoted + " Ink and this page counted " + plan.cost + ". Nothing was signed.";
        return;
      }
      status.textContent = "The chain agrees: " + quoted + " Ink.";
      if (!andSign) return;
      const op = await encode("stories", "contribute", {
        author: address,
        story_id: String(id),
        text: editor.value(),
        starts_chapter: chapter.checked,
        ai_assisted: ai.checked,
        expected_ink: plan.cost,
      });
      const sent = await send([op], status);
      if (sent) {
        editor.area.value = "";
        editor.meter.textContent = "Sent. Reading the story again…";
        await refreshAccount();
        renderPage();
      }
    } catch (error) {
      status.replaceChildren(h("span", { class: "note-bad" }, [explainFailure(error)]));
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener("click", () => runQuote(true));
  return panel;
}

function renderOpen(page) {
  page.dataset.wantsAccount = "1";
  page.append(h("h1", {}, ["Open a short story"]), h("p", {}, [
    "This is the same two steps as the testnet open: approve the Shop to spend the open price in " + contracts.paymentSymbol + ", then open the story. Both steps are one signature. The Shop mints starter Ink, and the opening text spends some of it.",
  ]));
  if (!state.overview) {
    page.append(h("p", {}, [state.chainError ? "The Shop prices cannot be loaded yet." : "Reading prices…"]));
    return;
  }
  const address = currentAddress();
  page.append(h("p", {}, ["Open price: " + tokenAmount(state.overview.shortPrice) + ". Starter Ink: " + (state.overview.shopCfg.starter_short || "0") + "."]));
  if (!address) {
    page.append(h("button", { type: "button", onClick: openWallet }, ["Connect a wallet"]));
    return;
  }
  if (!state.account) {
    page.append(h("p", {}, ["Reading your balance…"]));
    return;
  }
  const title = h("input", { type: "text", maxlength: "100", required: "true" });
  const length = h("input", { type: "number", min: "10000", max: "99999", value: "10000", inputmode: "numeric" });
  const categories = state.overview.categories.filter((item) => item.active);
  const cat1 = h("select", {}, [h("option", { value: "" }, ["Choose"]), ...categories.map((item) => h("option", { value: String(item.id) }, [item.name]))]);
  const cat2 = h("select", {}, [h("option", { value: "0" }, ["None"]), ...categories.map((item) => h("option", { value: String(item.id) }, [item.name]))]);
  const visibility = h("select", {}, [
    h("option", { value: "1" }, ["Public — listed, anyone eligible may write"]),
    h("option", { value: "2" }, ["Unlisted — hidden from a gallery, anyone eligible may write"]),
    h("option", { value: "3" }, ["Private — only you, editors, and invited wallets may write"]),
  ]);
  const free = h("input", { type: "number", min: "0", max: "5", value: "0", inputmode: "numeric" });
  const edition = h("input", { type: "number", min: "0", value: "0", inputmode: "numeric" });
  const editor = inkEditor();
  const ai = h("input", { type: "checkbox" });
  const list = h("div");
  const status = statusBox();
  const button = h("button", { type: "button" }, ["Open short story"]);
  page.append(h("form", { class: "panel", onSubmit: (event) => { event.preventDefault(); go(); } }, [
    field("Title", title),
    field("Length in characters (10,000 to 99,999)", length),
    field("Category", cat1),
    field("Second category, optional", cat2),
    field("Who can write", visibility),
    field("Free chapters (0 to 5)", free),
    field("Contributor Edition minimum, in characters", edition),
    field("Opening text", editor.area),
    editor.meter,
    h("label", { class: "check" }, [ai, "Mark the opening text as written with AI help"]),
    list,
    h("p", { class: "hint" }, [walletHint()]),
    h("div", { class: "row" }, [button]),
    status,
  ]));

  async function go() {
    list.replaceChildren();
    status.replaceChildren();
    button.disabled = true;
    try {
      const plan = assessOpen({
        title: title.value,
        openingText: editor.value(),
        maxChars: length.value,
        category1: cat1.value,
        category2: cat2.value,
        visibility: visibility.value,
        freeChapters: Number(free.value),
        editionMin: edition.value,
        cap: state.overview.storiesCfg.contribution_cap,
        inkBalance: state.account.ink,
        starter: state.overview.shopCfg.starter_short || "0",
        openCount: state.account.openCount,
        openLimit: state.overview.storiesCfg.open_limit,
        price: state.overview.shortPrice,
        tokenBalance: state.account.token,
      });
      if (!plan.ok) {
        list.append(problemsList(plan.problems));
        return;
      }
      status.textContent = "Asking the contract what the opening text costs…";
      const quoted = await quoteCost(editor.value());
      if (quoted !== plan.cost) {
        status.textContent = "The chain counted " + quoted + " Ink and this page counted " + plan.cost + ". Nothing was signed.";
        return;
      }
      const approve = await encode("token", "approve", { owner: address, spender: contracts.shop, value: plan.price });
      const open = await encode("stories", "open_story", {
        opener: address,
        kind: 2,
        title: title.value,
        max_chars: String(length.value),
        category_1: Number(cat1.value),
        category_2: Number(cat2.value || 0),
        visibility: Number(visibility.value),
        free_chapters: Number(free.value),
        contributor_edition_min: String(edition.value || "0"),
        opening_text: editor.value(),
        ai_assisted: ai.checked,
        expected_ink: plan.cost,
        token: contracts.paymentToken,
      });
      const sent = await send([approve, open], status);
      if (sent) {
        status.append(h("p", {}, ["Opened. Look at Stories for the new id. The id is one less than the next-story counter after the chain includes it."]));
        await refreshAccount();
      }
    } catch (error) {
      status.replaceChildren(h("span", { class: "note-bad" }, [explainFailure(error)]));
    } finally {
      button.disabled = false;
    }
  }
}

function renderShop(page, campaignFromLink) {
  page.dataset.wantsAccount = "1";
  page.append(
    h("h1", {}, ["Shop"]),
    h("p", {}, ["Buy one Writer month, or claim a promo from a link you were given. The first month of a new Writer term mints Ink in the same transaction. A wallet can claim a promo once, ever. There is no admin screen here."])
  );
  if (!state.overview) {
    page.append(h("p", {}, [state.chainError ? "Prices cannot be loaded yet." : "Reading the Shop…"]));
    return;
  }
  const cfg = state.overview.shopCfg;
  page.append(h("div", { class: "stats" }, [
    stat("Writer month", tokenAmount(state.overview.writerPrice)),
    stat("Ink in a Writer month", String(cfg.writer_ink || "0")),
    stat("Promo switch", cfg.promo_enabled ? "On" : "Off"),
    stat("Shop", cfg.paused ? "Paused" : "Open"),
  ]));
  const address = currentAddress();
  if (!address) {
    page.append(h("button", { type: "button", onClick: openWallet }, ["Connect a wallet"]));
    return;
  }
  if (!state.account) {
    page.append(h("p", {}, ["Reading your balance…"]));
    return;
  }
  const buyStatus = statusBox();
  const buyButton = h("button", { type: "button" }, ["Buy 1 Writer month"]);
  page.append(h("div", { class: "panel" }, [
    h("h2", {}, ["Writer month"]),
    h("p", {}, ["Price " + tokenAmount(state.overview.writerPrice) + ". You hold " + tokenAmount(state.account.token) + ". One signature approves the Shop for that price and buys the month."]),
    h("p", { class: "hint" }, [walletHint()]),
    h("div", { class: "row" }, [buyButton]),
    buyStatus,
  ]));
  buyButton.addEventListener("click", async () => {
    buyStatus.replaceChildren();
    buyButton.disabled = true;
    try {
      const plan = assessWriterBuy({
        price: state.overview.writerPrice,
        balance: state.account.token,
        paused: !!cfg.paused,
      });
      if (!plan.ok) {
        buyStatus.append(problemsList(plan.problems));
        return;
      }
      const approve = await encode("token", "approve", { owner: address, spender: contracts.shop, value: plan.price });
      const buy = await encode("shop", "buy_membership", {
        payer: address,
        tier: 2,
        months: 1,
        token: contracts.paymentToken,
      });
      const sent = await send([approve, buy], buyStatus);
      if (sent) await refreshAccount();
    } catch (error) {
      buyStatus.replaceChildren(h("span", { class: "note-bad" }, [explainFailure(error)]));
    } finally {
      buyButton.disabled = false;
    }
  });

  const linkSecret = linkSecretFromHash(location.hash);
  const campaignId = campaignFromLink || "";
  const promoStatus = statusBox();
  const promoButton = h("button", { type: "button" }, ["Claim free Ink"]);
  const promoPanel = h("div", { class: "panel" }, [h("h2", {}, ["Promo link"])]);
  if (!linkSecret || !campaignId) {
    promoPanel.append(h("p", {}, ["Promo Ink is claimed from a link shared on Discord, Telegram or X. Open the full link you were given and this page will fill in the rest. There is nothing to type."]));
  } else {
    promoPanel.append(
      h("p", {}, ["You opened a promo link for campaign " + campaignId + ". Claiming signs a request that only your wallet can use, so the link cannot be reused for anyone else. A wallet can claim once, ever."]),
      h("p", { class: "hint" }, [walletHint()]),
      h("div", { class: "row" }, [promoButton]),
      promoStatus
    );
    promoButton.addEventListener("click", async () => {
      promoStatus.replaceChildren();
      promoButton.disabled = true;
      try {
        const plan = assessPromo({
          campaignId,
          hasLinkKey: !!linkSecret,
          alreadyClaimed: state.account.promo !== "0",
          paused: !!cfg.paused,
          promoEnabled: !!cfg.promo_enabled,
        });
        if (!plan.ok) {
          promoPanel.append(problemsList(plan.problems));
          return;
        }
        promoStatus.textContent = "Signing the promo link with your wallet address…";
        const signature = await signPromoClaim(linkSecret, contracts.shop, campaignId, address);
        const op = await encode("shop", "claim_promo", {
          account: address,
          campaign_id: String(campaignId).trim(),
          signer: "",
          signature,
        });
        const sent = await send([op], promoStatus);
        if (sent) await refreshAccount();
      } catch (error) {
        promoStatus.replaceChildren(h("span", { class: "note-bad" }, [explainFailure(error)]));
      } finally {
        promoButton.disabled = false;
      }
    });
  }
  page.append(promoPanel);
}

function renderJoin(page, storyId, inviteId) {
  page.dataset.wantsAccount = "1";
  page.append(
    h("h1", {}, ["Join a private story"]),
    h("p", {}, ["You opened an invite link for story " + storyId + ". Joining adds your wallet to this story's writers. The link signs a request only your wallet can use, so it cannot be reused for anyone else."])
  );
  const linkSecret = linkSecretFromHash(location.hash);
  const address = currentAddress();
  const status = statusBox();
  if (!linkSecret) {
    page.append(h("p", { class: "note-bad" }, ["This invite link is missing its key. Open the full link you were given."]));
    return;
  }
  if (!address) {
    page.append(h("p", {}, ["Connect a wallet to join."]), h("button", { type: "button", onClick: openWallet }, ["Connect a wallet"]));
    return;
  }
  const joinButton = h("button", { type: "button" }, ["Join this story"]);
  page.append(h("div", { class: "panel" }, [
    h("p", { class: "hint" }, [walletHint()]),
    h("div", { class: "row" }, [joinButton, h("a", { class: "button secondary", href: "#/stories/" + storyId }, ["Open the story"])]),
    status,
  ]));
  joinButton.addEventListener("click", async () => {
    status.replaceChildren();
    joinButton.disabled = true;
    try {
      status.textContent = "Signing the invite with your wallet address…";
      const signature = await signInviteJoin(linkSecret, contracts.stories, storyId, inviteId, address);
      const op = await encode("stories", "join_with_invite", {
        account: address,
        story_id: String(storyId),
        invite_id: String(inviteId),
        signature,
      });
      const sent = await send([op], status);
      if (sent) {
        status.append(h("p", {}, ["You can now write in ", h("a", { href: "#/stories/" + storyId }, ["story " + storyId]), "."]));
        await refreshAccount();
      }
    } catch (error) {
      status.replaceChildren(h("span", { class: "note-bad" }, [explainFailure(error)]));
    } finally {
      joinButton.disabled = false;
    }
  });
}

async function send(operations, status) {
  if (!state.wallet) throw new Error("Connect a wallet first.");
  if (problems.length) throw new Error(problems.join(" "));
  const manaDecision = state.wallet.id === "koinvault" && state.account
    ? vaultManaDecision(state.account.mana, VAULT_MANA_CEILING)
    : null;
  if (manaDecision && manaDecision.blocked) throw new Error(manaDecision.message);
  status.textContent = state.wallet.id === "koinvault"
    ? "Sending the request to KOIN Vault…"
    : "Kondor should open. " + KONDOR_HINT;
  const sent = await state.wallet.signAndSend(operations, {
    onProgress(progress) {
      status.replaceChildren();
      if (progress.phase === "awaiting-approval") {
        const when = progress.expiresAt ? " It expires " + formatUtc(Math.floor(progress.expiresAt / 1000)) + "." : "";
        const payer = progress.funding
          ? " Vault chose " + (progress.funding.payer === "sponsor" ? "its sponsor" : "your account") + " to pay up to " + progress.funding.maxMana + " mana."
          : "";
        status.append(
          "Approve this in KOIN Vault with your passkey, fingerprint, or PIN." + when + payer + " ",
          h("a", { href: "https://koinvault.app/", target: "_blank", rel: "noopener noreferrer" }, ["Open KOIN Vault"])
        );
      } else if (progress.phase === "submitting") {
        status.textContent = "KOIN Vault is submitting and waiting for a block. This can take about a minute. Do not send it again.";
      }
    },
  });
  const id = sent.transactionId || "";
  status.replaceChildren(h("p", { class: "note-ok" }, ["Transaction " + id]));
  if (sent.receipt && sent.receipt.reverted) {
    const logs = Array.isArray(sent.receipt.logs) ? sent.receipt.logs.join(" ") : "";
    status.append(h("p", { class: "note-bad" }, ["The chain reverted it. " + (logs || "No contract message was returned.")]));
    return false;
  }
  const found = id ? await lookupTransaction(id) : null;
  const receipt = found && (found.receipt || (found.transaction && found.transaction.receipt));
  if (receipt && receipt.reverted) {
    const logs = Array.isArray(receipt.logs) ? receipt.logs.join(" ") : "";
    status.append(h("p", { class: "note-bad" }, ["Included, then reverted. " + (logs || "")]));
    return false;
  }
  if (found) status.append(h("p", {}, ["The node has this transaction."]));
  else status.append(h("p", { class: "hint" }, ["The wallet accepted it. If it does not show in a block explorer in a minute, it may still be waiting."]));
  return true;
}

function openWallet() {
  state.notice = "";
  renderDialog();
  if (!dialog.open) dialog.showModal();
}

function renderDialog() {
  const body = h("div");
  const close = h("button", { type: "button", class: "ghost", onClick: () => dialog.close() }, ["Close"]);
  body.append(h("div", { class: "row" }, [h("h2", { style: "margin:0;flex:1" }, ["Wallet"]), close]));
  const address = currentAddress();
  if (address && state.wallet) {
    body.append(h("p", {}, [(state.wallet.id === "koinvault" ? "KOIN Vault" : "Kondor") + " is connected."]));
    body.append(h("p", { class: "addr" }, [address]));
    if (state.wallet.id === "koinvault" && state.wallet.getExpiry) {
      const when = formatUtc(Math.floor((state.wallet.getExpiry() || 0) / 1000));
      if (when) body.append(h("p", { class: "hint" }, ["This pairing expires " + when + ". Pairing does not renew itself."]));
    }
    body.append(h("button", { type: "button", class: "secondary", onClick: async () => {
      await state.wallet.disconnect();
      if (state.wallet === kondor || state.wallet === vault) state.wallet = null;
      state.account = null;
      renderChip();
      renderDialog();
    } }, ["Disconnect"]));
    body.append(h("p", { class: "hint" }, ["Disconnect forgets the address in this browser tab. It does not remove a transaction already sent."]));
  }
  body.append(h("h3", {}, ["Kondor"]));
  body.append(h("p", {}, ["A browser extension for a computer. It signs in a popup. ", h("a", { href: "https://chrome.google.com/webstore/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl", target: "_blank", rel: "noopener noreferrer" }, ["Install Kondor"])]));
  body.append(h("p", { class: "hint" }, [KONDOR_HINT]));
  body.append(h("button", { type: "button", onClick: connectKondor }, ["Connect Kondor"]));

  body.append(h("h3", {}, ["KOIN Vault"]));
  body.append(vaultSection());
  dialog.replaceChildren(body);
}

function vaultSection() {
  const box = h("div");
  const info = state.vaultInfo;
  if (info && info.phase === "pairing") {
    const uri = (info.uri || vault.getPairingUri());
    box.append(h("p", {}, ["Open KOIN Vault, approve SwarmTales with your passkey, then come back to this tab. The 30-minute session starts when the code is created, not when you approve."]));
    if (uri) {
      box.append(h("p", {}, [h("a", { href: uri, target: "_blank", rel: "noopener noreferrer", referrerpolicy: "no-referrer" }, ["Open KOIN Vault"])]));
      const qr = h("div", { class: "qr", hidden: "hidden" });
      const show = h("button", { type: "button", class: "secondary", onClick: async () => {
        show.disabled = true;
        try {
          const QR = await import("qrcode");
          const svg = await QR.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
          const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
          qr.hidden = false;
          qr.replaceChildren(parsed.documentElement);
        } catch {
          qr.hidden = false;
          qr.textContent = "The code could not be drawn. Use the link instead.";
        }
      } }, ["Show pairing code"]);
      box.append(h("p", { class: "hint" }, ["The code is a key for this session. Do not share your screen while it is visible. It is drawn on this page, not by another website."]));
      box.append(show, qr);
    }
    box.append(h("p", { id: "vault-live", class: "hint" }));
    box.append(h("button", { type: "button", class: "ghost", onClick: async () => {
      await vault.disconnect();
      state.vaultInfo = null;
      if (state.wallet === vault) state.wallet = null;
      renderDialog();
    } }, ["Cancel pairing"]));
    return box;
  }
  box.append(h("p", {}, ["A phone wallet. You approve with a passkey. There is no extension. ", h("a", { href: "https://koinvault.app/", target: "_blank", rel: "noopener noreferrer" }, ["koinvault.app"])]));
  const button = h("button", { type: "button", onClick: connectVault }, ["Connect KOIN Vault"]);
  box.append(button);
  box.append(h("p", { id: "vault-note", class: "hint" }, ["Checking how KOIN Vault is configured…"]));
  fetchVaultConfig().then((config) => {
    const note = document.getElementById("vault-note");
    if (!note) return;
    const decision = vaultPairingDecision(network, config, location.protocol);
    note.textContent = decision.ok
      ? "Vault is on " + config.network + ". This page will pair with it. Vault signs only on that network."
      : decision.reason;
    if (!decision.ok) button.disabled = true;
  }).catch((error) => {
    const note = document.getElementById("vault-note");
    if (note) note.textContent = explainFailure(error);
    button.disabled = true;
  });
  return box;
}

async function connectKondor() {
  try {
    if (vault.getAddress() || vault.getPairingUri()) await vault.disconnect();
    state.vaultInfo = null;
    await kondor.connect();
    state.wallet = kondor;
    await refreshAccount();
    renderDialog();
    renderPage();
  } catch (error) {
    const note = h("p", { class: "note-bad" }, [explainFailure(error)]);
    dialog.append(note);
  }
}

async function connectVault() {
  try {
    if (state.wallet === kondor) {
      await kondor.disconnect();
      state.wallet = null;
      state.account = null;
    }
    await vault.connect();
    state.wallet = vault;
    renderDialog();
  } catch (error) {
    const note = h("p", { class: "note-bad" }, [explainFailure(error)]);
    dialog.append(note);
  }
}

boot();
