import "@fontsource/literata/latin-400.css";
import "@fontsource/literata/latin-400-italic.css";
import "@fontsource/literata/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "./style.css";

import { utils } from "koilib";
import { contracts, configProblems, network } from "./config.js";
import {
  encode,
  listStories,
  loadAccount,
  loadOverview,
  loadStory,
  lookupTransaction,
  quoteCost,
  read,
  verifyChain,
  writerFlags,
} from "./chain.js";
import { explainFailure } from "./lib/errors.js";
import { KIND, STORY_STATUS, TIER, VISIBILITY, label } from "./lib/labels.js";
import { VAULT_MANA_CEILING, formatMana, formatUnits, formatUtc, kondorManaNote, shortAddress } from "./lib/money.js";
import { assessOpen, assessPromo, assessWrite, assessWriterBuy, isActiveWriter } from "./lib/rules.js";
import { checkStoryText, inkCost } from "./lib/text.js";
import {
  KONDOR_HINT,
  VAULT_MANA_EXPLANATION,
  clearSavedSession,
  createKondorWallet,
  createVaultWallet,
  loadSavedSession,
} from "./wallet.js";
import { fetchVaultConfig, vaultManaDecision, vaultPairingDecision } from "./lib/vaultApi.js";
import { linkSecretFromHash, signInviteJoin, signPromoClaim } from "./lib/links.js";
import { append, h, icons, replace } from "./ui/dom.js";
import { renderHowSections } from "./ui/how.js";

const problems = configProblems();
const kondor = createKondorWallet();
const vault = createVaultWallet(network);
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
  if (parts[0] === "stories" && isId(parts[1])) return { name: "story", id: parts[1] };
  if (parts[0] === "stories" || parts[0] === "discover") return { name: "discover" };
  if (parts[0] === "open") return { name: "open" };
  if (parts[0] === "how") return { name: "how" };
  if (parts[0] === "shop" || parts[0] === "membership") return { name: "membership" };
  if (parts[0] === "promo" && isId(parts[1])) return { name: "promo", campaign: parts[1] };
  if (parts[0] === "join" && isId(parts[1]) && isId(parts[2])) return { name: "join", storyId: parts[1], inviteId: parts[2] };
  return { name: "home" };
}

function currentAddress() {
  return state.wallet && state.wallet.getAddress ? state.wallet.getAddress() : null;
}

function walletName() {
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

function percent(story) {
  const max = Number(story.max_chars || 0);
  const used = Number(story.used_chars || 0);
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
}

function statusPill(story) {
  const status = Number(story.status || 0);
  if (status === 1) {
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
  return [h("span", {}, [num(story.used_chars) + " of " + num(story.max_chars) + " characters"]), h("span", {}, [plural(story.contributor_count, "writer")])];
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
    const first = values.find((segment) => Number(segment.status) !== 2);
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
    ["membership", "#/membership", "Membership"],
  ];
  replace(nav, ...items.map(([name, href, text]) => {
    const current = here === name || (name === "discover" && here === "story");
    return h("a", { href, "aria-current": current ? "page" : null }, [text]);
  }));
}

function boot() {
  const app = document.getElementById("app");
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
        h("p", {}, [h("a", { href: "#/how" }, ["How it works"]), " · ", h("a", { href: "https://github.com/bawcejawn/Swarmtales", rel: "noopener" }, ["Source code"])]),
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
  const alerts = [];
  if (state.chainError) alerts.push(notice("bad", h("p", {}, ["The story network isn't answering right now. " + state.chainError])));
  if (state.notice) alerts.push(notice("warn", h("p", {}, [state.notice])));
  if (alerts.length) append(page, h("div", { class: "container" }, alerts));
  if (here.name === "discover") renderDiscover(page);
  else if (here.name === "story") renderReader(page, here.id);
  else if (here.name === "open") renderOpen(page);
  else if (here.name === "membership") renderMembership(page);
  else if (here.name === "promo") renderPromo(page, here.campaign);
  else if (here.name === "join") renderJoin(page, here.storyId, here.inviteId);
  else if (here.name === "how") renderHow(page);
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
    h("div", { class: "card-top" }, [h("p", { class: "meta" }, [meta]), statusPill(story)]),
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
    const active = [];
    const removed = [];
    bundle.segments.forEach((segment, index) => {
      const block = { segment, index: index + 1 };
      if (Number(segment.status) === 2) removed.push(block);
      else active.push(block);
    });
    const firstText = active.length ? active[0].segment.text : "";
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
      const area = composeAnchor.querySelector("textarea, button");
      if (area) setTimeout(() => area.focus({ preventScroll: true }), 350);
    };

    const isOpen = Number(story.status) === 1;
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
        progressBar(story, [h("span", {}, [num(story.used_chars) + " of " + num(story.max_chars) + " characters"]), h("span", {}, [percent(story) + "%"])]),
        isOpen ? h("button", { type: "button", class: "btn btn-primary btn-block", onClick: goWrite }, ["Write the next part"]) : null,
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
    if (!chapters.length) append(article, h("div", { class: "empty" }, [h("p", {}, ["No text has been written yet."])]));
    chapters.forEach((chapter, i) => {
      append(article, h("h3", { class: "chapter-title" + (i === 0 ? " first" : ""), id: "chapter-" + chapter.number }, ["Chapter " + chapter.number]));
      for (const block of chapter.blocks) append(article, segmentView(block, story));
    });
    if (removed.length) {
      const details = h("details", { class: "removed" }, [h("summary", {}, [plural(removed.length, "removed part") + " (kept on the record)"])]);
      for (const block of removed) append(details, segmentView(block, story));
      append(article, details);
    }

    append(column, 
      h("div", { class: "chapter-bar" }, [
        h("p", { class: "eyebrow muted" }, [cats.join(" · ") || label(KIND, story.kind)]),
        h("label", { class: "check" }, [toggle, "Show who wrote what"]),
      ]),
      article,
      composeAnchor
    );
    append(composeAnchor, composer(id, story, active));

    const aside = h("aside", { class: "reader-aside", "aria-label": "About this story" }, [
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
      head,
      h("div", { class: "reader-layout" }, [h("div", { class: "reader-main" }, [column]), aside])
    );
    const writersNote = aside.querySelector(".writers + p");
    if (writersNote) writersNote.style.marginTop = "12px";
  }).catch((error) => {
    replace(container, notice("bad", h("p", {}, [explainFailure(error)])));
  });
}

function segmentView(block, story) {
  const segment = block.segment;
  const author = segment.author || "";
  const edited = segment.last_edited_by && segment.last_edited_by !== "" && Number(segment.last_edited_at || 0) > 0;
  const notes = [];
  if (edited) {
    notes.push(h("span", { class: "edit-note" }, [
      "Edited by " + shortAddress(segment.last_edited_by) + (formatUtc(segment.last_edited_at) ? " on " + formatUtc(segment.last_edited_at).split(",")[0] : "") +
        ". Credit stays with " + shortAddress(author) + "; the first version is kept on the public record.",
    ]));
  }
  if (segment.ai_assisted) notes.push(h("span", { class: "tag-ai" }, ["Written with AI help"]));
  return h("div", { class: "seg" }, [
    h("p", { class: "seg-author" }, [h("b", {}, [shortAddress(author)]), h("span", {}, [(author === story.opener ? "opener · " : "") + num(segment.current_cost || segment.charged) + " Ink"])]),
    h("div", {}, [
      h("p", { class: "seg-text" }, [segment.text || ""]),
      notes.length ? h("div", { class: "seg-notes" }, notes) : null,
    ]),
  ]);
}

function composer(id, story, active) {
  const box = h("section", { class: "composer card", "aria-labelledby": "compose-title" });
  const lastAuthor = active.length ? active[active.length - 1].segment.author : "";
  append(box, h("h2", { class: "h2", id: "compose-title" }, ["Write the next part"]));

  const status = Number(story.status);
  if (status !== 1) {
    append(box, h("p", { class: "body-2" }, [
      status === 4 ? "This story is finished. Thank you to everyone who wrote it." : "This story is full and no longer takes new parts. It is moving through its final edit.",
    ]));
    return box;
  }
  append(box, h("p", { class: "body-2" }, [
    lastAuthor ? "Pick up where " + shortAddress(lastAuthor) + " left off. " : "",
    "Your part is added to the end of the story, or starts a new chapter.",
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

  const area = h("textarea", { rows: "8", spellcheck: "true", "aria-describedby": "compose-count" });
  const chapter = h("input", { type: "checkbox" });
  const ai = h("input", { type: "checkbox" });
  const costText = h("b", {}, ["0 Ink"]);
  const shortText = h("span");
  const space = Math.max(0, Number(story.max_chars || 0) - Number(story.used_chars || 0));
  const min = Number(minContribution());
  const list = h("div");
  const status2 = statusBox();
  const button = h("button", { type: "submit", class: "btn btn-primary" }, ["Sign and add to the story"]);

  function update() {
    const text = area.value;
    const check = checkStoryText(text, true);
    const cost = text ? inkCost(text) : 0;
    costText.textContent = num(cost) + " Ink";
    if (!text) shortText.textContent = min ? "At least " + min + " characters" : "";
    else if (!check.ok) shortText.textContent = check.reason;
    else if (min && cost < min && cost !== space) shortText.textContent = num(min - cost) + " more to reach the " + min + "-character minimum";
    else shortText.textContent = "";
  }
  area.addEventListener("input", update);
  update();

  const form = h("form", { onSubmit: (event) => { event.preventDefault(); go(); } }, [
    field("Your part", area),
    h("div", { class: "counter", id: "compose-count" }, [
      costText,
      h("span", {}, ["You have " + num(state.account.ink) + " Ink"]),
      h("span", {}, [num(space) + " characters left in this story"]),
      h("span", { "aria-live": "polite" }, [shortText]),
    ]),
    h("div", { class: "row" }, [
      h("label", { class: "check" }, [chapter, "Start a new chapter"]),
      h("label", { class: "check" }, [ai, "Written with AI help"]),
    ]),
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
      const plan = assessWrite({
        text: area.value,
        cap: state.overview.storiesCfg.contribution_cap,
        maxChars: story.max_chars,
        usedChars: story.used_chars || "0",
        balance: state.account.ink,
        status: story.status,
        visibility: story.visibility,
        privileged: story.opener === address || flags.editor,
        allowed: flags.allowed,
        writerActive: isActiveWriter(state.account.membership, state.account.now),
        promoClaimed: state.account.promo !== "0",
        trialUsed: state.account.trial,
        trialLimit: state.overview.storiesCfg.trial_limit,
        minContribution: minContribution(),
      });
      if (!plan.ok) {
        append(list, problemsNotice(plan.problems));
        if (plan.problems.some((p) => /Writer month|Ink balance|Trial/.test(p))) {
          append(list, h("p", { class: "meta" }, [h("a", { href: "#/membership" }, ["Get more Ink on the Membership page"])]));
        }
        return;
      }
      status2.textContent = "Checking the Ink count with the story contract…";
      const quoted = await quoteCost(area.value);
      if (quoted !== plan.cost) {
        replace(status2, notice("warn", h("p", {}, ["The network counted " + quoted + " Ink and this page counted " + plan.cost + ". Nothing was signed."])));
        return;
      }
      const op = await encode("stories", "contribute", {
        author: address,
        story_id: String(id),
        text: area.value,
        starts_chapter: chapter.checked,
        ai_assisted: ai.checked,
        expected_ink: plan.cost,
      });
      const sent = await send([op], status2);
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

function walletNote() {
  if (state.wallet && state.wallet.id === "koinvault") {
    const decision = state.account ? vaultManaDecision(state.account.mana, VAULT_MANA_CEILING) : null;
    return h("p", { class: "meta small" }, [decision && decision.blocked ? decision.message : VAULT_MANA_EXPLANATION]);
  }
  const low = state.account ? kondorManaNote(state.account.mana) : "";
  return h("p", { class: "meta small" }, [low || "If Kondor refuses, tick “Use free mana” in its window and try again."]);
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
  const facts = h("div", { class: "card" }, [
    h("h2", { class: "h3" }, ["What opening includes"]),
    h("dl", { class: "facts" }, [
      h("div", {}, [h("dt", {}, ["Price"]), h("dd", {}, [tokenAmount(state.overview[kindInfo.priceKey])])]),
      h("div", {}, [h("dt", {}, ["Starter Ink"]), h("dd", {}, [num(state.overview.shopCfg[kindInfo.starterKey]) + " Ink"])]),
      h("div", {}, [h("dt", {}, ["Length"]), h("dd", {}, [num(kindInfo.min) + " to " + num(kindInfo.max) + " characters"])]),
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
  const length = h("input", { type: "number", min: String(kindInfo.min), max: String(kindInfo.max), value: String(kindInfo.min), inputmode: "numeric" });
  const categories = state.overview.categories.filter((item) => item.active);
  const cat1 = h("select", {}, [h("option", { value: "" }, ["Choose one"]), ...categories.map((item) => h("option", { value: String(item.id) }, [item.name]))]);
  const cat2 = h("select", {}, [h("option", { value: "0" }, ["None"]), ...categories.map((item) => h("option", { value: String(item.id) }, [item.name]))]);
  const visibility = h("select", {}, [
    h("option", { value: "1" }, ["Public: listed, anyone can write"]),
    h("option", { value: "2" }, ["Unlisted: only people with the link find it"]),
    h("option", { value: "3" }, ["Private: only people you invite can write"]),
  ]);
  const free = h("input", { type: "number", min: "0", max: "5", value: "0", inputmode: "numeric" });
  const edition = h("input", { type: "number", min: "0", value: "0", inputmode: "numeric" });
  const opening = h("textarea", { rows: "8", spellcheck: "true" });
  const costLine = h("p", { class: "counter" }, ["0 Ink"]);
  opening.addEventListener("input", () => {
    const check = checkStoryText(opening.value, true);
    costLine.textContent = !opening.value ? "0 Ink" : check.ok ? num(inkCost(opening.value)) + " Ink, paid from your starter Ink" : check.reason;
  });
  const ai = h("input", { type: "checkbox" });
  const list = h("div");
  const status = statusBox();
  const button = h("button", { type: "submit", class: "btn btn-primary" }, ["Open the " + kindInfo.name]);

  append(formSlot, h("form", { onSubmit: (event) => { event.preventDefault(); go(); } }, [
    field("Title", title),
    h("div", { class: "form-grid" }, [
      field("Category", cat1),
      field("Second category", cat2, "Optional"),
      field("Who can write", visibility),
      field("Length", length, "In characters, " + num(kindInfo.min) + " to " + num(kindInfo.max)),
    ]),
    field("The first part", opening, "At least " + (Number(minContribution()) || 1) + " characters. Readers see this first."),
    costLine,
    h("label", { class: "check" }, [ai, "Written with AI help"]),
    h("details", { class: "removed" }, [
      h("summary", {}, ["More options"]),
      h("div", { class: "form-grid" }, [
        field("Free chapters", free, "0 to 5"),
        field("Contributor Edition minimum", edition, "Characters a writer needs for a Contributor Edition. 0 for none."),
      ]),
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
      const plan = assessOpen({
        title: title.value,
        openingText: opening.value,
        maxChars: length.value,
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
        max_chars: String(length.value),
        category_1: Number(cat1.value),
        category_2: Number(cat2.value || 0),
        visibility: Number(visibility.value),
        free_chapters: Number(free.value),
        contributor_edition_min: String(edition.value || "0"),
        opening_text: opening.value,
        ai_assisted: ai.checked,
        expected_ink: plan.cost,
        token: contracts.paymentToken,
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
        append(status, notice("ok", h("p", {}, [
          "Your story is open. ",
          nextId ? h("a", { href: "#/stories/" + nextId }, ["Read it"]) : h("a", { href: "#/stories" }, ["Find it in Discover"]),
          Number(visibility.value) === 3 ? ". To invite writers, create an invite link (coming to this page soon; for now it's done with the SwarmTales tools)." : ".",
        ])));
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
    h("p", { class: "lede" }, ["Reading is always free. To write, you need Ink: from a promo link, an invite to a private story, or a Writer membership."])
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
        const buy = await encode("shop", "buy_membership", { payer: address, tier: 2, months: 1, token: contracts.paymentToken });
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
      h("li", {}, [h("b", {}, ["Invites."]), " A story's opener can invite you to a private story. Joining is free."]),
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

function renderPromo(page, campaignId) {
  setMeta("Free Ink", "Claim free Ink to start writing on SwarmTales.");
  const linkSecret = linkSecretFromHash(location.hash);
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
  const linkSecret = linkSecretFromHash(location.hash);
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
      h("p", { class: "lede" }, [shortAddress(story.opener) + " invited you to this " + (Number(story.visibility) === 3 ? "private " : "") + "story. Only invited writers can add to it."]),
      opening ? h("blockquote", { class: "excerpt" }, ["“" + clip(opening, 220) + "”"]) : null,
      landingSteps("Join with one confirmation", "Your wallet asks you to approve. Joining is free.")
    );
    if (invite) {
      const left = Math.max(0, Number(invite.max_uses || 0) - Number(invite.uses || 0));
      append(facts, 
        h("div", {}, [h("dt", {}, ["Invites left"]), h("dd", {}, [num(left) + " of " + num(invite.max_uses)])]),
        h("div", {}, [h("dt", {}, ["Link expires"]), h("dd", {}, [formatUtc(invite.expires_at) || "Never"])]),
        h("div", {}, [h("dt", {}, ["Writing needs"]), h("dd", {}, ["Ink, 1 per letter"])])
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
            append(status, notice("ok", h("p", {}, ["You've joined. ", h("a", { href: "#/stories/" + storyId }, ["Start writing"]), "."])));
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
    state.wallet.id === "koinvault" ? "Sending the request to KOIN Vault…" : "Kondor should open now. Check the details, then confirm. " + KONDOR_HINT,
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
  const found = id ? await lookupTransaction(id) : null;
  const receipt = found && (found.receipt || (found.transaction && found.transaction.receipt));
  if (receipt && receipt.reverted) {
    const logs = Array.isArray(receipt.logs) ? receipt.logs.join(" ") : "";
    replace(status, notice("bad", h("p", {}, [explainFailure(new Error(logs || "The network refused it."))])));
    return false;
  }
  replace(status, notice("ok", [
    h("p", {}, [found ? "Done. It's on the record." : "Sent. It should appear within a minute."]),
    id ? h("p", { class: "mono small" }, ["Transaction " + id]) : null,
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
      if (state.wallet === kondor || state.wallet === vault) state.wallet = null;
      state.account = null;
      renderChip();
      renderDialog();
      renderPage();
    } }, ["Disconnect"])]));
    append(body, connected);
  }
  append(body, kondorSection());
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

function kondorSection() {
  const box = h("div", { class: "wallet-option" }, [
    h("h3", {}, ["Kondor"]),
    h("p", {}, ["A free browser extension for Chrome, Brave and Edge on a computer. It asks you to confirm in a small window."]),
  ]);
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
    const body = dialog.querySelector(".sheet-body") || dialog;
    append(body, notice("bad", h("p", {}, [explainFailure(error)])));
  }
}

boot();
