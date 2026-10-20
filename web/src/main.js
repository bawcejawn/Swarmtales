import "@fontsource/literata/latin-400.css";
import "@fontsource/literata/latin-400-italic.css";
import "@fontsource/literata/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "./style.css";

import { utils } from "koilib";
import { SITE, contracts, configProblems, network } from "./config.js";
import {
  encode,
  listStories,
  loadAccount,
  loadOverview,
  loadStory,
  lookupTransaction,
  waitForConfirmation,
  hasReported,
  quoteCost,
  read,
  verifyChain,
  writerFlags,
} from "./chain.js";
import { explainFailure } from "./lib/errors.js";
import { TX_CONFIRMED, TX_REVERTED } from "./lib/confirm.js";
import { KIND, STORY_STATUS, TIER, VISIBILITY, label } from "./lib/labels.js";
import { VAULT_MANA_CEILING, formatMana, formatUnits, formatUtc, kondorManaNote, shortAddress } from "./lib/money.js";
import { KIND_BOOK, assessOpen, assessPromo, assessWrite, assessWriterBuy, isActiveWriter } from "./lib/rules.js";
import { MAX_CHARS_PER_SIGNATURE, MAX_PARTS_PER_SIGNATURE, checkStoryText, inkCost, normalizePasted, splitIntoParts } from "./lib/text.js";
import {
  kondorHint,
  VAULT_MANA_EXPLANATION,
  clearSavedSession,
  createKondorWallet,
  createVaultWallet,
  loadSavedSession,
  saveSession,
} from "./wallet.js";
import { fetchVaultConfig, vaultManaDecision, vaultPairingDecision } from "./lib/vaultApi.js";
import { buildInviteLink, findInviteId, generateLinkKey, hashWithoutSecret, linkSecretFromHash, signInviteJoin, signPromoClaim } from "./lib/links.js";
import { createTestWallet, forgetTestWalletOnMainnet, storedTestAddress } from "./testWallet.js";
import { isFramed } from "./lib/frame.js";
import { append, h, icons, replace } from "./ui/dom.js";
import { renderHowSections } from "./ui/how.js";
import { renderMarkdown } from "./ui/markdown.js";
import { readingOrder } from "./lib/order.js";
import * as reading from "./lib/bookmarks.js";
import { createReader } from "./ui/readAloud.js";

const problems = configProblems();
const kondor = createKondorWallet();
const vault = createVaultWallet(network);
// Testnet only: null on mainnet, so none of its screens appear there.
const testWallet = createTestWallet(network);
const KONDOR_STORE = "https://chrome.google.com/webstore/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl";

const state = {
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
  discover: { tab: "open", kind: "all", category: 0 },
  showAuthors: readPref("st-show-authors", "1") === "1",
  openKind: "short",
  kondorAccounts: null, // accounts Kondor shared, while the person is choosing
};

const dialog = document.createElement("dialog");
dialog.className = "sheet";
dialog.setAttribute("aria-labelledby", "wallet-title");

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function readPref(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const path = raw.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const isId = (v) => !!v && /^[1-9][0-9]{0,15}$/.test(v);
  if (parts[0] === "stories" && isId(parts[1]) && parts[2] === "finish") return { name: "finish", id: parts[1] };
  if (parts[0] === "stories" && isId(parts[1]) && parts[2] === "book") return { name: "book", id: parts[1] };
  if (parts[0] === "stories" && isId(parts[1])) return { name: "story", id: parts[1] };
  if (parts[0] === "stories" || parts[0] === "discover") return { name: "discover" };
  if (parts[0] === "open") return { name: "open" };
  if (parts[0] === "mine") return { name: "mine" };
  if (parts[0] === "how") return { name: "how" };
  if (parts[0] === "terms") return { name: "terms" };
  if (parts[0] === "report") return { name: "report" };
  if (parts[0] === "shop" || parts[0] === "membership") return { name: "membership" };
  if (parts[0] === "promo" && isId(parts[1])) return { name: "promo", campaign: parts[1] };
  if (parts[0] === "join" && isId(parts[1]) && isId(parts[2])) return { name: "join", storyId: parts[1], inviteId: parts[2] };
  return { name: "home" };
}

function currentAddress() {
  return state.wallet && state.wallet.getAddress ? state.wallet.getAddress() : null;
}

function walletName() {
  if (state.wallet && state.wallet.id === "testwallet") return "Test wallet";
  return state.wallet && state.wallet.id === "koinvault" ? "KOIN Vault" : "Kondor";
}

function tokenAmount(base) {
  try {
    return formatUnits(base || "0", contracts.paymentDecimals) + " " + contracts.paymentSymbol;
  } catch {
    return "? " + contracts.paymentSymbol;
  }
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
}

function plural(n, one, many) {
  return num(n) + " " + (Number(n) === 1 ? one : many || one + "s");
}

function categoryName(id) {
  const n = Number(id || 0);
  if (!n) return "";
  const found = state.overview && state.overview.categories.find((item) => item.id === n);
  return found ? found.name : "Category " + n;
}

function storyCategories(story) {
  return [categoryName(story.category_1), categoryName(story.category_2)].filter(Boolean);
}

// Stories opened with no fixed size get their kind's maximum. They can be
// finished once they reach their kind's minimum.
function kindMin(story) {
  return Number(story.kind) === KIND_BOOK ? 100000 : 10000;
}

function openEnded(story) {
  const max = Number(story.max_chars || 0);
  return max === (Number(story.kind) === KIND_BOOK ? 1000000 : 99999);
}

function inviteOnly(story) {
  const v = Number(story.visibility || 0);
  return v === 2 || v === 3;
}

function percent(story) {
  const used = Number(story.used_chars || 0);
  // Open-ended stories show progress towards the length where they can be finished.
  const max = openEnded(story) ? kindMin(story) : Number(story.max_chars || 0);
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
}

function sizeText(story) {
  const used = Number(story.used_chars || 0);
  if (!openEnded(story)) return num(story.used_chars) + " of " + num(story.max_chars) + " characters";
  if (Number(story.status) !== 1) return num(used) + " characters";
  return used >= kindMin(story)
    ? num(used) + " characters · long enough to finish"
    : num(used) + " characters · " + num(kindMin(story) - used) + " more until it can be finished";
}

function statusPill(story) {
  const status = Number(story.status || 0);
  if (status === 1) {
    if (openEnded(story)) {
      return Number(story.used_chars || 0) >= kindMin(story)
        ? h("span", { class: "pill pill-almost" }, ["Open · can be finished"])
        : h("span", { class: "pill pill-open" }, ["Open to writers"]);
    }
    return percent(story) >= 85
      ? h("span", { class: "pill pill-almost" }, ["Almost full"])
      : h("span", { class: "pill pill-open" }, ["Open to writers"]);
  }
  if (status === 2) return h("span", { class: "pill pill-almost" }, ["Full, awaiting final edit"]);
  if (status === 3) return h("span", { class: "pill pill-almost" }, ["In final edit"]);
  if (status === 4) return h("span", { class: "pill pill-done" }, ["Finished"]);
  if (status === 5) return h("span", { class: "pill pill-neutral" }, ["Archived"]);
  return h("span", { class: "pill pill-neutral" }, [label(STORY_STATUS, status)]);
}

function progressBar(story, labelText) {
  const bar = h("span");
  bar.style.width = percent(story) + "%";
  return h("div", {}, [
    labelText ? h("div", { class: "progress-label" }, labelText) : null,
    h("div", {
      class: "progress" + (Number(story.status) === 4 ? " done" : ""),
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(percent(story)),
      "aria-label": "How full this story is",
    }, [bar]),
  ]);
}

function charsLine(story) {
  return [h("span", {}, [sizeText(story)]), h("span", {}, [plural(story.contributor_count, "writer")])];
}

const AVATAR_TINTS = [
  ["#F4E9D6", "#6E4100"],
  ["#E7F0EA", "#24543A"],
  ["#E6ECEF", "#163F55"],
  ["#EFE6F0", "#5B2E62"],
  ["#F3E3DE", "#7A2E14"],
];

function avatar(address) {
  const s = String(address || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum + s.charCodeAt(i)) % 997;
  const [bg, fg] = AVATAR_TINTS[sum % AVATAR_TINTS.length];
  const node = h("span", { class: "avatar", "aria-hidden": "true" }, [s.slice(1, 3).toUpperCase()]);
  node.style.background = bg;
  node.style.color = fg;
  return node;
}

function notice(kind, content) {
  return h("div", { class: "notice notice-" + kind, role: kind === "bad" ? "alert" : null }, Array.isArray(content) ? content : [content]);
}

function problemsNotice(items) {
  if (!items || !items.length) return null;
  if (items.length === 1) return notice("warn", h("p", {}, [items[0]]));
  return notice("warn", [h("p", {}, ["Before your wallet opens, a few things need fixing:"]), h("ul", {}, items.map((item) => h("li", {}, [item])))]);
}

function statusBox() {
  return h("div", { class: "status", role: "status", "aria-live": "polite" });
}

function failure(status, error) {
  replace(status, notice("bad", h("p", {}, [explainFailure(error)])));
}

function field(labelText, control, help) {
  return h("label", { class: "field" }, [h("span", {}, [labelText, help ? h("span", { class: "help" }, [help]) : null]), control]);
}

function connectButton(text) {
  return h("button", { type: "button", class: "btn btn-primary", onClick: openWallet }, [text || "Connect a wallet"]);
}

function setMeta(title, description) {
  document.title = title ? title + " · SwarmTales" : "SwarmTales · Stories written by many hands";
  const tag = document.querySelector('meta[name="description"]');
  if (tag && description) tag.setAttribute("content", description);
}

function minContribution() {
  const cfg = state.overview && state.overview.storiesCfg;
  return cfg && cfg.min_contribution ? String(cfg.min_contribution) : "0";
}

/* ------------------------------------------------------------------ */
/* data                                                                */
/* ------------------------------------------------------------------ */

function loadLibrary(force) {
  if (!state.overview) return Promise.resolve(null);
  if (force) {
    state.library = null;
    state.libraryPromise = null;
  }
  if (state.library) return Promise.resolve(state.library);
  if (!state.libraryPromise) {
    state.libraryPromise = listStories(state.overview.storiesCfg.next_story_id || "1")
      .then((result) => {
        state.library = result;
        return result;
      })
      .catch((error) => {
        state.libraryPromise = null;
        throw error;
      });
  }
  return state.libraryPromise;
}

async function firstLine(id) {
  if (state.excerpts.has(id)) return state.excerpts.get(id);
  let text = "";
  try {
    const page = await read("stories", "get_segments", { story_id: String(id), start: "1", limit: 3 });
    const values = page && Array.isArray(page.values) ? page.values : [];
    const first = values.find((segment) => Number(segment.status) !== 2 && !segment.hidden);
    text = first ? String(first.text || "") : "";
  } catch {
    text = "";
  }
  state.excerpts.set(id, text);
  return text;
}

function clip(text, limit) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut) + "…";
}

function isPublic(story) {
  return Number(story.visibility) === 1;
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

/* ------------------------------------------------------------------ */
/* shell                                                               */
/* ------------------------------------------------------------------ */

function renderChip() {
  const slot = document.getElementById("chip");
  if (!slot) return;
  slot.replaceChildren();
  const address = currentAddress();
  if (!address) {
    append(slot, h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: openWallet }, ["Connect wallet"]));
    return;
  }
  append(slot, h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: openWallet, "aria-label": "Wallet: " + walletName() + " " + address }, [
    walletName() + " · " + shortAddress(address),
  ]));
}

function renderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const here = route().name;
  const items = [
    ["discover", "#/stories", "Discover"],
    ["open", "#/open", "Open a story"],
    ["how", "#/how", "How it works"],
    ["mine", "#/mine", "My stories"],
    ["membership", "#/membership", "Membership"],
  ];
  replace(nav, ...items.map(([name, href, text]) => {
    const current = here === name || (name === "discover" && here === "story");
    return h("a", { href, "aria-current": current ? "page" : null }, [text]);
  }));
}

function boot() {
  const app = document.getElementById("app");
  // Inside another site's frame, a wallet confirmation could be clickjacked:
  // show only a link to the real page (AB-014).
  if (isFramed(window)) {
    replace(app, h("main", { class: "container" }, [
      h("p", {}, ["SwarmTales was opened inside another website, so it won't run here. ",
        h("a", { href: location.href, target: "_top", rel: "noopener" }, ["Open SwarmTales directly"]), "."]),
    ]));
    return;
  }
  try {
    forgetTestWalletOnMainnet(network, localStorage);
  } catch {
    /* no storage at all */
  }
  replace(app, 
    h("a", { class: "skip", href: "#page", onClick: (event) => { event.preventDefault(); focusMain(); } }, ["Skip to content"]),
    network.mainnet
      ? null
      : h("div", { class: "testnet-bar" }, [h("strong", {}, ["Test version."]), " Running on the Koinos testnet with play money. Stories here may be reset before launch."]),
    h("header", { class: "site-header" }, [
      h("div", { class: "container" }, [
        h("a", { class: "brand", href: "#/" }, [icons.logo(), h("span", { class: "brand-name" }, ["SwarmTales"])]),
        h("nav", { id: "nav", class: "nav", "aria-label": "Main" }),
        h("div", { id: "chip" }),
      ]),
    ]),
    h("main", { id: "page", tabindex: "-1" }),
    h("footer", { class: "site-footer" }, [
      h("div", { class: "container" }, [
        h("p", {}, [
          "Ink is a writing allowance for SwarmTales. It has no cash value and can't be sold, sent, or traded. SwarmTales is for creative fun, not investment. ",
          "This site is a set of static pages: it reads the public Koinos network from your browser, and you sign with your own wallet. It never asks for a private key.",
        ]),
        h("p", {}, [
          h("a", { href: "#/how" }, ["How it works"]), " · ",
          h("a", { href: "#/terms" }, ["Terms of Use"]), " · ",
          h("a", { href: "#/report" }, ["Report copied text"]), " · ",
          h("a", { href: "https://github.com/bawcejawn/Swarmtales", rel: "noopener" }, ["Source code"]),
        ]),
        h("details", {}, [
          h("summary", {}, ["Contract addresses on " + network.name]),
          h("dl", { class: "addr-list" }, [
            h("dt", {}, ["Stories"]), h("dd", {}, [contracts.stories]),
            h("dt", {}, ["Ink"]), h("dd", {}, [contracts.ink]),
            h("dt", {}, ["Shop"]), h("dd", {}, [contracts.shop]),
            h("dt", {}, [contracts.paymentSymbol]), h("dd", {}, [contracts.paymentToken]),
            h("dt", {}, ["Network node"]), h("dd", {}, [network.rpc]),
          ]),
        ]),
      ]),
    ]),
    dialog
  );
  window.addEventListener("hashchange", () => {
    renderNav();
    renderPage();
    window.scrollTo(0, 0);
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

function focusMain() {
  const page = document.getElementById("page");
  const heading = page && page.querySelector("h1");
  (heading || page).focus();
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
  if (saved && saved.kind === "testwallet" && testWallet) {
    testWallet.restore();
    state.wallet = testWallet.getAddress() ? testWallet : null;
  } else if (saved && saved.kind === "kondor") {
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
  const alerts = [];
  if (state.chainError) alerts.push(notice("bad", h("p", {}, ["The story network isn't answering right now. " + state.chainError])));
  if (state.notice) alerts.push(notice("warn", h("p", {}, [state.notice])));
  if (alerts.length) append(page, h("div", { class: "container" }, alerts));
  if (here.name === "discover") renderDiscover(page);
  else if (here.name === "story") renderReader(page, here.id);
  else if (here.name === "finish") renderFinish(page, here.id);
  else if (here.name === "book") renderBook(page, here.id);
  else if (here.name === "open") renderOpen(page);
  else if (here.name === "mine") renderMine(page);
  else if (here.name === "membership") renderMembership(page);
  else if (here.name === "promo") renderPromo(page, here.campaign);
  else if (here.name === "join") renderJoin(page, here.storyId, here.inviteId);
  else if (here.name === "how") renderHow(page);
  else if (here.name === "terms") renderTerms(page);
  else if (here.name === "report") renderReportPage(page);
  else renderHome(page);
  const heading = page.querySelector("h1");
  if (heading) heading.setAttribute("tabindex", "-1");
}

function loadingLine(text) {
  return h("p", { class: "loading" }, [text]);
}

/* ------------------------------------------------------------------ */
/* home                                                                */
/* ------------------------------------------------------------------ */

function storyCard(row, excerptText) {
  const story = row.story;
  const meta = [storyCategories(story)[0], label(KIND, story.kind)].filter(Boolean).join(" · ");
  const line = h("p", { class: "card-line" }, [excerptText == null ? "" : clip(excerptText, 150)]);
  if (excerptText == null) {
    firstLine(row.id).then((text) => {
      line.textContent = clip(text, 150);
    });
  }
  return h("a", { class: "story-card", href: "#/stories/" + row.id }, [
    h("div", { class: "card-top" }, [
      h("p", { class: "meta" }, [meta]),
      h("div", { class: "pills" }, [
        Number(story.visibility) !== 1 ? h("span", { class: "pill pill-neutral" }, [label(VISIBILITY, story.visibility)]) : null,
        statusPill(story),
      ]),
    ]),
    h("h3", { class: "card-title" }, [story.title || "Untitled"]),
    line,
    progressBar(story, charsLine(story)),
  ]);
}

function pickFeatured(rows) {
  const open = rows.filter((row) => isPublic(row.story) && Number(row.story.status) === 1);
  const pool = open.length ? open : rows.filter((row) => isPublic(row.story));
  return pool
    .slice()
    .sort((a, b) => Number(b.story.last_activity_at || 0) - Number(a.story.last_activity_at || 0));
}

function renderHome(page) {
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

function stat(name, value) {
  return h("div", {}, [h("dt", {}, [name]), h("dd", {}, [value])]);
}

/* ------------------------------------------------------------------ */
/* discover                                                            */
/* ------------------------------------------------------------------ */

const TABS = [
  ["open", "Open for writing", (s) => Number(s.status) === 1],
  ["finishing", "Being finished", (s) => Number(s.status) === 2 || Number(s.status) === 3],
  ["finished", "Finished", (s) => Number(s.status) === 4],
];
const KINDS = [
  ["all", "All", () => true],
  ["book", "Books", (s) => Number(s.kind) === 1],
  ["short", "Short stories", (s) => Number(s.kind) === 2],
];

function renderDiscover(page) {
  setMeta("Discover stories", "Find a collaborative story to read, or one that is still open for new writers.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container, 
    h("h1", { class: "title" }, ["Find a story to read, or to write in"]),
    h("p", { class: "lede", style: null }, ["Stories that are still being written welcome new writers. Finished ones read like any book."])
  );
  container.lastChild.style.marginTop = "12px";
  const filters = h("div", { class: "filters" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Category" });
  const count = h("p", { class: "meta", "aria-live": "polite" });
  const grid = h("div", { class: "card-grid" }, [loadingLine("Reading the shelves…")]);
  const filterBlock = h("div", { class: "stack" }, [filters, chips, count, grid]);
  filterBlock.style.marginTop = "40px";
  append(container, filterBlock);

  if (!state.overview) {
    replace(grid, loadingLine(state.chainError ? "Stories will appear when the network answers." : "Connecting to the story network…"));
    return;
  }

  function draw(library) {
    const all = (library ? library.stories : []).filter((row) => isPublic(row.story));
    const tab = TABS.find((t) => t[0] === state.discover.tab) || TABS[0];
    const kind = KINDS.find((k) => k[0] === state.discover.kind) || KINDS[0];
    const inTab = all.filter((row) => tab[2](row.story) && kind[2](row.story));

    replace(filters, 
      h("div", { class: "tabbar", role: "group", "aria-label": "Story stage" }, TABS.map(([id, text]) =>
        h("button", { type: "button", "aria-pressed": String(state.discover.tab === id), onClick: () => { state.discover.tab = id; draw(library); } }, [text]))),
      h("div", { class: "segmented", role: "group", "aria-label": "Kind" }, KINDS.map(([id, text]) =>
        h("button", { type: "button", "aria-pressed": String(state.discover.kind === id), onClick: () => { state.discover.kind = id; draw(library); } }, [text])))
    );

    const counts = new Map();
    for (const row of inTab) {
      for (const id of [Number(row.story.category_1 || 0), Number(row.story.category_2 || 0)]) {
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    const cats = state.overview.categories.filter((c) => c.active || counts.has(c.id));
    replace(chips, 
      h("button", { type: "button", "aria-pressed": String(!state.discover.category), onClick: () => { state.discover.category = 0; draw(library); } }, ["All categories"]),
      ...cats.map((c) => h("button", {
        type: "button",
        "aria-pressed": String(state.discover.category === c.id),
        onClick: () => { state.discover.category = c.id; draw(library); },
      }, [c.name, h("span", { class: "count" }, [String(counts.get(c.id) || 0)])]))
    );

    const cat = state.discover.category;
    const shown = cat ? inTab.filter((row) => Number(row.story.category_1) === cat || Number(row.story.category_2) === cat) : inTab;
    shown.sort((a, b) => Number(b.story.last_activity_at || 0) - Number(a.story.last_activity_at || 0));
    count.textContent = plural(shown.length, "story", "stories") + (library && library.truncated ? " (showing the first 200 on the network)" : "");
    if (!shown.length) {
      replace(grid, h("div", { class: "empty" }, [
        h("p", { class: "serif" }, ["No stories here yet."]),
        h("p", { class: "meta" }, ["Try another category, or open the first one yourself."]),
        h("p", {}, [h("a", { class: "link-arrow", href: "#/open" }, ["Open a story", icons.arrow()])]),
      ]));
      grid.style.display = "block";
      return;
    }
    grid.style.display = "";
    replace(grid, ...shown.map((row) => storyCard(row)));
  }

  loadLibrary().then(draw).catch((error) => replace(grid, notice("bad", h("p", {}, [explainFailure(error)]))));
}

/* ------------------------------------------------------------------ */
/* reader                                                              */
/* ------------------------------------------------------------------ */

function renderReader(page, id) {
  const container = h("div", { class: "container page" }, [loadingLine("Opening the story…")]);
  append(page, container);
  loadStory(id).then(async (bundle) => {
    const story = bundle.story;
    if (!story || Number(story.status || 0) === 0) {
      setMeta("Story not found", "");
      replace(container, 
        h("h1", { class: "title" }, ["We couldn't find that story"]),
        h("p", { class: "lede" }, ["There's no story with this number on " + network.name + "."]),
        h("p", {}, [h("a", { class: "link-arrow", href: "#/stories" }, ["Back to Discover", icons.arrow()])])
      );
      return;
    }
    // Reading order: parts added between others are read where they were placed.
    const all = bundle.segments.map((segment, i) => ({ segment, index: i + 1, seq: i + 1, insertAfter: Number(segment.insert_after || 0) }));
    const ordered = readingOrder(all);
    const active = ordered.filter((b) => Number(b.segment.status) !== 2);
    const removed = all.filter((b) => Number(b.segment.status) === 2);
    const me = currentAddress();
    const flags = me ? await writerFlags(id, me).catch(() => ({ editor: false, allowed: false })) : { editor: false, allowed: false };
    const storyOpen = Number(story.status) === 1;
    const ctx = {
      storyId: id,
      story,
      canEdit: storyOpen && !!me && (story.opener === me || flags.editor),
      // Private stories: only the opener, editors and invited writers.
      canAdd: storyOpen && (!inviteOnly(story) || canWriteInvited(story, me, flags)),
      flags,
      lastSeq: active.length ? active[active.length - 1].seq : 0,
      active,
    };
    const firstVisible = active.find((b) => !b.segment.hidden);
    const firstText = firstVisible ? firstVisible.segment.text : "";
    setMeta(story.title || "Untitled story", clip(firstText, 155) || "A collaborative story on SwarmTales.");

    // Chapters: a new chapter starts at the first part and at every part marked starts_chapter.
    const chapters = [];
    for (const block of active) {
      if (!chapters.length || block.segment.starts_chapter) chapters.push({ number: chapters.length + 1, blocks: [] });
      chapters[chapters.length - 1].blocks.push(block);
    }

    // Writers, by characters currently in the story.
    const totals = new Map();
    for (const block of active) {
      const author = block.segment.author || "";
      totals.set(author, (totals.get(author) || 0) + Number(block.segment.current_cost || block.segment.charged || 0));
    }
    const writers = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);

    const cats = storyCategories(story);
    const composeAnchor = h("div", { id: "compose" });
    const goWrite = () => {
      composeAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
      const area = composeAnchor.querySelector("textarea, button, a.btn");
      if (area) setTimeout(() => area.focus({ preventScroll: true }), 350);
      // Briefly highlight the writing box so it's clear where to look.
      const box = composeAnchor.querySelector(".composer");
      if (box) {
        box.classList.remove("flash");
        void box.offsetWidth;
        box.classList.add("flash");
      }
    };

    const isOpen = Number(story.status) === 1;
    // Private stories: say right away what this wallet can do here.
    let accessLine = null;
    if (isOpen && inviteOnly(story)) {
      const invited = !!me && (story.opener === me || flags.editor || flags.allowed);
      if (!me) accessLine = "Only invited writers can write here. Connect your wallet if you were invited.";
      else if (!invited) accessLine = "Only people the opener invites can write here. Anyone can read it.";
      else if (!canWriteInvited(story, me, flags)) accessLine = "You're invited. You need an active Writer month to write here; the opener can give you one.";
      else if (story.opener !== me) accessLine = "You're invited. Your parts are paid from the writers' pool (" + num(story.fund || 0) + " Ink left).";
    }
    const joinedNote = /[?&]joined=1/.test(location.hash) && me
      ? notice("ok", h("p", {}, [
        "You've joined this story. It's listed under ", h("a", { href: "#/mine" }, ["My stories"]), ". ",
        canWriteInvited(story, me, flags)
          ? "Scroll down to write the next part, or use “+ Add text here” under any part."
          : "To write, you need an active Writer month: ask the opener to give you one, or get one on the ",
        canWriteInvited(story, me, flags) ? null : h("a", { href: "#/membership" }, ["Membership page"]),
        canWriteInvited(story, me, flags) ? null : ".",
      ]))
      : null;
    const head = h("header", { class: "reader-head" }, [
      h("div", { class: "head-main" }, [
        h("div", { class: "pills" }, [
          statusPill(story),
          h("span", { class: "pill pill-neutral" }, [label(KIND, story.kind)]),
          Number(story.visibility) !== 1 ? h("span", { class: "pill pill-neutral" }, [label(VISIBILITY, story.visibility)]) : null,
        ]),
        h("h1", { class: "reader-title" }, [story.title || "Untitled"]),
        h("p", { class: "meta", style: null }, [
          "Opened by " + shortAddress(story.opener) + " · " + plural(writers.length || story.contributor_count, "writer") + " · " + plural(chapters.length, "chapter"),
        ]),
      ]),
      h("div", { class: "head-side" }, [
        progressBar(story, [h("span", {}, [sizeText(story)]), h("span", {}, [percent(story) + "%"])]),
        isOpen && (!inviteOnly(story) || canWriteInvited(story, me, flags))
          ? h("button", { type: "button", class: "btn btn-primary btn-block", onClick: goWrite }, ["Write the next part"])
          : null,
        accessLine ? h("p", { class: "meta access-line" }, [accessLine]) : null,
        isOpen && inviteOnly(story) && me && (flags.allowed || flags.editor) && !canWriteInvited(story, me, flags)
          ? h("a", { class: "btn btn-secondary btn-block", href: "#/membership" }, ["Get a Writer month"])
          : null,
      ]),
    ]);
    head.querySelector(".head-main .meta").style.marginTop = "12px";
    const sideButton = head.querySelector(".head-side .btn");
    if (sideButton) sideButton.style.marginTop = "16px";

    const column = h("div", { class: "reader-column" + (state.showAuthors ? "" : " hide-authors") });
    const toggle = h("input", { type: "checkbox" });
    toggle.checked = state.showAuthors;
    toggle.addEventListener("change", () => {
      state.showAuthors = toggle.checked;
      writePref("st-show-authors", toggle.checked ? "1" : "0");
      column.classList.toggle("hide-authors", !toggle.checked);
    });

    const article = h("article", { "aria-labelledby": "story-text-title" }, [
      h("h2", { class: "visually-hidden", id: "story-text-title" }, ["The story"]),
    ]);
    // Bookmarks and "continue reading" (kept in this browser only).
    const readOrder = [];
    const chapterOf = new Map();
    for (const chapter of chapters) {
      for (const b of chapter.blocks) {
        chapterOf.set(b.seq, chapter.number);
        if (!b.segment.hidden && Number(b.segment.status) !== 2) readOrder.push(b.seq);
      }
    }
    const placeOf = (seq) => ({
      seq,
      chapter: chapterOf.get(seq) || 1,
      percent: readOrder.length ? ((readOrder.indexOf(seq) + 1) / readOrder.length) * 100 : 0,
      title: story.title || "",
    });
    // A bookmark saved to the wallet (from any device) wins when it's newer.
    if (me) {
      const chain = await read("stories", "get_reading_place", { reader: me, story_id: String(id) }).catch(() => null);
      const local = reading.load(contracts.stories, id);
      const chainAt = chain ? Number(chain.at || 0) * 1000 : 0;
      if (chain && Number(chain.seq || 0) > 0 && (!local.mark || chainAt > local.mark.at)) {
        reading.setMark(contracts.stories, id, { seq: Number(chain.seq), chapter: chain.chapter, percent: chain.percent, title: story.title }, undefined, chainAt);
      }
    }
    const progress = reading.load(contracts.stories, id);
    ctx.markSeq = progress.mark ? progress.mark.seq : 0;
    const syncNote = h("p", { class: "meta small sync-note", "aria-live": "polite" });
    ctx.syncNote = syncNote;
    ctx.toggleMark = (seq) => {
      const off = ctx.markSeq === seq;
      const at = placeOf(seq);
      reading.setMark(contracts.stories, id, off ? null : at);
      ctx.markSeq = off ? 0 : seq;
      // With a wallet, the bookmark also goes on the blockchain so it follows
      // the reader to any device. One confirmation; uses a little free mana.
      if (me) {
        syncNote.textContent = "Saving your bookmark to your wallet…";
        encode("stories", "set_reading_place", {
          reader: me, story_id: String(id), seq: String(off ? 0 : seq), chapter: off ? 0 : at.chapter, percent: off ? 0 : Math.round(at.percent),
        }).then((op) => send([op], h("div"))).then((ok) => {
          syncNote.textContent = ok ? (off ? "Bookmark removed from your wallet." : "Bookmark saved to your wallet: it's there on any device you connect.") : "Saved in this browser only.";
        }).catch(() => { syncNote.textContent = "Saved in this browser only (your wallet didn't confirm)."; });
      } else {
        syncNote.textContent = off ? "" : "Saved in this browser. Connect a wallet to keep bookmarks on every device.";
      }
      article.querySelectorAll(".seg").forEach((el) => {
        const on = Number(el.dataset.seq) === ctx.markSeq;
        el.classList.toggle("bookmarked", on);
        const btn = el.querySelector(".bookmark-tool");
        if (btn) {
          btn.textContent = on ? "\u2605 Bookmarked" : "Bookmark";
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
      });
    };

    if (!chapters.length) append(article, h("div", { class: "empty" }, [h("p", {}, ["No text has been written yet."])]));
    chapters.forEach((chapter, i) => {
      append(article, h("h3", { class: "chapter-title" + (i === 0 ? " first" : ""), id: "chapter-" + chapter.number }, ["Chapter " + chapter.number]));
      for (const block of chapter.blocks) append(article, segmentView(block, story, id, ctx));
    });
    if (removed.length) {
      const details = h("details", { class: "removed" }, [h("summary", {}, [plural(removed.length, "removed part") + " (kept on the record)"])]);
      for (const block of removed) append(details, segmentView(block, story, id, null));
      append(article, details);
    }

    // Read-aloud items in reading order; each chapter's first part announces it.
    const listenItems = [];
    for (const chapter of chapters) {
      let first = true;
      for (const b of chapter.blocks) {
        if (b.segment.hidden || Number(b.segment.status) === 2) continue;
        listenItems.push({ seq: b.seq, text: b.segment.text || "", announce: first ? "Chapter " + chapter.number + "." : "" });
        first = false;
      }
    }
    const listen = createReader(article, listenItems);

    const goTo = (seq) => {
      const el = article.querySelector('.seg[data-seq="' + seq + '"]');
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("flash-seg");
      void el.offsetWidth;
      el.classList.add("flash-seg");
    };
    const lastOk = progress.last && readOrder.includes(progress.last.seq) && progress.last.seq !== readOrder[0];
    const markOk = progress.mark && readOrder.includes(progress.mark.seq);
    const resumeBar = lastOk || markOk
      ? h("div", { class: "resume-bar", role: "region", "aria-label": "Your place in this story" }, [
        h("span", { class: "meta" }, [lastOk
          ? "You were reading Chapter " + progress.last.chapter + " \u00b7 " + progress.last.percent + "% through."
          : "You bookmarked Chapter " + progress.mark.chapter + "."]),
        lastOk ? h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => goTo(progress.last.seq) }, ["Continue reading"]) : null,
        markOk ? h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => goTo(ctx.markSeq || progress.mark.seq) }, ["Go to bookmark"]) : null,
      ])
      : null;
    ctx.listen = listen;
    append(column, 
      h("div", { class: "chapter-bar" }, [
        h("p", { class: "eyebrow muted" }, [cats.join(" · ") || label(KIND, story.kind)]),
        h("label", { class: "check" }, [toggle, "Show who wrote what"]),
      ]),
      resumeBar,
      syncNote,
      listen,
      article,
      composeAnchor
    );
    append(composeAnchor, composer(id, story, active, 0, flags));

    const aside = h("aside", { class: "reader-aside", "aria-label": "About this story" }, [
      finishPanel(id, story, me),
      sharePanel(id, story, me, flags),
      chapters.length > 1
        ? h("nav", { "aria-label": "Contents" }, [
            h("h2", { class: "aside-title" }, ["Contents"]),
            h("ol", { class: "contents" }, chapters.map((chapter) => h("li", {}, [
              h("button", { type: "button", onClick: () => document.getElementById("chapter-" + chapter.number).scrollIntoView({ behavior: "smooth" }) }, [
                "Chapter " + chapter.number,
              ]),
            ]))),
          ])
        : null,
      writers.length
        ? h("section", {}, [
            h("h2", { class: "aside-title" }, ["Writers"]),
            h("ul", { class: "writers" }, writers.slice(0, 12).map(([address, chars]) => h("li", {}, [
              avatar(address),
              h("span", { class: "writer-name" }, [
                h("b", {}, [shortAddress(address) + (address === story.opener ? " (opener)" : "")]),
                h("span", {}, [plural(chars, "character")]),
              ]),
            ]))),
            h("p", { class: "meta small", style: null }, ["Characters in the story now. Final credits count what survives the closing edit."]),
          ])
        : null,
      h("section", { class: "card" }, [
        h("h2", { class: "aside-title" }, ["On the public record"]),
        h("p", { class: "body-2 small" }, ["Every part of this story, and every edit, is recorded on the Koinos blockchain. Anyone can check who wrote what."]),
        h("p", { class: "meta small mono" }, ["Story " + id + " · contract " + shortAddress(contracts.stories)]),
      ]),
    ]);

    replace(container, 
      h("p", { class: "breadcrumb" }, [h("a", { href: "#/stories" }, ["Discover"]), cats[0] ? " / " + cats[0] : ""]),
      joinedNote,
      head,
      h("div", { class: "reader-layout" }, [h("div", { class: "reader-main" }, [column]), aside])
    );
    const writersNote = aside.querySelector(".writers + p");
    if (writersNote) writersNote.style.marginTop = "12px";

    // Coming from "Continue reading" or "Go to bookmark" on My stories.
    if (/[?&]resume=1/.test(location.hash) && lastOk) setTimeout(() => goTo(progress.last.seq), 300);
    else if (/[?&]mark=1/.test(location.hash) && markOk) setTimeout(() => goTo(progress.mark.seq), 300);
    watchReading(article, id, placeOf);
  }).catch((error) => {
    replace(container, notice("bad", h("p", {}, [explainFailure(error)])));
  });
}

const REASON_LABELS = {
  1: "copied from someone else's work",
  2: "a duplicate of text already on SwarmTales",
  3: "spam",
  4: "unlawful or abusive content",
  5: "a policy problem",
};

function segmentView(block, story, storyId, ctx) {
  const segment = block.segment;
  const author = segment.author || "";
  const removed = Number(segment.status) === 2;
  const edited = !removed && segment.last_edited_by && segment.last_edited_by !== "" && Number(segment.last_edited_at || 0) > 0;
  const notes = [];
  let body;
  if (removed) {
    const why = segment.taken_down
      ? "Removed for good: " + (REASON_LABELS[Number(segment.moderation_reason)] || "a policy problem") + "."
      : "Removed by the story's editor.";
    body = h("p", { class: "seg-text seg-placeholder" }, [why]);
  } else if (segment.hidden) {
    body = h("div", {}, [
      h("p", { class: "seg-text seg-placeholder" }, [
        "This part is hidden" + (REASON_LABELS[Number(segment.moderation_reason)] ? " (possibly " + REASON_LABELS[Number(segment.moderation_reason)] + ")" : "") + ".",
      ]),
      hiddenHelp(storyId, block.seq, segment, story, ctx),
    ]);
  } else {
    body = h("p", { class: "seg-text" }, [segment.text || ""]);
    if (edited) {
      notes.push(h("details", { class: "edit-note" }, [
        h("summary", { title: "Show who edited this part" }, ["edited"]),
        h("span", {}, [
          " by " + shortAddress(segment.last_edited_by) + (formatUtc(segment.last_edited_at) ? " on " + formatUtc(segment.last_edited_at).split(",")[0] : "") +
            ". Credit stays with " + shortAddress(author) + "; the first version is kept on the public record.",
        ]),
      ]));
    }
    if (segment.ai_assisted) notes.push(h("span", { class: "tag-ai" }, ["Written with AI help"]));
    if (segment.citation) notes.push(h("span", { class: "source-note" }, ["Source: " + segment.citation]));
    if (segment.source_note) {
      notes.push(h("span", { class: "source-note", title: "Added automatically by SwarmTales' copy checker" }, [segment.source_note]));
    }
  }
  const tools = h("div", { class: "seg-tools" });
  const slot = h("div", { class: "seg-slot" });
  if (ctx && !removed) {
    const toggle = (name, make) => {
      const open = slot.dataset.open === name;
      replace(slot);
      slot.dataset.open = "";
      if (!open) {
        slot.dataset.open = name;
        append(slot, make());
        const focus = slot.querySelector("textarea, button");
        if (focus) focus.focus();
      }
    };
    if (ctx.canAdd && block.seq !== ctx.lastSeq) {
      append(tools, h("button", { type: "button", class: "text-button tool" }, ["+ Add text here"]));
      tools.lastChild.title = "Write new text that appears right below this part";
      tools.lastChild.addEventListener("click", () => toggle("add", () => composer(storyId, story, ctx.active, block.seq, ctx.flags)));
    }
    if (ctx.canEdit && !segment.hidden) {
      append(tools, h("button", { type: "button", class: "text-button tool", title: "Fix typos or tidy this part (opener and editors)" }, ["Edit"]));
      tools.lastChild.addEventListener("click", () => toggle("edit", () => editPanel(storyId, block)));
    }
    if (ctx.canEdit) {
      append(tools, h("button", { type: "button", class: "text-button tool" }, ["Remove"]));
      tools.lastChild.addEventListener("click", () => toggle("remove", () => removePanel(storyId, block)));
    }
    if (!segment.hidden && typeof window !== "undefined" && window.speechSynthesis) {
      append(tools, h("button", { type: "button", class: "text-button tool", onClick: () => ctx.listen && ctx.listen.startFrom(block.seq) }, ["Listen from here"]));
    }
    if (!segment.hidden && ctx.toggleMark) {
      const marked = ctx.markSeq === block.seq;
      append(tools, h("button", {
        type: "button", class: "text-button tool bookmark-tool", "aria-pressed": marked ? "true" : "false",
        title: "Keep your place at this part (saved in this browser)", onClick: () => ctx.toggleMark(block.seq),
      }, [marked ? "\u2605 Bookmarked" : "Bookmark"]));
    }
    if (!segment.hidden && author !== currentAddress()) append(tools, reportControl(storyId, block.index));
  }
  const isMarked = !!ctx && ctx.markSeq === block.seq && !segment.hidden;
  return h("div", { class: "seg" + (removed || segment.hidden ? " seg-muted" : "") + (isMarked ? " bookmarked" : ""), dataset: { seq: String(block.seq || block.index) } }, [
    h("p", { class: "seg-author" }, [h("b", {}, [shortAddress(author)]), h("span", {}, [(author === story.opener ? "opener · " : "") + num(segment.current_cost || segment.charged) + " Ink"])]),
    h("div", {}, [
      body,
      notes.length ? h("div", { class: "seg-notes" }, notes) : null,
      tools.childNodes.length ? tools : null,
      slot,
    ]),
  ]);
}

/** Light edit by the opener or an editor: the contract allows a little growth. */
function editPanel(storyId, block) {
  const seg = block.segment;
  const original = Number(seg.original_cost || 0);
  const allowance = Math.max(Math.floor(original / 10), Math.min(original, 20));
  const maxCost = Number(seg.charged || 0) + allowance;
  const area = h("textarea", { rows: "6", spellcheck: "true" });
  area.value = seg.text || "";
  const counter = h("p", { class: "meta" });
  const update = () => {
    const n = inkCost(normalizePasted(area.value).trim());
    counter.textContent = num(n) + " of at most " + num(maxCost) + " characters. Edits are for tidying: the part can grow only a little. Shortening it returns Ink to " + shortAddress(seg.author) + ".";
  };
  area.addEventListener("input", update);
  update();
  const status = statusBox();
  const save = h("button", { type: "submit", class: "btn btn-primary btn-small" }, ["Save edit"]);
  return h("form", { class: "inline-panel card", onSubmit: async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const text = normalizePasted(area.value).trim();
      const check = checkStoryText(text, true);
      if (!check.ok) throw new Error(check.reason);
      if (inkCost(text) > maxCost) throw new Error("That edit makes the part too long. Edits can only add up to " + num(allowance) + " characters.");
      if (text === seg.text) throw new Error("Nothing has changed yet.");
      const quoted = await quoteCost(text);
      const op = await encode("stories", "edit_segment", {
        editor: currentAddress(),
        story_id: String(storyId),
        seq: String(block.seq),
        new_text: text,
        expected_cost: quoted,
      });
      if (await send([op], status)) renderPage();
    } catch (error) {
      failure(status, error);
    } finally {
      save.disabled = false;
    }
  } }, [
    h("h3", { class: "h3" }, ["Edit this part"]),
    h("p", { class: "meta" }, ["The part stays credited to " + shortAddress(seg.author) + ", and readers see that it was edited."]),
    area,
    counter,
    h("div", { class: "actions" }, [save]),
    walletNote(),
    status,
  ]);
}

function removePanel(storyId, block) {
  const seg = block.segment;
  const status = statusBox();
  const confirm = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Remove this part"]);
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      const op = await encode("stories", "remove_segment", { editor: currentAddress(), story_id: String(storyId), seq: String(block.seq) });
      if (await send([op], status)) renderPage();
    } catch (error) {
      failure(status, error);
    } finally {
      confirm.disabled = false;
    }
  });
  return h("div", { class: "inline-panel card" }, [
    h("h3", { class: "h3" }, ["Remove this part?"]),
    h("p", { class: "body-2" }, [
      seg.hidden
        ? "This part is hidden while it's checked, so its Ink isn't returned."
        : shortAddress(seg.author) + " gets their " + num(seg.charged) + " Ink back. The removal is recorded on the public record.",
    ]),
    h("div", { class: "actions" }, [confirm]),
    walletNote(),
    status,
  ]);
}

/** "Report" under a part: a small form that logs the report on the blockchain. */
function reportControl(storyId, seq) {
  const wrap = h("span", { class: "report" });
  const open = h("button", { type: "button", class: "text-button report-toggle", "aria-expanded": "false" }, ["Report"]);
  append(wrap, open);
  open.addEventListener("click", async () => {
    if (wrap.querySelector(".report-form")) {
      wrap.querySelector(".report-form").remove();
      open.setAttribute("aria-expanded", "false");
      return;
    }
    open.setAttribute("aria-expanded", "true");
    const panel = h("div", { class: "report-form card" });
    append(wrap, panel);
    const address = currentAddress();
    if (!address) {
      append(panel,
        h("p", { class: "body-2" }, ["Connect a wallet to report this part. Reports are recorded on the blockchain."]),
        h("div", { class: "row" }, [connectButton(), h("a", { href: "#/report" }, ["Own the copyright? Send a notice instead"])])
      );
      return;
    }
    if (await hasReported(storyId, seq, address)) {
      append(panel, h("p", { class: "body-2" }, ["You've already reported this part. Thank you."]));
      return;
    }
    const reason = h("select", {}, [
      h("option", { value: "1" }, ["Copied from someone else's work"]),
      h("option", { value: "3" }, ["Spam"]),
      h("option", { value: "4" }, ["Unlawful or abusive"]),
      h("option", { value: "5" }, ["Something else"]),
    ]);
    const note = h("input", { type: "text", maxlength: "200", placeholder: "Optional: where it's copied from, or what's wrong" });
    const status = statusBox();
    const sendButton = h("button", { type: "submit", class: "btn btn-secondary btn-small" }, ["Send report"]);
    append(panel, h("form", { onSubmit: async (event) => {
      event.preventDefault();
      sendButton.disabled = true;
      try {
        const clean = normalizePasted(note.value).replace(/\n/g, " ").trim();
        if (clean && !checkStoryText(clean, false).ok) throw new Error("The note has characters that aren't allowed. Use plain text.");
        const op = await encode("stories", "report_segment", {
          reporter: address,
          story_id: String(storyId),
          seq: String(seq),
          reason: Number(reason.value),
          note: clean,
        });
        const sent = await send([op], status);
        if (sent) replace(panel, h("p", { class: "body-2" }, ["Reported. Thank you. If enough writers report it, it's hidden while it's checked."]));
      } catch (error) {
        failure(status, error);
      } finally {
        sendButton.disabled = false;
      }
    } }, [
      field("Why are you reporting it?", reason),
      field("Details", note, "Up to 200 characters. Reports are public."),
      h("div", { class: "actions" }, [sendButton, h("a", { href: "#/report" }, ["How reports work"])]),
      status,
    ]));
  });
  return wrap;
}

/** The required "I wrote this" confirmation, with a link to the Terms. */
function rightsBox() {
  const input = h("input", { type: "checkbox", required: true });
  const version = termsVersion();
  const node = h("div", { class: "rights" }, [
    h("label", { class: "check" }, [input, h("span", {}, [
      h("b", {}, ["I wrote this myself, or I have the right to use it."]),
      " Any short quotes are credited.",
    ])]),
    h("p", { class: "meta small" }, [
      "Required for every part. Copied text is hidden or removed, without a refund. ",
      h("a", { href: "#/terms" }, ["Terms of Use" + (version ? " (version " + version + ")" : "")]),
    ]),
  ]);
  return { input, node };
}

function termsVersion() {
  const cfg = state.overview && state.overview.storiesCfg;
  return cfg && cfg.terms_version ? Number(cfg.terms_version) : 0;
}

let composerCount = 0;
function composer(id, story, active, insertAfter, flags) {
  const after = Number(insertAfter || 0);
  composerCount += 1;
  const uid = "compose-" + composerCount;
  const box = h("section", { class: "composer card" + (after ? " inline-panel" : ""), "aria-labelledby": uid + "-title" });
  const lastAuthor = active.length ? active[active.length - 1].segment.author : "";
  append(box, after
    ? h("h3", { class: "h3", id: uid + "-title" }, ["Add text after this part"])
    : h("h2", { class: "h2", id: uid + "-title" }, ["Write the next part"]));

  const status = Number(story.status);
  if (status !== 1) {
    append(box, h("p", { class: "body-2" }, [
      status === 4 ? "This story is finished. Thank you to everyone who wrote it."
        : status === 5 ? "This story was archived after a long quiet spell. It can still be read."
        : "This story is closed for new parts. It is moving through its final edit.",
    ]));
    return box;
  }
  append(box, h("p", { class: "body-2" }, after
    ? ["Your text is read right after the part above, before what comes next."]
    : [
      lastAuthor ? "Pick up where " + shortAddress(lastAuthor) + " left off. " : "",
      "Your part is added to the end of the story, or starts a new chapter. To add something in the middle, use “+ Add text here” under any part.",
    ]));

  const address = currentAddress();
  if (!address) {
    append(box, 
      h("p", { class: "body-2" }, ["Connect a wallet to write. Reading never needs one."]),
      h("div", { class: "actions" }, [connectButton("Connect a wallet to write"), h("a", { href: "#/how" }, ["New here? How writing works"])])
    );
    return box;
  }
  if (!state.overview || !state.account) {
    append(box, state.accountError ? notice("bad", h("p", {}, [state.accountError])) : loadingLine("Reading your Ink…"));
    return box;
  }
  const invited = story.opener === address || !!(flags && (flags.editor || flags.allowed));
  if (inviteOnly(story) && !invited) {
    append(box, h("p", { class: "body-2" }, [
      "Only people the opener invites can write in this story. If you'd like to join, ask the opener for an invite link. Anyone can read it.",
    ]));
    return box;
  }
  if (inviteOnly(story) && story.opener !== address && !isActiveWriter(state.account.membership, state.account.now)) {
    append(box,
      h("p", { class: "body-2" }, [
        "You're invited. To write here you need an active Writer month. The opener can pay for it from the Share & invite panel, or you can buy one yourself. Your parts are paid from the writers' pool while it lasts.",
      ]),
      h("div", { class: "actions" }, [h("a", { class: "btn btn-secondary", href: "#/membership" }, ["See Writer months"])])
    );
    return box;
  }
  if (state.account.blocked) {
    append(box, notice("warn", h("p", {}, ["This wallet can no longer write on SwarmTales, after repeated takedowns of copied text. ", h("a", { href: "#/terms" }, ["Terms of Use"])])));
    return box;
  }

  const area = h("textarea", { rows: after ? "5" : "8", spellcheck: "true", "aria-describedby": uid + "-count" });
  area.addEventListener("paste", () => setTimeout(() => {
    const tidy = normalizePasted(area.value);
    if (tidy !== area.value) {
      area.value = tidy;
      update();
    }
  }, 0));
  const chapter = h("input", { type: "checkbox" });
  const citation = citationField();
  const aiBox = aiToggle();
  const ai = aiBox.input;
  const costText = h("b", {}, ["0 Ink"]);
  const shortText = h("span");
  const space = Math.max(0, Number(story.max_chars || 0) - Number(story.used_chars || 0));
  const min = Number(minContribution());
  const cap = Number(state.overview.storiesCfg.contribution_cap || 2000);
  const rights = rightsBox();
  const splitNote = h("span");
  const partsFor = (text) => splitIntoParts(text, cap, min, inkCost(normalizePasted(text).trim()) === space);
  const list = h("div");
  const status2 = statusBox();
  const button = h("button", { type: "submit", class: "btn btn-primary" }, ["Sign and add to the story"]);

  function update() {
    const text = normalizePasted(area.value).trim();
    const parts = text ? partsFor(text) : [];
    const cost = parts.reduce((sum, p) => sum + inkCost(p), 0);
    costText.textContent = num(cost) + " Ink";
    const bad = parts.map((p) => checkStoryText(p, true)).find((c) => !c.ok);
    if (!text) shortText.textContent = min ? "At least " + min + " characters" : "";
    else if (bad) shortText.textContent = bad.reason;
    else if (min && cost < min && cost !== space) shortText.textContent = num(min - cost) + " more to reach the " + min + "-character minimum";
    else shortText.textContent = "";
    splitNote.textContent = parts.length > 1
      ? "Long text: it will be added as " + parts.length + " parts in a row" +
        (parts.length > MAX_PARTS_PER_SIGNATURE || cost > MAX_CHARS_PER_SIGNATURE
          ? ". That's more than " + num(MAX_CHARS_PER_SIGNATURE) + " characters at once; send the first part of it, then the rest."
          : ", with one confirmation.")
      : "";
  }
  area.addEventListener("input", update);
  update();

  const form = h("form", { onSubmit: (event) => { event.preventDefault(); go(); } }, [
    after ? null : writingHelp(),
    field("Your part", area),
    h("div", { class: "counter", id: uid + "-count" }, [
      costText,
      inviteOnly(story)
        ? h("span", {}, ["Paid from the writers' pool (" + num(story.fund || 0) + " Ink left) while it has enough; then from your own " + num(state.account.ink) + " Ink"])
        : h("span", {}, ["You have " + num(state.account.ink) + " Ink"]),
      openEnded(story) ? null : h("span", {}, [num(space) + " characters left in this story"]),
      h("span", { "aria-live": "polite" }, [shortText]),
      h("span", { "aria-live": "polite" }, [splitNote]),
    ]),
    h("label", { class: "check" }, [chapter, "Start a new chapter"]),
    citation.node,
    aiBox.node,
    rights.node,
    list,
    h("div", { class: "actions" }, [button, h("p", { class: "meta" }, ["Your wallet asks you to confirm. The Ink is used once your part is added."])]),
    walletNote(),
    status2,
  ]);
  append(box, form);

  async function go() {
    list.replaceChildren();
    status2.replaceChildren();
    button.disabled = true;
    try {
      const flags = await writerFlags(id, address);
      const text = normalizePasted(area.value).trim();
      area.value = text;
      const parts = partsFor(text);
      if (parts.length > MAX_PARTS_PER_SIGNATURE || inkCost(text) > MAX_CHARS_PER_SIGNATURE) {
        append(list, problemsNotice(["That's more than " + num(MAX_CHARS_PER_SIGNATURE) + " characters at once. Send the first part of your text, then the rest."]));
        return;
      }
      if (new Set(parts).size !== parts.length) {
        append(list, problemsNotice(["Two of the parts would be exactly the same text. Each part has to be new."]));
        return;
      }
      // Check each part in order, as the contract will.
      let used = BigInt(story.used_chars || "0");
      let balance = BigInt(state.account.ink || "0");
      let pool = BigInt(story.fund || "0");
      let trialUsed = BigInt(state.account.trial || "0");
      const plans = [];
      for (const part of parts.length ? parts : [""]) {
        const plan = assessWrite({
          text: part,
          cap: state.overview.storiesCfg.contribution_cap,
          maxChars: story.max_chars,
          usedChars: used.toString(),
          balance: balance.toString(),
          status: story.status,
          visibility: story.visibility,
          privileged: story.opener === address || flags.editor,
          isOpener: story.opener === address,
          allowed: flags.allowed,
          fund: pool.toString(),
          writerActive: isActiveWriter(state.account.membership, state.account.now),
          promoClaimed: state.account.promo !== "0",
          trialUsed: trialUsed.toString(),
          trialLimit: state.overview.storiesCfg.trial_limit,
          minContribution: minContribution(),
          rightsConfirmed: rights.input.checked,
          blocked: state.account.blocked,
        });
        if (!plan.ok) {
          const where = parts.length > 1 ? ["Part " + (plans.length + 1) + " of " + parts.length + ":"] : [];
          append(list, problemsNotice(where.concat(plan.problems)));
          if (plan.problems.some((p) => /Writer month|Ink balance|Trial/.test(p))) {
            append(list, h("p", { class: "meta" }, [h("a", { href: "#/membership" }, ["Get more Ink on the Membership page"])]));
          }
          return;
        }
        plans.push(plan);
        const cost = BigInt(plan.cost);
        used += cost;
        if (plan.fundPays) pool -= cost;
        else balance -= cost;
        if (plan.usesTrial) trialUsed += cost;
      }
      status2.textContent = "Checking the Ink count with the story contract…";
      const quoted = await Promise.all(parts.map((part) => quoteCost(part)));
      const mismatch = quoted.findIndex((q, i) => q !== plans[i].cost);
      if (mismatch >= 0) {
        replace(status2, notice("warn", h("p", {}, ["The network counted " + quoted[mismatch] + " Ink and this page counted " + plans[mismatch].cost + ". Nothing was signed."])));
        return;
      }
      const ops = [];
      for (let i = 0; i < parts.length; i++) {
        ops.push(await encode("stories", "contribute", {
          author: address,
          story_id: String(id),
          text: parts[i],
          starts_chapter: i === 0 && chapter.checked,
          ai_assisted: ai.checked,
          expected_ink: plans[i].cost,
          rights_confirmed: true,
          terms_version: termsVersion(),
          // Later pieces of a split addition follow the piece before them.
          insert_after: i === 0 ? String(after) : "0",
          after_my_last: i > 0 && after > 0,
          citation: citation.value(),
        }));
      }
      const sent = await send(ops, status2);
      if (sent) {
        area.value = "";
        update();
        state.excerpts.delete(Number(id));
        loadLibrary(true).catch(() => {});
        await refreshAccount();
        renderPage();
      }
    } catch (error) {
      failure(status2, error);
    } finally {
      button.disabled = false;
    }
  }
  return box;
}

/** "Written with AI help" checkbox, with what it does spelled out and a live preview of the label. */
function aiToggle() {
  const input = h("input", { type: "checkbox", "aria-describedby": "ai-help" });
  // The example label is faded until ticked, so people can see what readers will see.
  const example = h("span", { class: "tag-ai tag-ai-preview" }, ["Written with AI help"]);
  input.addEventListener("change", () => example.classList.toggle("tag-ai-preview", !input.checked));
  const node = h("div", { class: "ai-toggle" }, [
    h("label", { class: "check" }, [input, "Written with AI help"]),
    h("p", { class: "meta small", id: "ai-help" }, [
      "Tick this if an AI tool wrote any of this part. Readers will see this label under it: ",
      example,
      " It costs the same Ink, and nothing else changes.",
    ]),
  ]);
  return { input, node };
}

function walletNote() {
  if (state.wallet && state.wallet.id === "testwallet") {
    return h("p", { class: "meta small" }, ["Signed by the test wallet in this browser. It needs tKOIN for mana."]);
  }
  if (state.wallet && state.wallet.id === "koinvault") {
    const decision = state.account ? vaultManaDecision(state.account.mana, VAULT_MANA_CEILING) : null;
    return h("p", { class: "meta small" }, [decision && decision.blocked ? decision.message : VAULT_MANA_EXPLANATION]);
  }
  const low = state.account ? kondorManaNote(state.account.mana, network.mainnet) : "";
  return h("p", { class: "meta small" }, [low || kondorHint(network.mainnet)]);
}

/* ------------------------------------------------------------------ */
/* open a story                                                        */
/* ------------------------------------------------------------------ */

const OPEN_KINDS = {
  short: { kind: 2, name: "short story", title: "Open a short story", min: 10000, max: 99999, priceKey: "shortPrice", starterKey: "starter_short",
    blurb: "10,000 to 99,999 characters. Quick to fill, good for a first story." },
  book: { kind: 1, name: "book", title: "Open a book", min: 100000, max: 1000000, priceKey: "bookPrice", starterKey: "starter_book",
    blurb: "100,000 to 1,000,000 characters. A long project with many chapters and writers." },
};

function renderOpen(page) {
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
      h("div", {}, [h("dt", {}, ["Starter Ink"]), h("dd", {}, [num(state.overview.shopCfg[kindInfo.starterKey]) + " Ink"])]),
      h("div", {}, [h("dt", {}, ["Length"]), h("dd", {}, ["No fixed length. It can be finished once it reaches " + num(kindInfo.min) + " characters, and it can grow to " + num(kindInfo.max) + "."])]),
    ]),
    h("p", { class: "body-2 small" }, [
      "Your first " + fullPrice + " open projects cost the normal price. Each one after that doubles it, up to " + ceiling +
        "× the normal price. Finishing or archiving a story frees its slot.",
    ]),
    h("p", { class: "body-2 small" }, [
      "One confirmation in your wallet does two things: it lets the Shop take exactly the price above, then opens the story. The starter Ink pays for your first part.",
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
      });
      const sent = await send([approve, open], status);
      if (sent) {
        await refreshAccount();
        try {
          state.overview = await loadOverview();
        } catch {
          /* keep the old overview */
        }
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

/* ------------------------------------------------------------------ */
/* membership                                                          */
/* ------------------------------------------------------------------ */

function renderMembership(page) {
  setMeta("Membership", "A Writer membership on SwarmTales comes with Ink, your writing allowance. Reading is always free.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container, 
    h("p", { class: "eyebrow" }, ["Membership"]),
    h("h1", { class: "title" }, ["Ink for writing"]),
    h("p", { class: "lede" }, ["Reading is always free. To write, you need Ink: from a promo link, a Writer membership, or an invited story whose opener pays from a writers' pool."])
  );
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
  if (cfg.paused) append(writerCard, notice("warn", h("p", {}, ["The Shop is paused for maintenance. Please check back soon."])));
  else if (!address) append(writerCard, connectButton());
  else if (!state.account) append(writerCard, loadingLine("Reading your balance…"));
  else {
    append(writerCard, buyButton, h("p", { class: "meta small" }, ["You hold " + tokenAmount(state.account.token) + ". One confirmation approves exactly this price and buys the month."]), walletNote(), buyStatus);
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
        const buy = await encode("shop", "buy_membership", { payer: address, tier: 2, months: 1, token: contracts.paymentToken, max_price: plan.price });
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
      button.disabled = !address || !state.account || !writerNow || !!cfg.paused;
      button.addEventListener("click", async () => {
        replace(packStatus);
        button.disabled = true;
        try {
          if (BigInt(state.account.token || "0") < BigInt(pack.price)) {
            throw new Error("Your " + contracts.paymentSymbol + " balance is below this pack's price.");
          }
          const approve = await encode("token", "approve", { owner: address, spender: contracts.shop, value: pack.price });
          const buy = await encode("shop", "buy_pack", { payer: address, pack: pack.item, token: contracts.paymentToken, max_price: pack.price });
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
    if (!address) append(packCard, h("p", { class: "meta" }, ["Connect a wallet to buy a pack."]));
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

/* ------------------------------------------------------------------ */
/* promo landing                                                       */
/* ------------------------------------------------------------------ */

function landingSteps(stepTwoTitle, stepTwoText) {
  const address = currentAddress();
  return h("ol", { class: "steps" }, [
    h("li", {}, [
      address ? h("span", { class: "step-dot done", "aria-hidden": "true" }, [icons.check()]) : h("span", { class: "step-dot", "aria-hidden": "true" }, ["1"]),
      h("div", {}, [
        h("p", {}, [h("b", {}, [address ? "Wallet connected" : "Connect your wallet"])]),
        h("p", { class: "meta" }, [address ? walletName() + " · " + shortAddress(address) : "Kondor on a computer. It's free to install."]),
      ]),
    ]),
    h("li", {}, [
      h("span", { class: "step-dot", "aria-hidden": "true" }, ["2"]),
      h("div", {}, [h("p", {}, [h("b", {}, [stepTwoTitle])]), h("p", { class: "meta" }, [stepTwoText])]),
    ]),
  ]);
}

function trustNote(text) {
  return h("div", { class: "trust-note" }, [icons.shield(), h("p", {}, [text])]);
}

// Link secrets read from the address bar, by route. The page keeps them here
// and takes them out of the URL at once, so they stay out of browser history
// and anything that copies the address (AB-013). Re-renders read them here.
const linkSecrets = new Map();

function takeLinkSecret() {
  const route = location.hash.split("?")[0];
  const fromUrl = linkSecretFromHash(location.hash);
  if (fromUrl) {
    linkSecrets.set(route, fromUrl);
    try {
      history.replaceState(history.state, "", location.pathname + location.search + hashWithoutSecret(location.hash));
    } catch {
      /* the secret stays in the URL; the page still works */
    }
  }
  return linkSecrets.get(route) || "";
}

function renderPromo(page, campaignId) {
  setMeta("Free Ink", "Claim free Ink to start writing on SwarmTales.");
  const linkSecret = takeLinkSecret();
  const main = h("div", { class: "landing" });
  append(page, main);
  const card = h("div", { class: "card card-lg" }, [
    h("p", { class: "eyebrow" }, ["A gift of Ink"]),
    h("h1", { class: "title" }, ["Free Ink to start writing"]),
    h("p", { class: "lede" }, ["Ink is your writing allowance on SwarmTales. Claim it once with your wallet, then add a part to any open story."]),
  ]);
  const facts = h("dl", { class: "facts" });
  append(main, card, facts);

  if (!linkSecret) {
    append(card, notice("warn", h("p", {}, ["This link is missing its key, the part after the “?k=”. Open the full link exactly as it was shared."])));
    return;
  }
  if (!state.overview) {
    append(card, loadingLine(state.chainError ? "This page will work when the network answers." : "Checking the promo…"));
    return;
  }
  const cfg = state.overview.shopCfg;
  read("shop", "get_campaign", { campaign_id: String(campaignId) }).then((campaign) => {
    if (!campaign) return;
    append(facts, 
      h("div", {}, [h("dt", {}, ["You receive"]), h("dd", {}, [num(campaign.amount) + " Ink"])]),
      formatUtc(campaign.ends_at) ? h("div", {}, [h("dt", {}, ["Offer ends"]), h("dd", {}, [formatUtc(campaign.ends_at)])]) : null,
      h("div", {}, [h("dt", {}, ["Limit"]), h("dd", {}, ["One claim per wallet"])])
    );
    if (!campaign.enabled) append(card, notice("warn", h("p", {}, ["This promo has been switched off."])));
  }).catch(() => {});

  const address = currentAddress();
  append(card, landingSteps("Claim with one confirmation", "Your wallet asks you to approve. Claiming is free."));
  const status = statusBox();
  const actions = h("div", { class: "actions" });
  append(card, actions, status);
  if (!address) {
    append(actions, connectButton());
  } else if (!state.account) {
    append(actions, loadingLine("Reading your wallet…"));
  } else if (state.account.promo !== "0") {
    append(actions, notice("info", h("p", {}, ["This wallet has already claimed a promo. Each wallet can claim once."])), h("a", { class: "btn btn-secondary", href: "#/stories" }, ["Find a story to write in"]));
  } else {
    const button = h("button", { type: "button", class: "btn btn-primary" }, ["Claim free Ink"]);
    append(actions, button, h("a", { class: "btn btn-secondary", href: "#/stories" }, ["Read first"]));
    append(card, walletNote());
    button.addEventListener("click", async () => {
      status.replaceChildren();
      button.disabled = true;
      try {
        const plan = assessPromo({
          campaignId,
          hasLinkKey: !!linkSecret,
          alreadyClaimed: state.account.promo !== "0",
          paused: !!cfg.paused,
          promoEnabled: !!cfg.promo_enabled,
        });
        if (!plan.ok) {
          append(status, problemsNotice(plan.problems));
          return;
        }
        status.textContent = "Preparing a claim that only your wallet can use…";
        const signature = await signPromoClaim(linkSecret, contracts.shop, campaignId, address);
        const op = await encode("shop", "claim_promo", {
          account: address,
          campaign_id: String(campaignId).trim(),
          signer: "",
          // koilib takes bytes fields as base64url text.
          signature: utils.encodeBase64url(signature),
        });
        const sent = await send([op], status);
        if (sent) {
          await refreshAccount();
          append(status, notice("ok", h("p", {}, ["Your Ink has arrived. ", h("a", { href: "#/stories" }, ["Find a story to write in"]), "."])));
        }
      } catch (error) {
        failure(status, error);
      } finally {
        button.disabled = false;
      }
    });
  }
  append(card, trustNote("This link works only for the wallet that uses it. Nothing secret is sent to a server, and a copy of your confirmation can't be reused by anyone else."));
}

/* ------------------------------------------------------------------ */
/* invite landing                                                      */
/* ------------------------------------------------------------------ */

function renderJoin(page, storyId, inviteId) {
  setMeta("You're invited to write", "An invitation to write in a private SwarmTales story.");
  const linkSecret = takeLinkSecret();
  const main = h("div", { class: "landing" });
  append(page, main);
  const card = h("div", { class: "card card-lg" }, [loadingLine("Opening your invitation…")]);
  const facts = h("dl", { class: "facts" });
  append(main, card, facts);

  if (!linkSecret) {
    replace(card, 
      h("h1", { class: "title" }, ["This invite link is incomplete"]),
      notice("warn", h("p", {}, ["The link is missing its key, the part after the “?k=”. Open the full link exactly as it was shared, or ask for a new one."]))
    );
    return;
  }

  Promise.all([
    read("stories", "get_story", { story_id: String(storyId) }),
    read("stories", "get_invite", { story_id: String(storyId), invite_id: String(inviteId) }).catch(() => null),
    firstLine(Number(storyId)),
  ]).then(([story, invite, opening]) => {
    if (!story || !Number(story.status || 0)) {
      replace(card, h("h1", { class: "title" }, ["We couldn't find this story"]), h("p", { class: "body-2" }, ["The invite points to a story that doesn't exist on " + network.name + "."]));
      return;
    }
    const address = currentAddress();
    replace(card, 
      h("p", { class: "eyebrow" }, ["You're invited to write in"]),
      h("h1", { class: "title" }, [story.title || "Untitled"]),
      h("p", { class: "lede" }, [shortAddress(story.opener) + " invited you to this " + "private story. Only invited writers can add to it."]),
      opening ? h("blockquote", { class: "excerpt" }, ["“" + clip(opening, 220) + "”"]) : null,
      landingSteps("Join with one confirmation", "Your wallet asks you to approve. Joining is free.")
    );
    if (invite) {
      const left = Math.max(0, Number(invite.max_uses || 0) - Number(invite.uses || 0));
      append(facts, 
        h("div", {}, [h("dt", {}, ["Invites left"]), h("dd", {}, [num(left) + " of " + num(invite.max_uses)])]),
        h("div", {}, [h("dt", {}, ["Link expires"]), h("dd", {}, [formatUtc(invite.expires_at) || "Never"])]),
        h("div", {}, [h("dt", {}, ["Writing needs"]), h("dd", {}, ["An active Writer month (the opener may pay for it). Your parts are paid from the opener's writers' pool (" + num(story.fund || 0) + " Ink left) while it lasts."])])
      );
      if (invite.revoked) append(card, notice("warn", h("p", {}, ["The opener has switched this invite off. Ask them for a new link."])));
    }
    const status = statusBox();
    const actions = h("div", { class: "actions" });
    append(card, actions, status);
    if (!address) {
      append(actions, connectButton(), h("a", { class: "btn btn-secondary", href: "#/stories/" + storyId }, ["Read it first"]));
    } else {
      const button = h("button", { type: "button", class: "btn btn-primary" }, ["Join this story"]);
      append(actions, button, h("a", { class: "btn btn-secondary", href: "#/stories/" + storyId }, ["Read it first"]));
      append(card, walletNote());
      button.addEventListener("click", async () => {
        status.replaceChildren();
        button.disabled = true;
        try {
          status.textContent = "Preparing a request that only your wallet can use…";
          const signature = await signInviteJoin(linkSecret, contracts.stories, storyId, inviteId, address);
          const op = await encode("stories", "join_with_invite", {
            account: address,
            story_id: String(storyId),
            invite_id: String(inviteId),
            signature: utils.encodeBase64url(signature),
          });
          const sent = await send([op], status);
          if (sent) {
            await refreshAccount();
            append(status, notice("ok", h("p", {}, ["You've joined. Taking you to the story… ", h("a", { href: "#/stories/" + storyId + "?joined=1" }, ["Go now"])])));
            setTimeout(() => { location.hash = "#/stories/" + storyId + "?joined=1"; }, 1500);
          }
        } catch (error) {
          failure(status, error);
        } finally {
          button.disabled = false;
        }
      });
    }
    append(card, trustNote("This link works only for the wallet that uses it. Nothing secret is sent to a server, and a copy of your confirmation can't be reused by anyone else."));
  }).catch((error) => {
    replace(card, notice("bad", h("p", {}, [explainFailure(error)])));
  });
}

/* ------------------------------------------------------------------ */
/* my stories, sharing and invites                                     */
/* ------------------------------------------------------------------ */

/** The id of the story this wallet opened most recently, as text. */
async function newestOpenedStory(address) {
  const ids = await openedStoryIds(address);
  return ids.length ? ids[ids.length - 1] : "";
}

async function openedStoryIds(address) {
  const ids = [];
  for (let start = 0; start < 500; start += 50) {
    const page = await read("stories", "get_opener_stories", { account: address, start: String(start), limit: 50 });
    const values = page && Array.isArray(page.values) ? page.values : [];
    ids.push(...values.map(String));
    if (values.length < 50) break;
  }
  return ids;
}

/** Private stories this wallet was invited to (or is an editor of). */
async function invitedStoryIds(address) {
  const library = (await loadLibrary()) || (await listStories((await read("stories", "get_config", {})).next_story_id || "1"));
  const rows = (library && library.stories ? library.stories : [])
    .filter((row) => Number(row.story.visibility) !== 1 && row.story.opener !== address);
  const out = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      const flags = await writerFlags(row.id, address).catch(() => ({ editor: false, allowed: false }));
      if (flags.allowed || flags.editor) out.push(String(row.id));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

async function writtenStoryIds(address) {
  const ids = new Set();
  for (let start = 0; start < 1000; start += 50) {
    const page = await read("stories", "get_author_segments", { account: address, start: String(start), limit: 50 });
    const values = page && Array.isArray(page.values) ? page.values : [];
    for (const ref of values) ids.add(String(ref.story_id));
    if (values.length < 50) break;
  }
  return Array.from(ids);
}

async function storyRows(ids) {
  const rows = await Promise.all(ids.map(async (id) => {
    const story = await read("stories", "get_story", { story_id: String(id) }).catch(() => null);
    return story && Number(story.status || 0) ? { id: Number(id), story } : null;
  }));
  return rows.filter(Boolean).sort((a, b) => Number(b.story.last_activity_at || 0) - Number(a.story.last_activity_at || 0));
}

function renderMine(page) {
  setMeta("My stories", "The stories you opened or write in, including private ones.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container,
    h("p", { class: "eyebrow" }, ["Your shelf"]),
    h("h1", { class: "title" }, ["My stories"]),
    h("p", { class: "lede" }, ["Every story you opened or wrote in, including private ones that don't appear in Discover."])
  );
  // Reading progress: this browser's places, plus bookmarks saved to the wallet.
  const readingSlot = h("div");
  append(container, readingSlot);
  const showPlaces = (places) => {
    if (!places.length) return replace(readingSlot);
    replace(readingSlot, h("section", { class: "mine-section" }, [
      h("h2", { class: "h2" }, ["Continue reading"]),
      h("p", { class: "meta" }, ["Saved in this browser as you read. Bookmarks too."]),
      h("ul", { class: "reading-list" }, places.map((p) => h("li", { class: "reading-item" }, [
        h("div", {}, [
          h("b", {}, [p.title || "Story " + p.id]),
          h("span", { class: "meta small" }, [
            p.last ? " Chapter " + p.last.chapter + " \u00b7 " + p.last.percent + "% read" : "",
            p.mark ? (p.last ? " \u00b7 " : " ") + "\u2605 bookmark in Chapter " + p.mark.chapter : "",
          ]),
        ]),
        h("div", { class: "row" }, [
          p.last ? h("a", { class: "btn btn-primary btn-small", href: "#/stories/" + p.id + "?resume=1" }, ["Continue"]) : null,
          p.mark ? h("a", { class: "btn btn-secondary btn-small", href: "#/stories/" + p.id + "?mark=1" }, ["Bookmark"]) : null,
          h("button", { type: "button", class: "text-button", onClick: (e) => { reading.forget(contracts.stories, p.id); e.target.closest("li").remove(); } }, ["Forget"]),
        ]),
      ]))),
    ]));
  };
  showPlaces(reading.list(contracts.stories).slice(0, 12));
  if (currentAddress()) {
    (async () => {
      const me = currentAddress();
      const res = await read("stories", "get_reading_places", { reader: me, start: "0", limit: 50 }).catch(() => null);
      const chainPlaces = res && Array.isArray(res.values) ? res.values : [];
      for (const cp of chainPlaces) {
        const local = reading.load(contracts.stories, cp.story_id);
        const at = Number(cp.at || 0) * 1000;
        if (!local.mark || at > local.mark.at) {
          const st = await read("stories", "get_story", { story_id: String(cp.story_id) }).catch(() => ({}));
          reading.setMark(contracts.stories, cp.story_id, { seq: Number(cp.seq), chapter: cp.chapter, percent: cp.percent, title: st.title || "" }, undefined, at);
        }
      }
      if (chainPlaces.length) showPlaces(reading.list(contracts.stories).slice(0, 12));
    })().catch(() => {});
  }
  const address = currentAddress();
  if (!address) {
    append(container, h("div", { class: "card", style: null }, [
      h("p", { class: "body-2" }, ["Connect a wallet to see your stories."]),
      connectButton(),
    ]));
    return;
  }
  const opened = h("div", { class: "card-grid" }, [loadingLine("Reading your stories…")]);
  const written = h("div", { class: "card-grid" }, [loadingLine("Reading the stories you write in…")]);
  append(container,
    h("section", { class: "mine-section" }, [h("h2", { class: "h2" }, ["Opened by you"]), opened]),
    h("section", { class: "mine-section" }, [
      h("h2", { class: "h2" }, ["Stories you write in or are invited to"]),
      written,
    ])
  );
  (async () => {
    const mineIds = await openedStoryIds(address);
    const openedRows = await storyRows(mineIds);
    replace(opened, ...(openedRows.length
      ? openedRows.map((row) => storyCard(row))
      : [h("div", { class: "empty" }, [h("p", { class: "serif" }, ["You haven't opened a story yet."]), h("p", {}, [h("a", { class: "link-arrow", href: "#/open" }, ["Open a story", icons.arrow()])])])]));
    const invitedIds = await invitedStoryIds(address).catch(() => []);
    const writtenIds = Array.from(new Set([...(await writtenStoryIds(address)), ...invitedIds])).filter((id) => !mineIds.includes(id));
    const writtenRows = await storyRows(writtenIds);
    replace(written, ...(writtenRows.length
      ? writtenRows.map((row) => storyCard(row))
      : [h("div", { class: "empty" }, [h("p", { class: "meta" }, ["You haven't written in or been invited to anyone else's story yet."])])]));
  })().catch((error) => replace(opened, notice("bad", h("p", {}, [explainFailure(error)]))));
}

function copyButton(text, labelText) {
  const button = h("button", { type: "button", class: "btn btn-secondary btn-small" }, [labelText || "Copy link"]);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = labelText || "Copy link"; }, 2000);
    } catch {
      button.textContent = "Select the link and copy it";
    }
  });
  return button;
}

function siteBase() {
  return location.href.split("#")[0];
}

const VISIBILITY_HELP = {
  1: "Public: listed in Discover. Anyone with Ink and a Writer month (or a promo trial) can write.",
  2: "Private: not in Discover. Only you, your editors and people you invite can write, paid from the writers' pool while it lasts. Invited writers need a Writer month. The words are still public on the blockchain.",
  3: "Private: not in Discover. Only you, your editors and people you invite can write, paid from the writers' pool while it lasts. Invited writers need a Writer month. The words are still public on the blockchain.",
};

/** Share & invite: shown to the opener (and, partly, to editors). */
function sharePanel(id, story, me, flags) {
  const isOpener = !!me && story.opener === me;
  const isEditor = !!me && !!(flags && flags.editor);
  const vis = Number(story.visibility);
  const link = siteBase() + "#/stories/" + id;
  const isPrivate = vis !== 1;
  const canManage = (isOpener || isEditor) && Number(story.status) < 4;
  const panel = h("section", { class: "card share-panel", "aria-labelledby": "share-title" }, [
    h("h2", { class: "aside-title", id: "share-title" }, [isOpener ? "Share & invite" : "Share"]),
    h("p", { class: "body-2 small" }, [isPrivate
      ? "Private: only people you invite can write. Anyone with the reading link can read."
      : "Public: listed in Discover. Anyone can read, and anyone with a Writer month can write."]),
  ]);
  if (/[?&]new=1/.test(location.hash) && isOpener) {
    panel.prepend(notice("ok", h("p", {}, ["Your story is open. It's saved under ", h("a", { href: "#/mine" }, ["My stories"]), "."])));
  }
  // One tidy block per job. The first one the opener needs is open.
  const tool = (title, what, body, open) => h("details", { class: "share-tool", open: open ? true : null }, [
    h("summary", {}, [h("b", {}, [title]), h("span", { class: "meta small" }, [what])]),
    h("div", { class: "share-tool-body" }, body),
  ]);
  const readingTool = tool(
    isPrivate ? "Share for reading" : "Share the story",
    isPrivate ? "A link to read the story. It does not let anyone write." : "Anyone with this link can read it, and write with a Writer month.",
    [
      h("p", { class: "mono small share-link" }, [link]),
      h("div", { class: "row" }, [copyButton(link, isPrivate ? "Copy reading link" : "Copy link")]),
    ],
    !(isPrivate && isOpener && canManage)
  );
  if (!canManage) {
    append(panel, readingTool);
    return panel;
  }

  if (isPrivate && isOpener) {
    const uses = h("input", { type: "number", min: "1", max: "1000", value: "5", inputmode: "numeric" });
    const days = h("input", { type: "number", min: "1", max: "365", value: "14", inputmode: "numeric" });
    const out = h("div");
    const status = statusBox();
    const make = h("button", { type: "submit", class: "btn btn-primary btn-small" }, ["Create invite link"]);
    append(panel, tool("Invite writers", "A link that lets people join and write. Send it privately.", [h("form", { class: "invite-form", onSubmit: async (event) => {
      event.preventDefault();
      make.disabled = true;
      replace(out);
      try {
        const n = Number(uses.value);
        const d = Number(days.value);
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("People per link must be 1 to 1,000.");
        if (!Number.isInteger(d) || d < 1 || d > 365) throw new Error("Days must be 1 to 365.");
        const key = generateLinkKey();
        const expires = String(Math.floor(Date.now() / 1000) + d * 86400);
        const op = await encode("stories", "create_invite", {
          opener: me, story_id: String(id), link_signer: key.address, max_uses: n, expires_at: expires,
        });
        const before = Number((await read("stories", "get_story", { story_id: String(id) })).next_invite_id || 1);
        const sent = await send([op], status);
        // Read the invite back and use the id that holds this link's key
        // (AB-008): never a link for an invite that isn't on the record.
        const showLink = async () => {
          const inviteId = await findInviteId({
            before,
            linkSigner: key.address,
            readNextId: async () => Number((await read("stories", "get_story", { story_id: String(id) })).next_invite_id || 0),
            readInvite: (n) => read("stories", "get_invite", { story_id: String(id), invite_id: String(n) }),
          });
          if (!inviteId) return false;
          const invite = buildInviteLink(siteBase(), id, inviteId, key.secret);
          replace(out,
            notice("ok", [
              h("p", {}, ["Your invite link is ready. It works for " + plural(n, "person", "people") + " for " + plural(d, "day") + "."]),
              h("p", { class: "mono small share-link" }, [invite]),
            ]),
            h("div", { class: "row" }, [copyButton(invite, "Copy invite link")]),
            h("p", { class: "meta small" }, ["Copy it now: this page can't show it again. Anyone who has it can join, so send it privately."])
          );
          return true;
        };
        if (sent && await showLink()) return;
        // Not confirmed yet, or not found: this page still holds the link's
        // key, so the opener can look again instead of losing the link.
        const stillMissing = h("p", { class: "meta small" });
        const again = h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
          again.disabled = true;
          stillMissing.textContent = "";
          try {
            if (!(await showLink())) stillMissing.textContent = "It isn't on the record yet. Try again in a minute.";
          } catch (error) {
            stillMissing.textContent = explainFailure(error);
          } finally {
            again.disabled = false;
          }
        } }, ["Look for the invite again"]);
        replace(out,
          notice("warn", h("p", {}, [
            sent ? "The invite was sent, but we couldn't find it on the record yet." : "This invite isn't confirmed, so there's no link to share yet.",
            " Keep this page open and look again in a minute. If it never appears, create a new invite: this one's link can't be used.",
          ])),
          h("div", { class: "row" }, [again]),
          stillMissing
        );
      } catch (error) {
        failure(status, error);
      } finally {
        make.disabled = false;
      }
    } }, [
      h("p", { class: "meta small" }, ["Each person who opens the link joins with one confirmation. Their parts are paid from the writers' pool while it has enough Ink. They also need a Writer month (see below)."]),
      h("div", { class: "form-grid" }, [field("People", uses), field("Days it works", days)]),
      h("div", { class: "actions" }, [make]),
      status,
      out,
    ])], true));
  }
  append(panel, readingTool);
  if (isPrivate && isOpener) {
    append(panel,
      tool("Writers' pool", num(story.fund || 0) + " Ink left. Pays for your writers' parts.", [poolSection(id, story, me)]),
      tool("Pay for a Writer month", "Invited writers need one. You can pay for theirs.", [giftSection(me)]));
  }

  if (isOpener) {
    const who = h("input", { type: "text", placeholder: "Wallet address (starts with 1)", autocomplete: "off", spellcheck: "false" });
    const status = statusBox();
    const act = (allowed) => async () => {
      try {
        const account = who.value.trim();
        if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(account)) throw new Error("That doesn't look like a wallet address.");
        const op = await encode("stories", "set_editor", { opener: me, story_id: String(id), account, allowed });
        if (await send([op], status)) who.value = "";
      } catch (error) {
        failure(status, error);
      }
    };
    append(panel, tool("Editors", "People who can fix and remove parts, like you.", [h("div", { class: "editor-form" }, [
      h("p", { class: "meta small" }, [vis === 1
        ? "Editors can fix and remove parts like you can, and write without a Writer month. They use their own Ink. Up to 10."
        : "Editors can fix and remove parts like you can. In this story they write like invited writers: from the pool, with a Writer month. Up to 10."]),
      field("Editor's wallet", who),
      h("div", { class: "row" }, [
        h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: act(true) }, ["Add editor"]),
        h("button", { type: "button", class: "text-button", onClick: act(false) }, ["Remove editor"]),
      ]),
      status,
    ])]));
  }
  return panel;
}

/**
 * Can this wallet write in a private story right now? The opener always can;
 * editors and invited wallets need an active Writer month. While the account
 * is still loading, say yes and let the writing box explain.
 */
function canWriteInvited(story, me, flags) {
  if (!me) return false;
  if (story.opener === me) return true;
  if (!(flags && (flags.editor || flags.allowed))) return false;
  if (!state.account) return true;
  return isActiveWriter(state.account.membership, state.account.now);
}

/**
 * Under a hidden part: the writer can name the source (a matching citation
 * brings the part back automatically within the hour), and the opener or an
 * editor can restore it.
 */
function hiddenHelp(storyId, seq, segment, story, ctx) {
  const me = currentAddress();
  if (!me || !ctx) return null;
  const isAuthor = segment.author === me;
  const canRestore = !!ctx.canEdit;
  if (!isAuthor && !canRestore) return null;
  const status = statusBox();
  const box = h("div", { class: "hidden-help" });
  if (isAuthor) {
    const input = h("input", { type: "text", maxlength: "200", placeholder: "e.g. \u201cPride and Prejudice\u201d, Jane Austen", value: segment.citation || "" });
    append(box,
      h("p", { class: "meta small" }, [
        "This is your part. If it quotes a book or website, name the source. When it matches what the checker found, the part comes back by itself within about an hour.",
      ]),
      field("Source", input),
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
        try {
          const op = await encode("stories", "set_citation", { account: me, story_id: String(storyId), seq: String(seq), citation: input.value.trim() });
          if (await send([op], status)) renderPage();
        } catch (error) {
          failure(status, error);
        }
      } }, ["Save the source"]));
  }
  if (canRestore) {
    append(box,
      h("p", { class: "meta small" }, [
        "As the story's " + (story.opener === me ? "opener" : "editor") + ", you can bring this part back if you're satisfied it's fine. The copy checker won't hide it again.",
      ]),
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
        try {
          const op = await encode("stories", "restore_segment", { actor: me, story_id: String(storyId), seq: String(seq), note: "" });
          if (await send([op], status)) renderPage();
        } catch (error) {
          failure(status, error);
        }
      } }, ["Restore this part"]));
  }
  append(box, status);
  return box;
}

/** "Quoting someone?": an optional source shown under the part. Cited quotes are left alone by the copy checker. */
function citationField() {
  const input = h("input", { type: "text", maxlength: "200", placeholder: "e.g. \u201cPride and Prejudice\u201d, Jane Austen" });
  const node = h("details", { class: "more-options citation-box" }, [
    h("summary", {}, ["Quoting someone? Name the source (optional)"]),
    h("p", { class: "meta small" }, [
      "If your part quotes a book, poem, song or website, name it here. Readers see it under your part as \u201cSource: \u2026\u201d, and the copy checker leaves quotes from a named source alone. Keep quotes short; whole pages copied from someone else's work still aren't allowed.",
    ]),
    field("Source", input),
  ]);
  return { node, value: () => input.value.trim() };
}

/**
 * Remember where the reader is: the part nearest the top third of the screen,
 * saved a moment after they stop scrolling. Starts only once they scroll, so
 * opening a story doesn't overwrite their place.
 */
function watchReading(article, storyId, placeOf) {
  if (typeof IntersectionObserver === "undefined") return;
  let current = 0;
  let timer = null;
  let started = false;
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const seq = Number(e.target.dataset.seq);
      if (e.isIntersecting) visible.add(seq);
      else visible.delete(seq);
    }
    const order = [...article.querySelectorAll(".seg:not(.seg-muted)")].map((el) => Number(el.dataset.seq));
    const top = order.find((s) => visible.has(s));
    if (top) current = top;
    if (!started || !current) return;
    clearTimeout(timer);
    timer = setTimeout(() => reading.saveLast(contracts.stories, storyId, placeOf(current)), 800);
  }, { rootMargin: "-25% 0px -60% 0px" });
  article.querySelectorAll(".seg:not(.seg-muted)").forEach((el) => observer.observe(el));
  const start = () => { started = true; };
  window.addEventListener("scroll", start, { once: true, passive: true });
  window.addEventListener("hashchange", () => { observer.disconnect(); clearTimeout(timer); window.removeEventListener("scroll", start); }, { once: true });
}

/* ------------------------------------------------------------------ */
/* finishing a story: close (free), final edit, publish                 */
/* ------------------------------------------------------------------ */

/** Can the opener close this story now? Mirrors the contract's rule. */
function closeReadyLocal(story) {
  const used = Number(story.used_chars || 0);
  const max = Number(story.max_chars || 0);
  return Number(story.status) === 2 || used >= kindMin(story) || used + 100 >= max;
}

/** The finished book as plain text, in reading order, with chapter headings. */
function bookText(story, segments) {
  const all = segments.map((segment, i) => ({ segment, index: i + 1, seq: i + 1, insertAfter: Number(segment.insert_after || 0) }));
  const ordered = readingOrder(all).filter((b) => Number(b.segment.status) !== 2 && !b.segment.hidden);
  const lines = [String(story.title || "Untitled")];
  let chapter = 0;
  for (const b of ordered) {
    if (!chapter || b.segment.starts_chapter) {
      chapter += 1;
      lines.push("", "Chapter " + chapter, "");
    }
    lines.push(String(b.segment.text || ""));
  }
  return { text: lines.join("\n"), ordered };
}

/** Story page, opener only: what's left to finish the book. */
function finishPanel(id, story, me) {
  if (!me || story.opener !== me) return null;
  const status = Number(story.status);
  const box = h("section", { class: "card finish-panel", "aria-labelledby": "finish-title" }, [
    h("h2", { class: "aside-title", id: "finish-title" }, ["Finish the book"]),
  ]);
  if (status === 4) {
    append(box, h("p", { class: "body-2 small" }, ["This story is finished and published."]),
      h("a", { class: "btn btn-secondary btn-small", href: "#/stories/" + id + "/book" }, ["Read or download the book"]));
    return box;
  }
  if (status === 3) {
    append(box,
      h("p", { class: "body-2 small" }, ["Writing is closed. Review each part, then publish. " + num(story.final_cursor || 0) + " of " + num(story.segment_count || 0) + " parts reviewed."]),
      h("a", { class: "btn btn-primary btn-small", href: "#/stories/" + id + "/finish" }, ["Continue the final edit"]));
    return box;
  }
  if (status !== 1 && status !== 2) return null;
  if (!closeReadyLocal(story)) {
    append(box, h("p", { class: "meta small" }, [
      "You can close this story for its final edit once it reaches " + num(kindMin(story)) + " characters (" +
        num(Math.max(0, kindMin(story) - Number(story.used_chars || 0))) + " to go). Finishing is free.",
    ]));
    return box;
  }
  const statusBoxEl = statusBox();
  append(box,
    h("p", { class: "body-2 small" }, [
      "Ready when you are. Finishing is free and takes three steps: ",
      h("b", {}, ["close"]), " (writing stops), ", h("b", {}, ["final edit"]), " (keep, lightly fix, or remove each part), and ",
      h("b", {}, ["publish"]), ". Leftover pool Ink comes back to you.",
    ]),
    h("button", { type: "button", class: "btn btn-primary btn-small", onClick: async (e) => {
      e.target.disabled = true;
      try {
        const op = await encode("stories", "close_story", { opener: me, story_id: String(id), token: contracts.paymentToken });
        if (await send([op], statusBoxEl)) location.hash = "#/stories/" + id + "/finish";
      } catch (error) {
        failure(statusBoxEl, error);
      } finally {
        e.target.disabled = false;
      }
    } }, ["Close writing and start the final edit"]),
    statusBoxEl);
  return box;
}

const FINAL_BATCH = 20;
const FINAL_BATCH_UNITS = 20000;

/** The final edit: parts in the order they were written, 20 at a time. */
function renderFinish(page, id) {
  setMeta("Final edit", "Review each part, then publish the finished book.");
  const container = h("div", { class: "container page narrow" }, [loadingLine("Opening the final edit…")]);
  append(page, container);
  loadStory(id).then(async ({ story, segments }) => {
    const me = currentAddress();
    const head = [
      h("p", { class: "breadcrumb" }, [h("a", { href: "#/stories/" + id }, ["← Back to the story"])]),
      h("p", { class: "eyebrow" }, ["Final edit"]),
      h("h1", { class: "title" }, [story.title || "Untitled"]),
    ];
    if (!me || story.opener !== me) {
      replace(container, ...head, h("p", { class: "body-2" }, ["Only the story's opener can do the final edit. Connect the opener's wallet."]), connectButton());
      return;
    }
    if (Number(story.status) === 4) {
      replace(container, ...head, notice("ok", h("p", {}, ["This story is published. ", h("a", { href: "#/stories/" + id + "/book" }, ["Read or download the book"]), "."])));
      return;
    }
    if (Number(story.status) !== 3) {
      replace(container, ...head, h("p", { class: "body-2" }, ["Close the story first: on the story page, open “Finish the book”."]));
      return;
    }
    const cursor = Number(story.final_cursor || 0);
    const total = Number(story.segment_count || 0);
    const status = statusBox();
    const hiddenLeft = segments.filter((s, i) => i + 1 > cursor && Number(s.status) === 1 && s.hidden).length;
    replace(container, ...head,
      h("p", { class: "lede" }, ["Go through each part: keep it, tidy it lightly, or remove it. Most parts can simply be kept. " +
        "Shortening or removing a part returns its Ink to the writer (or to the pool). Everything here is free."]),
      h("div", { class: "progress-label" }, [h("span", {}, [num(cursor) + " of " + num(total) + " parts reviewed"])]));
    if (cursor >= total) {
      // Everything reviewed: publish.
      const { text } = bookText(story, segments);
      const hex = await sha256Hex(text);
      const words = text.split(/\s+/).filter(Boolean).length;
      const publish = h("button", { type: "button", class: "btn btn-primary" }, ["Publish the finished book"]);
      publish.addEventListener("click", async () => {
        publish.disabled = true;
        try {
          const bytes = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
          const op = await encode("stories", "finalize", {
            finalizer: me, story_id: String(id), pdf_uri: (siteBase() + "#/stories/" + id + "/book").slice(0, 200), pdf_hash: utils.encodeBase64url(bytes),
          });
          if (await send([op], status)) location.hash = "#/stories/" + id + "/book";
        } catch (error) {
          failure(status, error);
        } finally {
          publish.disabled = false;
        }
      });
      append(container,
        notice("ok", h("p", {}, ["Every part is reviewed. The finished book has about " + num(words) + " words."])),
        h("p", { class: "body-2" }, [
          "Publishing locks the book for good and records its fingerprint on the blockchain (",
          h("span", { class: "mono small" }, [hex.slice(0, 16) + "…"]),
          "), so anyone can check a copy is the real one. Readers can download it from the book page. Leftover pool Ink returns to you.",
        ]),
        h("div", { class: "actions" }, [publish]), status);
      return;
    }
    // The next batch, in the order the contract expects.
    const rows = [];
    for (let seq = cursor + 1; seq <= total && rows.length < FINAL_BATCH; seq++) {
      const seg = segments[seq - 1];
      if (!seg || Number(seg.status) !== 1) continue; // removed parts are skipped by the contract
      const mode = h("select", { "aria-label": "Part " + seq }, seg.hidden
        ? [h("option", { value: "3" }, ["Remove (hidden part)"])]
        : [h("option", { value: "1" }, ["Keep"]), h("option", { value: "2" }, ["Edit lightly"]), h("option", { value: "3" }, ["Remove"])]);
      const original = Number(seg.original_cost || 0);
      const allowance = Math.max(Math.floor(original / 10), Math.min(original, 20));
      const maxCost = Number(seg.charged || 0) + allowance;
      const area = h("textarea", { rows: "5", hidden: true }, []);
      area.value = seg.text || "";
      const counter = h("p", { class: "meta small", hidden: true });
      const syncCount = () => { counter.textContent = num(inkCost(area.value.trim())) + " of at most " + num(maxCost) + " characters (light edits only)."; };
      area.addEventListener("input", syncCount);
      mode.addEventListener("change", () => { area.hidden = mode.value !== "2"; counter.hidden = mode.value !== "2"; syncCount(); });
      const row = { seq, seg, mode, area, maxCost };
      rows.push(row);
      append(container, h("div", { class: "final-row" + (seg.hidden ? " seg-muted" : "") }, [
        h("div", { class: "final-row-head" }, [
          h("span", { class: "meta small" }, ["Part " + seq + " · " + shortAddress(seg.author) + (seg.hidden ? " · hidden" : "")]),
          mode,
        ]),
        h("p", { class: "final-row-text" }, [seg.hidden ? "(hidden while it's checked: it can only be removed here, or restored on the story page first)" : clip(seg.text || "", 400)]),
        area, counter,
      ]));
    }
    const save = h("button", { type: "button", class: "btn btn-primary" }, ["Save these " + rows.length + " parts"]);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const items = [];
        let used = 0;
        for (const r of rows) {
          const m = Number(r.mode.value);
          if (m === 2) {
            const t = normalizePasted(r.area.value).trim();
            const cost = inkCost(t);
            const check = checkStoryText(t, true);
            if (!check.ok) throw new Error("Part " + r.seq + ": " + check.reason);
            if (cost > r.maxCost) throw new Error("Part " + r.seq + ": the edit makes it too long. Light edits only.");
            if (used + cost > FINAL_BATCH_UNITS) break; // the rest goes in the next batch
            used += cost;
            items.push({ seq: String(r.seq), mode: 2, text: t, expected_cost: String(cost) });
          } else {
            items.push({ seq: String(r.seq), mode: m, text: "", expected_cost: "0" });
          }
        }
        if (!items.length) throw new Error("Nothing to save.");
        const op = await encode("stories", "submit_final_batch", { finalizer: me, story_id: String(id), items });
        if (await send([op], status)) renderPage();
      } catch (error) {
        failure(status, error);
      } finally {
        save.disabled = false;
      }
    });
    append(container,
      hiddenLeft ? notice("warn", h("p", {}, [plural(hiddenLeft, "hidden part") + " left. Hidden parts must be removed here, or restored on the story page, before the book can be published."])) : null,
      h("div", { class: "actions" }, [save, h("p", { class: "meta" }, ["One confirmation saves this group. Then the next group appears."])]),
      status);
  }).catch((error) => replace(container, notice("bad", h("p", {}, [explainFailure(error)]))));
}

/** The finished book: read, print or save as PDF, or download as text. Free. */
function renderBook(page, id) {
  const container = h("div", { class: "container page narrow book-page" }, [loadingLine("Opening the book…")]);
  append(page, container);
  loadStory(id).then(async ({ story, segments }) => {
    setMeta(story.title || "Book", "A finished SwarmTales book.");
    const { text, ordered } = bookText(story, segments);
    const hex = await sha256Hex(text);
    const onChain = story.pdf_hash ? Array.from(utils.decodeBase64url(story.pdf_hash), (b) => b.toString(16).padStart(2, "0")).join("") : "";
    const finished = Number(story.status) === 4;
    const writers = new Map();
    for (const b of ordered) writers.set(b.segment.author, (writers.get(b.segment.author) || 0) + Number(b.segment.current_cost || 0));
    const download = () => {
      const blob = new Blob([text + "\n\nWritten on SwarmTales by: " + [...writers.keys()].join(", ") + "\n"], { type: "text/plain;charset=utf-8" });
      const a = h("a", { href: URL.createObjectURL(blob), download: (story.title || "book").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + ".txt" });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    const body = [];
    let chapter = 0;
    for (const b of ordered) {
      if (!chapter || b.segment.starts_chapter) {
        chapter += 1;
        body.push(h("h2", { class: "h3 book-chapter" }, ["Chapter " + chapter]));
      }
      body.push(h("p", { class: "book-text" }, [b.segment.text || ""]));
    }
    replace(container,
      h("div", { class: "no-print" }, [
        h("p", { class: "breadcrumb" }, [h("a", { href: "#/stories/" + id }, ["← Back to the story"])]),
        h("div", { class: "row" }, [
          h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => window.print() }, ["Print or save as PDF"]),
          h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: download }, ["Download as text"]),
        ]),
        finished
          ? h("p", { class: "meta small" }, [onChain === hex
            ? "✓ This matches the fingerprint recorded on the blockchain when the book was published."
            : "This copy doesn't match the published fingerprint (the page may have changed since). The record on the blockchain is the original."])
          : h("p", { class: "meta small" }, ["Preview: this story isn't published yet."]),
      ]),
      h("h1", { class: "title book-title" }, [story.title || "Untitled"]),
      ...body,
      h("section", { class: "book-credits" }, [
        h("h2", { class: "h3" }, ["Written by"]),
        h("ul", {}, [...writers.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => h("li", { class: "mono small" }, [w]))),
        h("p", { class: "meta small" }, ["Written together on SwarmTales. Every part is recorded on the Koinos blockchain, story " + id + "."]),
      ]));
  }).catch((error) => replace(container, notice("bad", h("p", {}, [explainFailure(error)]))));
}

/** The opener's writers' pool: balance and top-up. */
function poolSection(id, story, me) {
  const amount = h("input", { type: "number", min: "1", value: "5000", step: "1", inputmode: "numeric" });
  const status = statusBox();
  const add = h("button", { type: "submit", class: "btn btn-secondary btn-small" }, ["Add to the pool"]);
  const open = Number(story.status) === 1;
  return h("form", { class: "pool-form", onSubmit: async (event) => {
    event.preventDefault();
    add.disabled = true;
    try {
      const n = amount.value.trim();
      if (!/^[1-9][0-9]*$/.test(n)) throw new Error("Enter a whole number of Ink, 1 or more.");
      if (BigInt(n) > BigInt(state.account && state.account.ink ? state.account.ink : "0")) {
        throw new Error("You have " + num(state.account ? state.account.ink : 0) + " Ink. Buy an Ink pack on the Membership page first.");
      }
      const op = await encode("stories", "top_up_fund", { opener: me, story_id: String(id), amount: n });
      if (await send([op], status)) {
        await refreshAccount();
        renderPage();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      add.disabled = false;
    }
  } }, [
    h("p", { class: "body-2" }, [h("b", {}, [num(story.fund || 0) + " Ink left"]), " of " + num(story.fund_added || 0) + " you've put in."]),
    h("p", { class: "meta small" }, [
      "Parts in this story are paid from the pool while it has enough Ink for them; after that, writers pay with their own Ink. " +
        "When a part is shortened or removed, its Ink goes back to the pool. Whatever is left returns to you when the story is finished or archived.",
    ]),
    open ? h("div", { class: "form-grid" }, [field("Ink to add", amount, "You have " + num(state.account ? state.account.ink : 0) + " Ink")]) : null,
    open ? h("div", { class: "actions" }, [add, h("a", { href: "#/membership", class: "meta" }, ["Buy an Ink pack"])]) : null,
    status,
  ]);
}

/** Pay for someone else's Writer month (their membership and Ink go to them). */
function giftSection(me) {
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
      const theirs = await read("shop", "get_membership", { account });
      const active = isActiveWriter(theirs || {}, state.account ? state.account.now : 0);
      status.textContent = active
        ? "They already have a Writer month until " + (formatUtc(theirs.paid_until) || "later") + ". This adds one more month."
        : "";
      const approve = await encode("token", "approve", { owner: me, spender: contracts.shop, value: plan.price });
      const buy = await encode("shop", "buy_membership", { payer: me, tier: 2, months: 1, token: contracts.paymentToken, beneficiary: account, max_price: plan.price });
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

/** A short guide shown above the writing box. */
function writingHelp() {
  return h("details", { class: "more-options writing-help" }, [
    h("summary", {}, ["How adding and editing work"]),
    h("ul", { class: "how-list" }, [
      h("li", {}, [h("b", {}, ["Add at the end."]), " Use this box. Your part goes after everything written so far. Tick “Start a new chapter” to begin one."]),
      h("li", {}, [h("b", {}, ["Add in the middle."]), " Click “+ Add text here” under any part. Your text appears directly below that part, before what came next. Anyone who can write here can do this."]),
      h("li", {}, [h("b", {}, ["Edit."]), " Only the story's opener and editors can edit, and only lightly: fix typos, tidy a sentence. A part can grow by about 10% at most. Shortening returns Ink to the writer. The part stays credited to its writer and shows “Edited by”."]),
      h("li", {}, [h("b", {}, ["Remove."]), " Opener and editors can remove a part. The writer gets their Ink back, unless the part was hidden as possible copying."]),
      h("li", {}, [h("b", {}, ["Quoting someone?"]), " Open \u201cQuoting someone? Name the source\u201d and write the book or site. It shows under your part, and the copy checker leaves named quotes alone."]),
      h("li", {}, [h("b", {}, ["Want to change someone else's part?"]), " Add your own text after it instead, or ask the opener. Bigger rewrites happen in the final edit, once the story is full."]),
      h("li", {}, [h("b", {}, ["Ink."]), " 1 Ink per letter. In public stories every writer pays for their own words. In private stories the opener's writers' pool pays while it has enough. Long text is split into parts automatically."]),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* terms of use and reporting                                          */
/* ------------------------------------------------------------------ */

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function chainTermsHashHex() {
  const raw = state.overview && state.overview.storiesCfg && state.overview.storiesCfg.terms_hash;
  if (!raw) return "";
  try {
    return Array.from(utils.decodeBase64url(raw), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

function renderTerms(page) {
  setMeta("Terms of Use", "The SwarmTales Terms of Use: your writing, what you may post, how copied text is handled, and Ink.");
  const container = h("div", { class: "container page" });
  const column = h("div", { class: "reader-column stack" }, [loadingLine("Loading the Terms of Use…")]);
  append(page, container);
  append(container, column);
  const version = termsVersion() || 1;
  fetch(SITE.termsPath + "v" + version + ".md", { cache: "no-cache" })
    .then((res) => {
      if (!res.ok) throw new Error("The Terms of Use file could not be loaded.");
      return res.text();
    })
    .then(async (text) => {
      // The same text can arrive with Unix or Windows line endings (Git
      // converts them on Windows), so either form counts as a match.
      const unix = text.replace(/\r\n/g, "\n");
      const forms = [text, unix, unix.replace(/\n/g, "\r\n")];
      const hashes = await Promise.all(forms.map((t) => sha256Hex(t).catch(() => "")));
      const onChain = chainTermsHashHex();
      const local = hashes.includes(onChain) ? onChain : hashes[1];
      let check;
      if (!onChain) {
        check = notice("info", h("p", {}, ["These terms are not yet published on the blockchain. Once they are, this page checks that the text matches the published fingerprint."]));
      } else if (onChain === local) {
        check = notice("ok", h("p", {}, ["Version " + version + ". This text matches the fingerprint recorded on the blockchain, so it hasn't been changed since it was published."]));
      } else {
        check = notice("bad", h("p", {}, ["Warning: this text does not match the fingerprint recorded on the blockchain for version " + version + ". Please report this."]));
      }
      replace(column, ...renderMarkdown(text), check);
    })
    .catch((error) => replace(column, notice("bad", h("p", {}, [explainFailure(error)]))));
}

function renderReportPage(page) {
  setMeta("Report copied text", "How to report copied text on SwarmTales, and how rights holders send a copyright notice.");
  const email = SITE.copyrightEmail;
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container, h("div", { class: "reader-column stack" }, [
    h("p", { class: "eyebrow" }, ["Keeping stories original"]),
    h("h1", { class: "title" }, ["Report copied text"]),
    h("p", { class: "lede" }, ["SwarmTales stories should be written by the people who post them. Here's how to tell us when something isn't."]),

    h("section", { class: "how-section" }, [
      h("h2", { class: "h3" }, ["If you're a reader or a writer"]),
      h("p", { class: "body-2" }, ["Every part of a story has a small ", h("b", {}, ["Report"]), " link under it. Pick a reason and, if you like, say where it was copied from. Your report is recorded publicly on the blockchain."]),
      h("ul", { class: "how-list" }, [
        h("li", {}, ["Each wallet can report a part once."]),
        h("li", {}, ["When three different wallets that have written on SwarmTales report the same part, it's hidden automatically while it's checked."]),
        h("li", {}, ["An automated checker also compares new writing with other stories and with well-known books, and hides close matches."]),
        h("li", {}, ["Hidden parts don't appear on SwarmTales, in the finished book, or in collectible editions."]),
      ]),
    ]),

    h("section", { class: "how-section" }, [
      h("h2", { class: "h3" }, ["If you own the copyright"]),
      h("p", { class: "body-2" }, [
        "Send a copyright notice by email to ",
        email ? h("a", { href: "mailto:" + email }, [email]) : h("b", {}, ["(the contact address is being set up)"]),
        ". You don't need a wallet. Please include:",
      ]),
      h("ol", { class: "how-list" }, [
        h("li", {}, ["Your name, and your signature (typing your full name is fine)."]),
        h("li", {}, ["The work you own that was copied."]),
        h("li", {}, ["Where it was copied on SwarmTales: the link to the story and the part number (or quote its first words)."]),
        h("li", {}, ["How to contact you: address, phone number and email."]),
        h("li", {}, ["A statement that you believe in good faith the use isn't authorized by you, your agent, or the law."]),
        h("li", {}, ["A statement that the information in your notice is accurate and, under penalty of perjury, that you are the owner or are authorized to act for the owner."]),
      ]),
      h("p", { class: "body-2" }, ["What happens next:"]),
      h("ul", { class: "how-list" }, [
        h("li", {}, ["The part is hidden promptly."]),
        h("li", {}, ["The writer can send a counter-notice. If none arrives within 14 days, the part is taken down for good: its text is cleared from SwarmTales' contract storage, it's left out of future editions, and the writer isn't refunded."]),
        h("li", {}, ["Each takedown counts against the writer. After three, their wallet can no longer write on SwarmTales."]),
        h("li", {}, ["The blockchain records that the part was hidden or taken down and why, with a reference number. Your personal details are never put on the blockchain."]),
      ]),
    ]),

    h("section", { class: "how-section" }, [
      h("h2", { class: "h3" }, ["If your part was hidden and you think that's wrong"]),
      h("p", { class: "body-2" }, [
        "Send a counter-notice to the same address: your name and signature, which part was hidden, a statement under penalty of perjury that you believe it was hidden by mistake, and your contact details with consent to the jurisdiction of the courts where you live. ",
        "If the person who complained doesn't start a court case within 10 to 14 business days, the part is shown again.",
      ]),
    ]),

    h("section", { class: "how-section" }, [
      h("h2", { class: "h3" }, ["Good to know"]),
      h("p", { class: "body-2" }, [
        "SwarmTales runs on a public blockchain. Removing a part clears it from SwarmTales and its contract, but copies in the blockchain's history can't be erased by anyone. ",
        "Read the ", h("a", { href: "#/terms" }, ["Terms of Use"]), " for the full rules.",
      ]),
    ]),
  ]));
}

/* ------------------------------------------------------------------ */
/* how it works                                                        */
/* ------------------------------------------------------------------ */

function renderHow(page) {
  setMeta("How it works", "How SwarmTales works: reading is free, a wallet replaces a password, mana replaces fees, and Ink is a writing allowance with no cash value.");
  const container = h("div", { class: "container page" });
  append(page, container);
  const column = h("div", { class: "reader-column stack" }, [
    h("p", { class: "eyebrow" }, ["Start here"]),
    h("h1", { class: "title" }, ["How SwarmTales works"]),
    h("p", { class: "lede" }, ["SwarmTales is a place to write stories together, one part at a time. Here is everything you need to know, in plain words."]),
    ...renderHowSections(),
    h("div", { class: "card" }, [
      h("h2", { class: "h3" }, ["Ready?"]),
      h("p", { class: "body-2" }, ["Pick a story that's open for writing, read it to the end, and add what happens next."]),
      h("div", { class: "row" }, [
        h("a", { class: "btn btn-primary", href: "#/stories" }, ["Find a story"]),
        h("a", { class: "btn btn-secondary", href: KONDOR_STORE, target: "_blank", rel: "noopener noreferrer" }, ["Get the Kondor wallet"]),
      ]),
    ]),
  ]);
  append(container, column);
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

async function send(operations, status) {
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

/* ------------------------------------------------------------------ */
/* wallet sheet                                                        */
/* ------------------------------------------------------------------ */

function openWallet() {
  state.notice = "";
  renderDialog();
  if (!dialog.open) dialog.showModal();
}

function renderDialog() {
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
  const using = state.wallet === testWallet;
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
        using ? null : h("button", { type: "button", class: "btn btn-primary btn-small", onClick: useTestWallet }, ["Use the test wallet"]),
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

boot();
