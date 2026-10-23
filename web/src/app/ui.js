/**
 * Small shared widgets: notices, form fields, status boxes, the rights
 * confirmation, the source and AI-help boxes, and the wallet note.
 */
import { contracts, network } from "../config.js";
import { explainFailure } from "../lib/errors.js";
import { kondorManaNote, VAULT_MANA_CEILING } from "../lib/money.js";
import { kondorHint, VAULT_MANA_EXPLANATION } from "../wallet.js";
import { vaultManaDecision } from "../lib/vaultApi.js";
import { h, icons, replace } from "../ui/dom.js";
import { state } from "./state.js";
import { termsVersion } from "./story.js";
import { openWallet } from "./walletSheet.js";

export function notice(kind, content) {
  return h("div", { class: "notice notice-" + kind, role: kind === "bad" ? "alert" : null }, Array.isArray(content) ? content : [content]);
}

export function problemsNotice(items) {
  if (!items || !items.length) return null;
  if (items.length === 1) return notice("warn", h("p", {}, [items[0]]));
  return notice("warn", [h("p", {}, ["Before your wallet opens, a few things need fixing:"]), h("ul", {}, items.map((item) => h("li", {}, [item])))]);
}

export function statusBox() {
  return h("div", { class: "status", role: "status", "aria-live": "polite" });
}

export function failure(status, error) {
  replace(status, notice("bad", h("p", {}, [explainFailure(error)])));
}

export function field(labelText, control, help) {
  return h("label", { class: "field" }, [h("span", {}, [labelText, help ? h("span", { class: "help" }, [help]) : null]), control]);
}

export function connectButton(text) {
  return h("button", { type: "button", class: "btn btn-primary", onClick: openWallet }, [text || "Connect a wallet"]);
}

export function setMeta(title, description) {
  document.title = title ? title + " · SwarmTales" : "SwarmTales · Stories written by many hands";
  const tag = document.querySelector('meta[name="description"]');
  if (tag && description) tag.setAttribute("content", description);
}

export function loadingLine(text) {
  return h("p", { class: "loading" }, [text]);
}

export function stat(name, value) {
  return h("div", {}, [h("dt", {}, [name]), h("dd", {}, [value])]);
}

/** The required "I wrote this" confirmation, with a link to the Terms. */
export function rightsBox() {
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

/** "Written with AI help" checkbox, with what it does spelled out and a live preview of the label. */
export function aiToggle() {
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

/** Shown when a mana sponsor is set up (config.js contracts.sponsor). */
export const SPONSOR_NOTE = "SwarmTales pays the mana for this when it can (up to a daily limit). Otherwise your wallet's own mana is used.";

export function walletNote() {
  const sponsored = !!contracts.sponsor;
  if (state.wallet && state.wallet.id === "testwallet") {
    return h("p", { class: "meta small" }, [sponsored
      ? "Signed by the test wallet in this browser. " + SPONSOR_NOTE
      : "Signed by the test wallet in this browser. It needs tKOIN for mana."]);
  }
  if (state.wallet && state.wallet.id === "koinvault") {
    const decision = state.account ? vaultManaDecision(state.account.mana, VAULT_MANA_CEILING) : null;
    return h("p", { class: "meta small" }, [decision && decision.blocked ? decision.message : VAULT_MANA_EXPLANATION]);
  }
  if (sponsored) return h("p", { class: "meta small" }, [SPONSOR_NOTE]);
  const low = state.account ? kondorManaNote(state.account.mana, network.mainnet) : "";
  return h("p", { class: "meta small" }, [low || kondorHint(network.mainnet)]);
}

export function trustNote(text) {
  return h("div", { class: "trust-note" }, [icons.shield(), h("p", {}, [text])]);
}

export function copyButton(text, labelText) {
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

/** "Quoting someone?": an optional source shown under the part. Cited quotes are left alone by the copy checker. */
export function citationField() {
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
