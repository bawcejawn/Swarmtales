/**
 * Reader's Cut (Wave 3): a reader picks, for each part of a finished book,
 * any version the blockchain kept (the original, a writer's edit, a paid
 * change, an accepted suggestion, the final edit), or brings back a part the
 * final edit left out, and downloads their own copy. Nothing is published:
 * the cut lives in this browser. The published book stays as its writers
 * finished it.
 *
 * Never offered: hidden parts and parts taken down by moderation (a
 * takedown also wipes every version's text on chain), and empty versions.
 */
import { readingOrder } from "./order.js";
import { sharePercents } from "./credits.js";

const PREFIX = "st-cut:";
export const OUT = "out";

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function cutKey(contract, storyId) {
  return PREFIX + contract + ":" + storyId;
}

/** The saved choices: { [seq]: versionNumber | "out" }. Bad or missing data reads as no choices. */
export function loadCut(key, store = storage()) {
  if (!store) return {};
  try {
    const value = JSON.parse(store.getItem(key) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const [seq, pick] of Object.entries(value)) {
      if (!/^\d+$/.test(seq)) continue;
      if (pick === OUT || (Number.isInteger(pick) && pick > 0)) out[seq] = pick;
    }
    return out;
  } catch {
    return {};
  }
}

/** Saves the choices; returns false when the browser won't keep them. */
export function saveCut(key, choices, store = storage()) {
  if (!store) return false;
  try {
    if (!choices || !Object.keys(choices).length) store.removeItem(key);
    else store.setItem(key, JSON.stringify(choices));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every part a reader can use, in reading order: the parts in the book, and
 * parts that were removed (by their writer, a paid change or the final edit)
 * but not taken down. Hidden and taken-down parts are never offered.
 */
export function cutParts(segments) {
  const all = (segments || []).map((segment, i) => ({ segment, seq: i + 1, insertAfter: Number(segment.insert_after || 0) }));
  return readingOrder(all)
    .filter((b) => !b.segment.hidden && !b.segment.taken_down)
    .map((b) => ({ seq: b.seq, segment: b.segment, inBook: Number(b.segment.status) !== 2 }));
}

/** A part a reader could change: it has earlier versions, or it was left out of the book. */
export function hasChoices(part) {
  return !part.inBook || Number(part.segment.version_count || 0) > 1;
}

/** The versions worth offering: ones with text. Newest first. */
export function versionOptions(versions) {
  return (versions || [])
    .filter((v) => String(v.text || "").trim().length > 0 && Number(v.kind) !== 3)
    .slice()
    .sort((a, b) => Number(b.version) - Number(a.version));
}

/**
 * The cut as blocks for bookFromBlocks: each part with the chosen text and
 * the wallet who wrote that version as its author. `versionsBySeq` holds
 * the versions read so far ({ seq: [version] }); a choice whose version
 * isn't loaded (or no longer has text) falls back to the book's own text.
 */
export function applyCut(parts, choices, versionsBySeq = {}) {
  const blocks = [];
  for (const part of parts) {
    const pick = choices[String(part.seq)];
    const s = part.segment;
    if (pick === OUT) continue;
    if (pick === undefined || pick === null) {
      if (!part.inBook) continue;
      blocks.push({ seq: part.seq, segment: { ...s, status: 1 }, version: Number(s.version_count || 0), chosen: false });
      continue;
    }
    const v = (versionsBySeq[part.seq] || []).find((x) => Number(x.version) === Number(pick));
    if (!v || !String(v.text || "").trim() || Number(v.kind) === 3) {
      if (part.inBook) blocks.push({ seq: part.seq, segment: { ...s, status: 1 }, version: Number(s.version_count || 0), chosen: false });
      continue;
    }
    const by = v.by || v.author || s.author;
    blocks.push({ seq: part.seq, segment: { ...s, status: 1, text: String(v.text), author: by, ai_assisted: !!v.ai_assisted || !!s.ai_assisted }, version: Number(v.version), chosen: true });
  }
  return blocks;
}

/** Who wrote the words in this cut: characters per wallet of each chosen version. */
export function cutCredits(blocks) {
  const totals = new Map();
  for (const b of blocks) {
    const who = b.segment.author;
    if (!who) continue;
    totals.set(who, (totals.get(who) || 0) + [...String(b.segment.text || "")].length);
  }
  const rows = Array.from(totals.entries()).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shares = sharePercents(rows.map((r) => r[1]));
  return rows.map(([address, chars], i) => ({ address, chars, share: shares[i] }));
}

/** How many parts differ from the published book. */
export function changedCount(parts, blocks) {
  const cut = new Map(blocks.map((b) => [b.seq, b]));
  let n = 0;
  for (const p of parts) {
    const b = cut.get(p.seq);
    if (p.inBook !== !!b) n += 1;
    else if (b && b.chosen && Number(b.version) !== Number(p.segment.version_count || 0)) n += 1;
  }
  return n;
}
