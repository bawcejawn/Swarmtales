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
