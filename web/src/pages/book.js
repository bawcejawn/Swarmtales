/**
 * The finished book: read, print or save as PDF, or download as text.
 */
import { utils } from "koilib";
import { loadStory } from "../chain.js";
import { loadStoryOrCopy } from "../lib/offline.js";
import { explainFailure } from "../lib/errors.js";
import { append, h, replace } from "../ui/dom.js";
import { chapterWord, sha256Hex } from "../app/format.js";
import { bookText } from "../app/story.js";
import { loadingLine, notice, setMeta } from "../app/ui.js";
import { contracts, network } from "../config.js";
import { storyCredits } from "../lib/credits.js";
import { bookFromBlocks, fileBase, FORMATS } from "../lib/exportBook.js";
import { supportPanel } from "./support.js";

/** The finished book: read, print or save as PDF, or download as text. Free. */
export function renderBook(page, id) {
  const container = h("div", { class: "container page narrow book-page" }, [loadingLine("Opening the book…")]);
  append(page, container);
  loadStoryOrCopy(contracts.stories, id, loadStory).then(async ({ bundle: { story, segments }, savedAt }) => {
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
    const credits = storyCredits(story, ordered);
    const book = bookFromBlocks(story, ordered, credits, { storyId: id, network: network.name, contract: contracts.stories });
    const downloadMenu = () => {
      const pick = h("select", { "aria-label": "Download format" }, FORMATS.map((f) => h("option", { value: f.id }, [f.label])));
      const save = () => {
        const f = FORMATS.find((x) => x.id === pick.value) || FORMATS[0];
        const blob = new Blob([f.make(book)], { type: f.type });
        const a = h("a", { href: URL.createObjectURL(blob), download: fileBase(story.title) + "." + f.ext });
        document.body.append(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      };
      return h("span", { class: "download-menu" }, [pick, h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: save }, ["Download"])]);
    };
    const body = [];
    let chapter = 0;
    for (const b of ordered) {
      if (!chapter || b.segment.starts_chapter) {
        chapter += 1;
        body.push(h("h2", { class: "book-chapter" }, ["Chapter " + chapterWord(chapter)]));
      }
      body.push(h("p", { class: "book-text" }, [b.segment.text || ""]));
    }
    replace(container,
      h("div", { class: "no-print" }, [
        h("p", { class: "breadcrumb" }, [h("a", { href: "#/stories/" + id }, ["← Back to the story"])]),
        savedAt ? notice("warn", h("p", {}, ["You're offline, so this is the copy saved in this browser. It may be missing newer changes."])) : null,
        h("div", { class: "row" }, [
          h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => window.print() }, ["Print or save as PDF"]),
          h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: download }, ["Download as text"]),
          downloadMenu(),
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
        h("ul", { class: "credit-list" }, credits.map((c) => h("li", {}, [
          h("span", { class: "mono small" }, [c.address]),
          shareBar(c.share),
        ]))),
        h("p", { class: "meta small" }, [(finished ? "Shares count the characters that survived the final edit. " : "Shares count the characters in the story now. ") +
          "Written together on SwarmTales. Every part is recorded on the Koinos blockchain, story " + id + "."]),
      ]),
      h("div", { class: "no-print" }, [supportPanel(id, story, credits)]));
  }).catch((error) => replace(container, notice("bad", h("p", {}, [explainFailure(error)]))));
}

/** A small bar and the percent. The width is set through CSSOM (the CSP blocks style attributes). */
export function shareBar(share) {
  const bar = h("span", { class: "credit-bar" });
  bar.style.width = Math.max(2, share) + "%";
  return h("span", { class: "credit-share" }, [h("span", { class: "credit-track" }, [bar]), h("span", { class: "credit-pct" }, [share + "%"])]);
}
