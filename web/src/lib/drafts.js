/**
 * Unsent writing, kept in this browser so a closed tab, a refresh, a crash or
 * a failed transaction never loses it. One draft per writing box (the story,
 * and where in it). Nothing here goes on chain or leaves the browser.
 */

const PREFIX = "st-draft:";
// Drafts older than this are dropped the next time they are read.
export const DRAFT_DAYS = 60;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function draftKey(contract, storyId, after) {
  return PREFIX + contract + ":" + storyId + ":" + Number(after || 0);
}

/** The saved draft, { text, at }, or null. */
export function loadDraft(key, store = storage(), now = Date.now()) {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.text !== "string" || !value.text.trim()) return null;
    if (!Number.isFinite(value.at) || now - value.at > DRAFT_DAYS * 86400000) {
      store.removeItem(key);
      return null;
    }
    return { text: value.text, at: value.at };
  } catch {
    return null;
  }
}

/** Save the text (empty text removes the draft). Returns false if the browser refused. */
export function saveDraft(key, text, store = storage(), now = Date.now()) {
  if (!store) return false;
  try {
    if (!String(text || "").trim()) store.removeItem(key);
    else store.setItem(key, JSON.stringify({ text: String(text), at: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key, store = storage()) {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function agoText(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + (m === 1 ? " minute" : " minutes") + " ago";
  const hr = Math.round(m / 60);
  if (hr < 48) return hr + (hr === 1 ? " hour" : " hours") + " ago";
  const d = Math.round(hr / 24);
  return d + " days ago";
}
