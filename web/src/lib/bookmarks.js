/**
 * Reading progress and bookmarks, kept in this browser only (free, private,
 * no wallet needed). One record per story:
 *   last: where the reader last was (saved automatically while reading)
 *   mark: the part the reader bookmarked (optional)
 * Each place is { seq, chapter, percent, at }.
 */

const PREFIX = "st-read:";

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function keyFor(contract, storyId) {
  return PREFIX + contract + ":" + storyId;
}

export function load(contract, storyId, store = storage()) {
  if (!store) return {};
  try {
    const raw = store.getItem(keyFor(contract, storyId));
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function save(contract, storyId, record, store) {
  if (!store) return;
  try {
    if (!record.last && !record.mark) store.removeItem(keyFor(contract, storyId));
    else store.setItem(keyFor(contract, storyId), JSON.stringify(record));
  } catch {
    /* full or blocked: reading still works */
  }
}

function place(info, now) {
  return {
    seq: Number(info.seq) || 0,
    chapter: Number(info.chapter) || 1,
    percent: Math.max(0, Math.min(100, Math.round(Number(info.percent) || 0))),
    at: now,
  };
}

export function saveLast(contract, storyId, info, store = storage(), now = Date.now()) {
  const record = load(contract, storyId, store);
  record.last = place(info, now);
  if (info.title) record.title = String(info.title).slice(0, 120);
  save(contract, storyId, record, store);
  return record;
}

/** Set the bookmark to this part, or clear it (info = null). */
export function setMark(contract, storyId, info, store = storage(), now = Date.now()) {
  const record = load(contract, storyId, store);
  if (info) {
    record.mark = place(info, now);
    if (info.title) record.title = String(info.title).slice(0, 120);
  } else {
    delete record.mark;
  }
  save(contract, storyId, record, store);
  return record;
}

/** Every story this browser has progress for, most recent first. */
export function list(contract, store = storage()) {
  if (!store) return [];
  const out = [];
  const prefix = PREFIX + contract + ":";
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    const record = load(contract, id, store);
    const when = Math.max(record.last ? record.last.at : 0, record.mark ? record.mark.at : 0);
    if (when) out.push({ id, ...record, when });
  }
  return out.sort((a, b) => b.when - a.when);
}

export function forget(contract, storyId, store = storage()) {
  if (!store) return;
  try {
    store.removeItem(keyFor(contract, storyId));
  } catch {
    /* ignore */
  }
}
