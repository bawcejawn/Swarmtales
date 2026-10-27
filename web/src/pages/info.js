/**
 * Terms of Use (checked against the on-chain fingerprint) and How it works.
 */
import { utils } from "koilib";
import { SITE } from "../config.js";
import { explainFailure } from "../lib/errors.js";
import { append, h, replace } from "../ui/dom.js";
import { renderHowSections } from "../ui/how.js";
import { renderMarkdown } from "../ui/markdown.js";
import { KONDOR_STORE, state } from "../app/state.js";
import { sha256Hex } from "../app/format.js";
import { termsVersion } from "../app/story.js";
import { loadingLine, notice, setMeta } from "../app/ui.js";

function chainTermsHashHex() {
  const raw = state.overview && state.overview.storiesCfg && state.overview.storiesCfg.terms_hash;
  if (!raw) return "";
  try {
    return Array.from(utils.decodeBase64url(raw), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

export function renderTerms(page) {
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

export function renderHow(page) {
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

/**
 * Privacy and AI: what is public, what SwarmTales promises, and what it can't
 * promise. Plain, because writers are leaving other sites over vague promises.
 */
export function renderPrivacy(page) {
  setMeta("Your writing, privacy and AI", "What is public on SwarmTales, and what SwarmTales does and doesn't do with your writing and AI.");
  const item = (title, ...text) => h("section", { class: "privacy-item" }, [h("h2", { class: "h3" }, [title]), ...text.map((t) => h("p", { class: "body-2" }, [t]))]);
  append(page, h("div", { class: "container page narrow" }, [
    h("p", { class: "eyebrow" }, ["Privacy and AI"]),
    h("h1", { class: "title" }, ["Your writing, privacy and AI"]),
    h("p", { class: "lede" }, ["The short version: what you write here is public and permanent, it is credited to your wallet, and SwarmTales never trains or sells AI on it."]),
    item("Everything written is public",
      "Every part, every edit and every kept version is stored on the public Koinos blockchain. Anyone can read it there, including people who run their own copy of the network.",
      "A private story limits who can write in it, not who can read it. Don't write anything you wouldn't want the world to see."),
    item("Your credit can't be quietly changed",
      "Each part is signed by its writer's wallet. Changes by other people are recorded as new versions with their name, and the earlier versions stay readable."),
    item("SwarmTales doesn't train or sell AI on your writing",
      "We don't use your writing to train AI models, and we don't sell or license it to anyone who does.",
      "Every page of this website carries a machine-readable \u201cno text and data mining\u201d notice (the opt-out European law recognises). Once the site has its own web address, it will also tell known AI crawlers to stay away."),
    item("What we can't promise",
      "Text on a public blockchain can be copied by anyone who reads the chain, and some scrapers ignore opt-outs. No public site can fully stop that, and we won't pretend otherwise."),
    item("AI help is your choice, and it's labelled",
      "Nothing on SwarmTales writes for you unless you choose to. If you used AI to help write a part, tick “Written with AI help” and readers see the label. The spelling check sends your text to LanguageTool only when you press its button."),
    item("What this site keeps in your browser",
      "Your reading place, bookmarks, followed stories, reading settings and unsent drafts stay in this browser. They aren't sent anywhere. There are no ads, trackers or analytics cookies. Clearing your browser's site data removes them."),
    h("p", {}, [h("a", { href: "#/terms" }, ["Terms of Use"]), " · ", h("a", { href: "#/report" }, ["Report copied text"])]),
  ]));
}
