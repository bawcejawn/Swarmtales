/**
 * Reader's Cut (Wave 3) on the book page: choose any kept version of each
 * part, or bring back a part the final edit left out, and download your
 * own copy. The choices stay in this browser; nothing is published.
 */
import { contracts, network } from "../config.js";
import { read } from "../chain.js";
import { readAllVersions } from "../lib/versions.js";
import { shortAddress, formatUtc } from "../lib/money.js";
import { bookFromBlocks, fileBase, FORMATS } from "../lib/exportBook.js";
import { applyCut, changedCount, cutCredits, cutKey, cutParts, hasChoices, loadCut, OUT, saveCut, versionOptions } from "../lib/readersCut.js";
import { explainFailure } from "../lib/errors.js";
import { clip, plural } from "../app/format.js";
import { h, replace } from "../ui/dom.js";

const PREVIEW = 280;

function versionLabel(v) {
  switch (Number(v.kind)) {
    case 1: return "the original by " + shortAddress(v.author);
    case 2: return "changed by " + shortAddress(v.by);
    case 4: return "edited by its writer, " + shortAddress(v.by);
    case 5: return "the final edit by " + shortAddress(v.by);
    case 6: return "suggested by " + shortAddress(v.by);
    default: return "by " + shortAddress(v.by || v.author);
  }
}

function saveFile(name, type, data) {
  const blob = new Blob([data], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function readersCutPanel(storyId, story, segments) {
  const key = cutKey(contracts.stories, storyId);
  const parts = cutParts(segments);
  const options = parts.filter(hasChoices);
  if (!options.length) return null;
  let choices = loadCut(key);
  const versions = {};
  const status = h("p", { class: "meta small", role: "status" });
  const list = h("div", { class: "cut-list" });

  const numberOf = new Map(parts.map((p, i) => [p.seq, i + 1]));
  const describe = (part) => {
    const pick = choices[String(part.seq)];
    if (pick === OUT) return part.inBook ? "left out of your cut" : "left out, as in the book";
    if (pick === undefined) return part.inBook ? "as published" : "left out, as in the book";
    const v = (versions[part.seq] || []).find((x) => Number(x.version) === Number(pick));
    return "your pick: version " + pick + (v ? ", " + versionLabel(v) : "");
  };

  const refresh = () => {
    const blocks = applyCut(parts, choices, versions);
    const n = changedCount(parts, blocks);
    replace(status, n
      ? "Your cut differs from the published book in " + plural(n, "part") + ". It's saved in this browser."
      : "Your cut is the same as the published book so far.");
    for (const el of list.querySelectorAll("[data-seq]")) {
      const part = parts.find((p) => String(p.seq) === el.dataset.seq);
      if (part) replace(el.querySelector(".cut-state"), describe(part));
    }
  };

  const choose = (part, pick) => {
    const next = { ...choices };
    const isDefault = pick === null || (pick === OUT && !part.inBook);
    if (isDefault) delete next[String(part.seq)];
    else next[String(part.seq)] = pick;
    choices = next;
    if (!saveCut(key, choices)) replace(status, "This browser won't save your cut, so it lasts only until you leave the page.");
    refresh();
  };

  const optionRow = (part, name, value, label, text, checked) => {
    const input = h("input", { type: "radio", name, value: String(value) });
    input.checked = checked;
    input.addEventListener("change", () => { if (input.checked) choose(part, value); });
    return h("label", { class: "cut-option" }, [
      input,
      h("span", { class: "cut-option-body" }, [
        h("span", { class: "cut-option-label" }, [label]),
        text ? h("span", { class: "cut-option-text" }, [clip(text, PREVIEW)]) : null,
      ]),
    ]);
  };

  const partBox = (part) => {
    const body = h("div", { class: "cut-options" });
    const box = h("details", { class: "cut-part", dataset: { seq: String(part.seq) } }, [
      h("summary", {}, [
        h("span", { class: "cut-part-name" }, ["Part " + numberOf.get(part.seq) + (part.inBook ? "" : " (not in the book)")]),
        " · ",
        h("span", { class: "cut-state" }, [describe(part)]),
      ]),
      body,
    ]);
    let loaded = false;
    box.addEventListener("toggle", async () => {
      if (!box.open || loaded) return;
      loaded = true;
      replace(body, h("p", { class: "meta small" }, ["Loading the versions…"]));
      try {
        const all = await readAllVersions(
          (from, count) => read("stories", "get_versions", { story_id: String(storyId), seq: String(part.seq), from, count }),
          part.segment.version_count);
        versions[part.seq] = all;
        const name = "cut-" + part.seq;
        const pick = choices[String(part.seq)];
        const rows = [];
        if (part.inBook) {
          rows.push(optionRow(part, name, null, "As published", "", pick === undefined));
          rows.push(optionRow(part, name, OUT, "Leave this part out", "", pick === OUT));
        } else {
          rows.push(optionRow(part, name, null, "Leave it out, as in the book", "", pick === undefined || pick === OUT));
        }
        for (const v of versionOptions(all)) {
          // The published version is "As published" above.
          if (part.inBook && Number(v.version) === Number(part.segment.version_count || 0)) continue;
          const when = formatUtc(v.at) ? " · " + formatUtc(v.at).split(",")[0] : "";
          rows.push(optionRow(part, name, Number(v.version), "Version " + v.version + ": " + versionLabel(v) + when + (v.ai_assisted ? " · written with AI help" : ""),
            String(v.text), pick !== undefined && pick !== OUT && Number(pick) === Number(v.version)));
        }
        replace(body, h("fieldset", { class: "cut-fieldset" }, [h("legend", { class: "visually-hidden" }, ["Version of part " + numberOf.get(part.seq)]), ...rows]));
        refresh();
      } catch (error) {
        loaded = false;
        replace(body, h("p", { class: "meta small" }, [explainFailure(error)]));
      }
    });
    return box;
  };

  const pick = h("select", { "aria-label": "Download format for your cut" }, FORMATS.map((f) => h("option", { value: f.id }, [f.label])));
  const download = async () => {
    // A pick saved earlier needs its part's versions read before it can be used.
    const missing = parts.filter((p) => typeof choices[String(p.seq)] === "number" && !versions[p.seq]);
    try {
      for (const p of missing) {
        versions[p.seq] = await readAllVersions(
          (from, count) => read("stories", "get_versions", { story_id: String(storyId), seq: String(p.seq), from, count }), p.segment.version_count);
      }
    } catch (error) {
      replace(status, explainFailure(error));
      return;
    }
    const blocks = applyCut(parts, choices, versions);
    const credits = cutCredits(blocks);
    const book = bookFromBlocks({ ...story, title: (story.title || "Untitled") + " (Reader's Cut)" }, blocks, credits,
      { storyId, network: network.name, contract: contracts.stories });
    const f = FORMATS.find((x) => x.id === pick.value) || FORMATS[0];
    saveFile(fileBase(story.title) + "-readers-cut." + f.ext, f.type, f.make(book));
  };
  const reset = () => {
    choices = {};
    saveCut(key, choices);
    for (const input of list.querySelectorAll("input[type=radio]")) input.checked = input.value === "null";
    refresh();
  };

  for (const part of options) list.append(partBox(part));
  const panel = h("section", { class: "readers-cut no-print" }, [
    h("h2", { class: "h3" }, ["Reader's Cut"]),
    h("p", { class: "meta" }, ["Every version of every part is kept on the blockchain. Choose the ones you like best, or bring back parts the final edit left out, and download your own copy. Credits in your copy name whoever wrote the words you chose. Your cut stays in this browser; the published book doesn't change."]),
    list,
    status,
    h("div", { class: "row" }, [
      h("span", { class: "download-menu" }, [pick, h("button", { type: "button", class: "btn btn-primary btn-small", onClick: download }, ["Download your cut"])]),
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: reset }, ["Start again"]),
    ]),
  ]);
  refresh();
  return h("details", { class: "readers-cut-box no-print" }, [h("summary", { class: "btn btn-secondary btn-small" }, ["Make your own cut"]), panel]);
}
