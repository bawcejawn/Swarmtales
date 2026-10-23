/**
 * Reading progress and bookmarks, kept in this browser (free, private,
 * no wallet needed). One record per story:
 *   last: where the reader last was (saved automatically while reading)
 *   mark: the part the reader bookmarked (optional)
 *   dirty: the bookmark (or its removal) is not in the wallet yet
 *   clearedAt: when the reader last removed the bookmark
 * Each place is { seq, chapter, percent, at }.
 *
 * A bookmark is always saved here first. It goes to the wallet (on chain,
 * set_reading_place) only when the reader asks, in one batched confirmation,
 * never as a signature prompt per click (audit W1-10).
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
    if (!record.last && !record.mark && !record.dirty) store.removeItem(keyFor(contract, storyId));
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

/**
 * Set the bookmark to this part, or clear it (info = null). A change the
 * reader makes is marked dirty (not in the wallet yet); one copied from the
 * wallet passes { fromWallet: true } and is not.
 */
export function setMark(contract, storyId, info, store = storage(), now = Date.now(), opts = {}) {
  const record = load(contract, storyId, store);
  if (info) {
    record.mark = place(info, now);
    if (info.title) record.title = String(info.title).slice(0, 120);
    delete record.clearedAt;
  } else {
    delete record.mark;
    record.clearedAt = now;
  }
  if (opts.fromWallet) delete record.dirty;
  else record.dirty = true;
  save(contract, storyId, record, store);
  return record;
}

/** When this browser's bookmark last changed (set or removed), in ms; 0 if never. */
export function markChangedAt(record) {
  return Math.max(record && record.mark ? record.mark.at : 0, (record && record.clearedAt) || 0);
}

/**
 * Bookmarks (and removed bookmarks) not in the wallet yet, oldest change
 * first: [{ id, seq, chapter, percent, at }]. seq 0 clears the wallet's place.
 */
export function pendingWallet(contract, store = storage()) {
  if (!store) return [];
  const out = [];
  const prefix = PREFIX + contract + ":";
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    const record = load(contract, id, store);
    if (!record.dirty) continue;
    const m = record.mark;
    out.push(m
      ? { id, seq: m.seq, chapter: m.chapter, percent: m.percent, at: m.at }
      : { id, seq: 0, chapter: 0, percent: 0, at: 0 });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The wallet now holds these places (items from pendingWallet). Each stops
 * being pending, unless the reader changed that bookmark again meanwhile.
 */
export function markInWallet(contract, sent, store = storage()) {
  for (const item of sent) {
    const record = load(contract, item.id, store);
    if (!record.dirty) continue;
    const m = record.mark;
    const same = m ? m.seq === item.seq && m.at === item.at : item.seq === 0;
    if (!same) continue;
    delete record.dirty;
    save(contract, item.id, record, store);
  }
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
