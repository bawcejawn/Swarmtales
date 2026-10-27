/**
 * Following stories, kept in this browser (no account, no email, no server).
 * One record per contract: { follow: { [id]: { title, at } }, seen: { [id]: count } }.
 * `seen` is how many parts the story had when this browser last opened it,
 * so the shelf can say "3 new parts" for a story you follow.
 */

const PREFIX = "st-follow:";
export const MAX_FOLLOWS = 100;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function load(contract, store) {
  if (!store) return { follow: {}, seen: {} };
  try {
    const value = JSON.parse(store.getItem(PREFIX + contract) || "{}");
    return {
      follow: value && typeof value.follow === "object" && value.follow ? value.follow : {},
      seen: value && typeof value.seen === "object" && value.seen ? value.seen : {},
    };
  } catch {
    return { follow: {}, seen: {} };
  }
}

function save(contract, record, store) {
  if (!store) return false;
  try {
    store.setItem(PREFIX + contract, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function isFollowing(contract, id, store = storage()) {
  return Object.prototype.hasOwnProperty.call(load(contract, store).follow, String(id));
}

/** Follow or unfollow. Returns the new state (true = following). */
export function setFollow(contract, id, on, title = "", store = storage(), now = Date.now()) {
  const record = load(contract, store);
  const key = String(id);
  const was = Object.prototype.hasOwnProperty.call(record.follow, key);
  if (on) {
    if (!was && Object.keys(record.follow).length >= MAX_FOLLOWS) return false;
    record.follow[key] = { title: String(title || "").slice(0, 120), at: now };
  } else {
    delete record.follow[key];
  }
  // If the browser refused to save, nothing changed.
  return save(contract, record, store) ? !!on : was;
}

/** Remember that this browser has seen `count` parts of the story. */
export function markSeen(contract, id, count, store = storage()) {
  const record = load(contract, store);
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (record.seen[String(id)] === n) return;
  record.seen[String(id)] = n;
  // Keep the seen list small: only followed stories and the 200 newest others.
  const keys = Object.keys(record.seen);
  if (keys.length > 300) {
    for (const k of keys.slice(0, keys.length - 200)) if (!record.follow[k]) delete record.seen[k];
  }
  save(contract, record, store);
}

/** Parts added since this browser last opened the story (0 if never opened). */
export function newParts(contract, id, count, store = storage()) {
  const seen = load(contract, store).seen[String(id)];
  if (seen === undefined) return 0;
  return Math.max(0, Math.floor(Number(count) || 0) - seen);
}

/** Followed stories, newest follow first: [{ id, title, at }]. */
export function followed(contract, store = storage()) {
  const record = load(contract, store);
  return Object.entries(record.follow)
    .map(([id, v]) => ({ id, title: v && v.title ? v.title : "", at: v && v.at ? v.at : 0 }))
    .sort((a, b) => b.at - a.at);
}
