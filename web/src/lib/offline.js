/**
 * Stories you've opened stay readable offline: after a story is read from the
 * chain, a copy is kept in this browser's cache, and shown (clearly marked as
 * a saved copy) when the network can't be reached. Nothing is sent anywhere.
 */

const CACHE = "st-stories-v1";
// The newest this many stories are kept.
export const MAX_SAVED = 30;

function available() {
  try {
    return typeof caches !== "undefined" && typeof Response !== "undefined";
  } catch {
    return false;
  }
}

function keyFor(contract, id) {
  // A same-origin URL is only used as a cache key; nothing is fetched from it.
  return new URL("./__saved-story/" + encodeURIComponent(contract) + "/" + encodeURIComponent(id), location.href).href;
}

export async function saveStoryCopy(contract, id, bundle) {
  if (!available()) return false;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(keyFor(contract, id), new Response(JSON.stringify({ at: Date.now(), bundle }), { headers: { "content-type": "application/json" } }));
    const keys = await cache.keys();
    if (keys.length > MAX_SAVED) {
      const dated = await Promise.all(keys.map(async (k) => {
        const r = await cache.match(k);
        const v = r ? await r.json().catch(() => ({})) : {};
        return [k, Number(v.at || 0)];
      }));
      dated.sort((a, b) => a[1] - b[1]);
      for (const [k] of dated.slice(0, keys.length - MAX_SAVED)) await cache.delete(k);
    }
    return true;
  } catch {
    return false;
  }
}

/** { at, bundle } or null. */
export async function loadStoryCopy(contract, id) {
  if (!available()) return null;
  try {
    const cache = await caches.open(CACHE);
    const response = await cache.match(keyFor(contract, id));
    if (!response) return null;
    const value = await response.json();
    return value && value.bundle && value.bundle.story ? value : null;
  } catch {
    return null;
  }
}

/** Read the story from the chain and keep a copy; fall back to the copy when offline. */
export async function loadStoryOrCopy(contract, id, load) {
  try {
    const bundle = await load(id);
    if (bundle && bundle.story && Number(bundle.story.status || 0) !== 0) saveStoryCopy(contract, id, bundle);
    return { bundle, savedAt: 0 };
  } catch (error) {
    const copy = await loadStoryCopy(contract, id);
    if (!copy) throw error;
    return { bundle: copy.bundle, savedAt: copy.at };
  }
}

/** Register the service worker (production build, not inside a frame). */
export function registerServiceWorker() {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!/^https:$|^http:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  } catch {
    /* not available: the site still works online */
  }
}
