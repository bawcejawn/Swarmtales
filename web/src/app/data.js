/**
 * Reads several pages share: the overview, the library, first lines, the
 * connected account, and the stories a wallet opened, wrote in or joined.
 */
import { listStories, loadAccount, loadOverview, loadSegment, read, writerFlags } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { currentAddress, state } from "./state.js";
import { checkPayment } from "./payment.js";
import { renderChip } from "./shell.js";

/** Read the overview again (prices, configs) and recheck the payment token. */
export async function reloadOverview() {
  try {
    state.overview = await loadOverview();
    state.overviewAt = Date.now();
    checkPayment();
  } catch {
    /* keep the old overview */
  }
}

export function loadLibrary(force) {
  if (!state.overview) return Promise.resolve(null);
  if (force) {
    state.library = null;
    state.libraryPromise = null;
  }
  if (state.library) return Promise.resolve(state.library);
  if (!state.libraryPromise) {
    state.libraryPromise = listStories(state.overview.storiesCfg.next_story_id || "1")
      .then((result) => {
        state.library = result;
        return result;
      })
      .catch((error) => {
        state.libraryPromise = null;
        throw error;
      });
  }
  return state.libraryPromise;
}

export async function firstLine(id) {
  if (state.excerpts.has(id)) return state.excerpts.get(id);
  let text = "";
  try {
    // A few parts in one read; if that read fails (long text over the
    // node's limit), just the first part on its own (M-5).
    let values;
    try {
      const page = await read("stories", "get_segments", { story_id: String(id), start: "1", limit: 3 });
      values = page && Array.isArray(page.values) ? page.values : [];
    } catch {
      values = [await loadSegment(id, 1)].filter(Boolean);
    }
    const first = values.find((segment) => Number(segment.status) !== 2 && !segment.hidden);
    text = first ? String(first.text || "") : "";
  } catch {
    text = "";
  }
  state.excerpts.set(id, text);
  return text;
}

export async function refreshAccount() {
  const address = currentAddress();
  state.account = null;
  state.accountError = "";
  renderChip();
  if (!address) return;
  try {
    state.account = await loadAccount(address);
  } catch (error) {
    state.accountError = explainFailure(error);
  }
  renderChip();
}

/** The id of the story this wallet opened most recently, as text. */
export async function newestOpenedStory(address) {
  const ids = await openedStoryIds(address);
  return ids.length ? ids[ids.length - 1] : "";
}

export async function openedStoryIds(address) {
  const ids = [];
  for (let start = 0; start < 500; start += 50) {
    const page = await read("stories", "get_opener_stories", { account: address, start: String(start), limit: 50 });
    const values = page && Array.isArray(page.values) ? page.values : [];
    ids.push(...values.map(String));
    if (values.length < 50) break;
  }
  return ids;
}

/** Private stories this wallet was invited to (or is an editor of). */
export async function invitedStoryIds(address) {
  const library = (await loadLibrary()) || (await listStories((await read("stories", "get_config", {})).next_story_id || "1"));
  const rows = (library && library.stories ? library.stories : [])
    .filter((row) => Number(row.story.visibility) !== 1 && row.story.opener !== address);
  const out = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      const flags = await writerFlags(row.id, address).catch(() => ({ editor: false, allowed: false }));
      if (flags.allowed || flags.editor) out.push(String(row.id));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

export async function writtenStoryIds(address) {
  const ids = new Set();
  for (let start = 0; start < 1000; start += 50) {
    const page = await read("stories", "get_author_segments", { account: address, start: String(start), limit: 50 });
    const values = page && Array.isArray(page.values) ? page.values : [];
    for (const ref of values) ids.add(String(ref.story_id));
    if (values.length < 50) break;
  }
  return Array.from(ids);
}

export async function storyRows(ids) {
  const rows = await Promise.all(ids.map(async (id) => {
    const story = await read("stories", "get_story", { story_id: String(id) }).catch(() => null);
    return story && Number(story.status || 0) ? { id: Number(id), story } : null;
  }));
  return rows.filter(Boolean).sort((a, b) => Number(b.story.last_activity_at || 0) - Number(a.story.last_activity_at || 0));
}
