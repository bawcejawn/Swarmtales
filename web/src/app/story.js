/**
 * Facts about a story that several pages show: size, status, categories,
 * who may write, and the finished book's text.
 */
import { label, STORY_STATUS } from "../lib/labels.js";
import { isActiveWriter, KIND_BOOK, VIS_PRIVATE } from "../lib/rules.js";
import { h } from "../ui/dom.js";
import { readingOrder } from "../lib/order.js";
import { state } from "./state.js";
import { num, plural } from "./format.js";

function categoryName(id) {
  const n = Number(id || 0);
  if (!n) return "";
  const found = state.overview && state.overview.categories.find((item) => item.id === n);
  return found ? found.name : "Category " + n;
}

export function storyCategories(story) {
  return [categoryName(story.category_1), categoryName(story.category_2)].filter(Boolean);
}

// Stories opened with no fixed size get their kind's maximum. They can be
// finished once they reach their kind's minimum.
export function kindMin(story) {
  return Number(story.kind) === KIND_BOOK ? 100000 : 10000;
}

export function openEnded(story) {
  const max = Number(story.max_chars || 0);
  return max === (Number(story.kind) === KIND_BOOK ? 1000000 : 99999);
}

export function inviteOnly(story) {
  return Number(story.visibility || 0) === VIS_PRIVATE;
}

export function percent(story) {
  const used = Number(story.used_chars || 0);
  // Open-ended stories show progress towards the length where they can be finished.
  const max = openEnded(story) ? kindMin(story) : Number(story.max_chars || 0);
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
}

export function sizeText(story) {
  const used = Number(story.used_chars || 0);
  if (!openEnded(story)) return num(story.used_chars) + " of " + num(story.max_chars) + " characters";
  if (Number(story.status) !== 1) return num(used) + " characters";
  return used >= kindMin(story)
    ? num(used) + " characters · long enough to finish"
    : num(used) + " characters · " + num(kindMin(story) - used) + " more until it can be finished";
}

export function statusPill(story) {
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

export function progressBar(story, labelText) {
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

export function charsLine(story) {
  return [h("span", {}, [sizeText(story)]), h("span", {}, [plural(story.contributor_count, "writer")])];
}

const AVATAR_TINTS = [
  ["#F4E9D6", "#6E4100"],
  ["#E7F0EA", "#24543A"],
  ["#E6ECEF", "#163F55"],
  ["#EFE6F0", "#5B2E62"],
  ["#F3E3DE", "#7A2E14"],
];

export function avatar(address) {
  const s = String(address || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum + s.charCodeAt(i)) % 997;
  const [bg, fg] = AVATAR_TINTS[sum % AVATAR_TINTS.length];
  const node = h("span", { class: "avatar", "aria-hidden": "true" }, [s.slice(1, 3).toUpperCase()]);
  node.style.background = bg;
  node.style.color = fg;
  return node;
}

export function minContribution() {
  const cfg = state.overview && state.overview.storiesCfg;
  return cfg && cfg.min_contribution ? String(cfg.min_contribution) : "0";
}

export function isPublic(story) {
  return Number(story.visibility) === 1;
}

export function termsVersion() {
  const cfg = state.overview && state.overview.storiesCfg;
  return cfg && cfg.terms_version ? Number(cfg.terms_version) : 0;
}

/**
 * Can this wallet write in a private story right now? The opener always can;
 * editors and invited wallets need an active Writer month. While the account
 * is still loading, say yes and let the writing box explain.
 */
export function canWriteInvited(story, me, flags) {
  if (!me) return false;
  if (story.opener === me) return true;
  if (!(flags && (flags.editor || flags.allowed))) return false;
  if (!state.account) return true;
  return isActiveWriter(state.account.membership, state.account.now);
}

/** Can the opener close this story now? Mirrors the contract's rule. */
export function closeReadyLocal(story) {
  const used = Number(story.used_chars || 0);
  const max = Number(story.max_chars || 0);
  return Number(story.status) === 2 || used >= kindMin(story) || used + 100 >= max;
}

/** The finished book as plain text, in reading order, with chapter headings. */
export function bookText(story, segments) {
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
