/**
 * "Report copied text": how readers and rights holders report a part.
 */
import { SITE } from "../config.js";
import { append, h } from "../ui/dom.js";
import { state } from "../app/state.js";
import { plural } from "../app/format.js";
import { setMeta } from "../app/ui.js";

// The strike limit is an admin setting (1 to 20); 0 means the contract's default of 5.
function strikeLimitText() {
  const cfg = state.overview && state.overview.storiesCfg;
  if (!cfg) return "After a set number of takedowns (5 by default)";
  return "After " + plural(Number(cfg.strike_limit || 5), "takedown", "takedowns");
}

export function renderReportPage(page) {
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
        h("li", {}, ["Finished books can't be reported part by part. To report something in one, write to the address under “If you own the copyright” below, with the book's link and the part (or its first words)."]),
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
        h("li", {}, ["A takedown counts against the part's writer. If someone else changed the part, its versions are compared and it counts against whoever made the text infringing, or against nobody (fixing a typo is never a reason). " + strikeLimitText() + ", a wallet can no longer write on SwarmTales."]),
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
