/**
 * Start-up, header, footer and routing: boot() draws the frame, start()
 * checks the chain and restores the wallet, renderPage() draws the route.
 */
import { contracts, network, SITE } from "../config.js";
import { loadOverview, loadPaymentTokens, verifyChain } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { shortAddress } from "../lib/money.js";
import { clearSavedSession, loadSavedSession } from "../wallet.js";
import { captureLinkSecret } from "../lib/links.js";
import { forgetTestWalletOnMainnet } from "../testWallet.js";
import { isFramed } from "../lib/frame.js";
import { append, h, icons, replace } from "../ui/dom.js";
import { currentAddress, dialog, kondor, problems, state, testWallet, vault, walletName } from "./state.js";
import { checkPayment, restorePaymentToken } from "./payment.js";
import { notice } from "./ui.js";
import { refreshAccount } from "./data.js";
import { openWallet, renderDialog } from "./walletSheet.js";
import { renderHome } from "../pages/home.js";
import { renderDiscover } from "../pages/discover.js";
import { renderReader } from "../pages/reader.js";
import { renderOpen } from "../pages/open.js";
import { renderMembership } from "../pages/membership.js";
import { linkSecrets, renderJoin, renderPromo } from "../pages/landing.js";
import { renderMine } from "../pages/mine.js";
import { renderFinish } from "../pages/finish.js";
import { renderBook } from "../pages/book.js";
import { renderHow, renderPrivacy, renderTerms } from "../pages/info.js";
import { renderReportPage } from "../pages/report.js";
import { renderAdmin } from "../pages/admin.js";

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
  if (parts[0] === "privacy") return { name: "privacy" };
  if (parts[0] === "report") return { name: "report" };
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "shop" || parts[0] === "membership") return { name: "membership" };
  if (parts[0] === "promo" && isId(parts[1])) return { name: "promo", campaign: parts[1] };
  if (parts[0] === "join" && isId(parts[1]) && isId(parts[2])) return { name: "join", storyId: parts[1], inviteId: parts[2] };
  return { name: "home" };
}

export function renderChip() {
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
  // The short names are the phone tab bar's.
  const items = [
    ["discover", "#/stories", "Discover", "Discover"],
    ["open", "#/open", "Open a story", "Open"],
    ["how", "#/how", "How it works", "Help"],
    ["mine", "#/mine", "My stories", "Shelf"],
    ["membership", "#/membership", "Membership", "Ink"],
  ];
  replace(nav, ...items.map(([name, href, text, short]) => {
    const current = here === name || (name === "discover" && (here === "story" || here === "book"));
    // Only one of the two names is shown (and read) at a time, so the
    // accessible name is always the visible word (WCAG 2.5.3).
    return h("a", { href, "aria-current": current ? "page" : null }, [
      h("span", { class: "nav-long" }, [text]),
      h("span", { class: "nav-short" }, [short]),
    ]);
  }));
}

export function boot() {
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
  // Link keys (#/promo/..?k=, #/join/..?k=) leave the address bar first (W1-06).
  captureLinkSecret(window, linkSecrets);
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
          h("a", { href: "#/privacy" }, ["Privacy and AI"]), " · ",
          h("a", { href: "#/report" }, ["Report copied text"]), " · ",
          h("a", { href: SITE.adminPowersUrl, rel: "noopener" }, ["What the admin can and can't do"]), " · ",
          h("a", { href: SITE.sourceUrl, rel: "noopener" }, ["Source code"]), " · ",
          h("a", { href: "./feeds/latest.xml", type: "application/rss+xml" }, ["RSS: new parts"]), " · ",
          h("a", { href: "#/admin" }, ["Admin"]),
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
    captureLinkSecret(window, linkSecrets);
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
    state.payTokens = await loadPaymentTokens().catch(() => []);
    restorePaymentToken();
    state.overview = await loadOverview();
    state.overviewAt = Date.now();
    checkPayment();
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

export function renderPage() {
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
  else if (here.name === "privacy") renderPrivacy(page);
  else if (here.name === "report") renderReportPage(page);
  else if (here.name === "admin") renderAdmin(page);
  else renderHome(page);
  const heading = page.querySelector("h1");
  if (heading) heading.setAttribute("tabindex", "-1");
}
