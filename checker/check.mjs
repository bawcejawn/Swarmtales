#!/usr/bin/env node
/**
 * SwarmTales copy checker, plan step. Runs every hour in GitHub Actions
 * (free for public repositories), in a job that holds NO moderator key
 * (O1-09): it reads the chain and the web, decides, and writes a plan. A
 * separate apply step (apply.mjs), in its own job with the key, re-checks
 * each planned action against the chain and only then signs it.
 *
 * Each run:
 *   1. reads every story part added since the last run, and every part
 *      whose text or citation changed since it was checked (a part
 *      reworded after its check is checked again, AB-067);
 *   2. compares it with other writers' text on SwarmTales written before it
 *      (fingerprints), oldest parts first, so the later of two matching
 *      parts is the one treated as the copy;
 *   3. optionally, searches for five exact phrases from longer parts, using
 *      whichever free search keys are set (all optional, all free):
 *        GOOGLE_BOOKS_KEY  Google Books: searches inside millions of books
 *        TAVILY_API_KEY    Tavily web search (free: 1,000 searches a month)
 *        BRAVE_API_KEY     Brave web search (Brave now needs a card; kept for anyone who has a key)
 *   4. plans gentle actions (no one has to review anything):
 *        - a clear copy is hidden: 4 or more of 5 phrases found, 3 or more in
 *          the same BOOK, published before the part was written (M-11); or
 *          80%+ of the part matches an older part by another writer;
 *        - a match on websites only is never hidden (a website has no
 *          reliable date: it may be a mirror of the part), and neither is a
 *          book that isn't provably older: a public source note instead;
 *        - a partial match gets a source note ("Parts of this text also
 *          appear in …"); nothing is hidden;
 *        - a match with a part written at the same time gets a note on both;
 *        - a match with a source the writer cited is left alone;
 *        - a part hidden by writer reports for copying is checked too; a
 *          clear copy is taken over as the checker's hide (AB-071);
 *        - a part whose checker hide its opener restored is never hidden
 *          again for the same text, read from the chain so losing the saved
 *          progress can't undo it (O1-07); new text is checked again;
 *        - a copy the admin held or unhid is left to the admin.
 *   5. when a story fills up or enters its final edit, checks all of it once
 *      more against everything else, before it can be finished.
 *
 * Progress is saved after every few parts and the run stops starting new
 * work after TIME_BUDGET_MINUTES, so a long run never loses its work (M-13);
 * the next run goes on from there.
 *
 * Environment:
 *   STORIES_ADDRESS   Stories contract (required)
 *   RPC               node URL (default: the Foundation testnet)
 *   EXPECTED_CHAIN_ID the chain id the node must serve; needed for any node other than
 *                     the Foundation testnet or api.koinos.io
 *   GOOGLE_BOOKS_KEY  optional, book phrase check (stays under BOOKS_MONTHLY, default 25000;
 *                     Google's free quota is 1,000 a day)
 *   TAVILY_API_KEY    optional, web phrase check (stays under TAVILY_MONTHLY, default 950)
 *   BRAVE_API_KEY     optional, web phrase check (stays under SEARCH_MONTHLY, default 1800)
 *   SEARCH_PER_RUN    searches per run, all services together (default 40)
 *   TEST_PHRASE       if set: only search this phrase with every service that has a key,
 *                     print what each one found, and stop (to check the keys work)
 *   IGNORE_HOSTS      comma list of hosts never counted as a source
 *   STATE_FILE        progress from the load step, updated in place (default checker-state.json)
 *   PLAN_FILE         where the planned actions go (default checker-plan.json)
 *   TIME_BUDGET_MINUTES  stop starting new work after this long (default 20)
 *   PARTS_PER_READ    parts per get_segments read (default 3, M-5)
 */
import fs from "fs";
import {
  HIDE_FOUND, Index, REASON, WEB_MIN_CHARS, budget, checkOrder, citationCovers, cleanNote, dateOf, decide, fingerprint,
  isDuplicate, isPartialDuplicate, logLine, mdCell, mdFence, normalizeResults, pickPhrases, provablyOlder, publishedEnd,
  readParts, resultMatches, textAt, textKey, worthAsking,
} from "./lib.mjs";
import { FETCH_TIMEOUT_MS, activityNow, connect, timeBudgetMs } from "./chain.mjs";
import { writeAtomic } from "./state.mjs";
import { readAllVersions } from "../web/src/lib/versions.js";

const env = process.env;
const STORIES = env.STORIES_ADDRESS;
const STATE_FILE = env.STATE_FILE || "checker-state.json";
const PLAN_FILE = env.PLAN_FILE || "checker-plan.json";
const MONTHLY = Number(env.SEARCH_MONTHLY || 1800);
const BOOKS_MONTHLY = Number(env.BOOKS_MONTHLY || 25000);
const TAVILY_MONTHLY = Number(env.TAVILY_MONTHLY || 950);
const PER_RUN = Number(env.SEARCH_PER_RUN || 40);
const PER_READ = Math.max(1, Math.min(10, Number(env.PARTS_PER_READ || 3)));
const BUDGET_MS = timeBudgetMs(env.TIME_BUDGET_MINUTES);
const SAVE_EVERY_MS = 15000;
const IGNORE = ["bawcejawn.github.io", "koinosblocks.com", "koiner.app", "kollection.app"]
  .concat(String(env.IGNORE_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const startedAt = Date.now();

const log = [];
function note(line) {
  const safe = logLine(line);
  console.log(safe);
  log.push(safe);
}
const errText = (error) => (error && error.message ? error.message : String(error));

function writeSummary(actions) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const what = (a) => a.kind === "note" ? "source note" : a.kind === "unhide" ? "bring back" : a.reason === REASON.COPYRIGHT ? "hide: copied text" : "hide: duplicate";
  const rows = actions.length
    ? actions.map((a) => "| " + [a.story, a.seq, what(a), mdCell(a.note)].join(" | ") + " |").join("\n")
    : "| | | nothing planned | |";
  fs.appendFileSync(file, "## SwarmTales copy checker: plan\n\nThe apply step checks each of these against the chain again before signing it.\n\n" +
    "| story | part | planned | note |\n|---|---|---|---|\n" + rows + "\n\n" + mdFence(log.join("\n")));
}

/**
 * What a story looked like, to notice that something in it changed: writing,
 * edits, paid changes and removals move last_activity_at, and the final edit
 * moves final_cursor. null when the node didn't say (read it all again).
 */
function activityMark(st) {
  if (st.last_activity_at === undefined || st.last_activity_at === null || st.last_activity_at === "") return null;
  return [st.last_activity_at, st.final_cursor || 0, st.segment_count || 0, st.status || 0].join(":");
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** One search service: how to ask it for an exact phrase. */
const SERVICES = [
  {
    name: "books",
    label: "Google Books",
    key: () => env.GOOGLE_BOOKS_KEY,
    monthly: BOOKS_MONTHLY,
    ask: (phrase) => fetch("https://www.googleapis.com/books/v1/volumes?maxResults=5&q=" + encodeURIComponent('"' + phrase + '"') +
      "&key=" + encodeURIComponent(env.GOOGLE_BOOKS_KEY.trim()), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  },
  {
    name: "tavily",
    label: "Tavily",
    key: () => env.TAVILY_API_KEY,
    monthly: TAVILY_MONTHLY,
    ask: (phrase) => fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.TAVILY_API_KEY.trim() },
      body: JSON.stringify({ query: '"' + phrase + '"', search_depth: "basic", max_results: 5 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  },
  {
    name: "brave",
    label: "Brave",
    key: () => env.BRAVE_API_KEY,
    monthly: MONTHLY,
    async ask(phrase) {
      const url = "https://api.search.brave.com/res/v1/web/search?count=5&q=" + encodeURIComponent('"' + phrase + '"');
      const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_API_KEY.trim() }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      await pause(1100); // Brave allows 1 request a second
      return res;
    },
  },
];

const BUSY = new Set([429, 500, 502, 503, 504]);

/**
 * Ask a service, retrying when it is busy (Google Books sometimes answers 503
 * "backendFailed" for a moment). Waits about 1, 2, 4 and 8 seconds.
 */
async function askWithRetry(service, phrase) {
  let res = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await pause(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400));
    try {
      res = await service.ask(phrase);
    } catch (error) {
      res = { ok: false, status: 0, error };
    }
    if (res.ok || !BUSY.has(res.status) && res.status !== 0) return res;
  }
  return res;
}

function failureText(service, res) {
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return service.label + ": FAILED with status " + res.status + ". The key is wrong, restricted to another API, or the API isn't enabled.";
  }
  if (BUSY.has(res.status) || res.status === 0) {
    return service.label + ": the service was busy (status " + (res.status || "no answer") + ") five times in a row. That's a problem on the service's side, not your key. It is tried again next run.";
  }
  return service.label + ": FAILED with status " + res.status + ".";
}

/** Search one phrase with one service. Returns the matching result, null, or "failed". */
async function searchOnce(service, phrase) {
  try {
    const res = await askWithRetry(service, phrase);
    if (!res.ok) {
      note("  " + failureText(service, res) + " Skipped for the rest of this run.");
      return "failed";
    }
    const results = normalizeResults(service.name, await res.json());
    return results.find((r) => resultMatches(phrase, r, IGNORE)) || null;
  } catch (error) {
    note("  " + service.label + " search failed (" + errText(error) + ")");
    return "failed";
  }
}

/**
 * Search up to five phrases of a part. A phrase counts as found when any
 * service finds it. Books are asked first (the free quota is large and copied
 * book text is the main risk), then the web. Returns null (nothing worth
 * noting), "defer" (a phrase that mattered went unanswered: no free searches
 * left this run, or every service failed; try next run, AB-083), or
 * { action: "hide" | "note", found, same, of, label, source, kind, published, cited }.
 * `kind` is "book" only when every hit of the main source was a book; then
 * `published` is the latest publishedDate among them (the safe side, M-11).
 */
async function webCheck(text, spendable, citation) {
  const phrases = pickPhrases(text);
  if (phrases.length < HIDE_FOUND) return null;
  if (!spendable.any() || spendable.leftThisRun() < phrases.length) return "defer";
  const found = [];
  const sources = new Map();
  for (let i = 0; i < phrases.length; i++) {
    if (!worthAsking(found.filter(Boolean).length, i, phrases.length)) break;
    let hit = null;
    let answered = false;
    for (const service of spendable.services()) {
      if (!spendable.ok(service)) continue;
      spendable.spend(service);
      const result = await searchOnce(service, phrases[i]);
      if (result === "failed") {
        spendable.disable(service);
        continue;
      }
      answered = true;
      if (result) {
        hit = result;
        break;
      }
    }
    // Nobody could answer: never judged on the phrases asked so far (AB-083).
    if (!answered) return "defer";
    if (!hit) {
      found.push(null);
      continue;
    }
    let host = "";
    try { host = new URL(hit.url).host; } catch { host = "a website"; }
    const key = hit.source ? (hit.source.title + "|" + hit.source.author).toLowerCase() : host.toLowerCase();
    const s = sources.get(key) || { label: hit.label || cleanNote(host, "a website", 100), source: hit.source || host, kind: "book", published: "" };
    // The latest date among the source's hits counts; one unknown date makes it unknown.
    const end = publishedEnd(hit.published);
    if (hit.kind !== "book") s.kind = "web";
    else if (end === null) s.published = "?";
    else if (s.published === "" || (s.published !== "?" && end > publishedEnd(s.published))) s.published = hit.published;
    sources.set(key, s);
    found.push(key);
  }
  const d = decide(found);
  if (d.action === "none") return null;
  const where = sources.get(d.source) || { label: "", source: null, kind: "web", published: "" };
  const cited = !!where.source && citationCovers(citation || "", where.source);
  return { action: d.action, found: d.found, same: d.same, of: phrases.length, ...where, cited };
}

async function testPhrase(phrase) {
  const active = SERVICES.filter((s) => s.key());
  if (!active.length) {
    note("No search key is set (GOOGLE_BOOKS_KEY, TAVILY_API_KEY or BRAVE_API_KEY). Nothing to test.");
    return;
  }
  note('Testing the search keys with: "' + phrase + '"');
  for (const service of active) {
    try {
      const res = await askWithRetry(service, phrase);
      if (!res.ok) {
        note("  " + failureText(service, res));
        continue;
      }
      const results = normalizeResults(service.name, await res.json());
      const hit = results.find((r) => resultMatches(phrase, r, IGNORE));
      note("  " + service.label + ": key works. " + results.length + " result(s); " +
        (hit ? "the phrase was FOUND in " + (hit.label || new URL(hit.url).host) + "." : "no exact match among them."));
    } catch (error) {
      note("  " + service.label + ": FAILED (" + errText(error) + ")");
    }
  }
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (state && typeof state === "object" && !Array.isArray(state)) return state;
  } catch {
    // below
  }
  return { load: { status: "fresh", detail: "no progress from the load step" } };
}

async function main() {
  if (env.TEST_PHRASE && env.TEST_PHRASE.trim()) {
    await testPhrase(env.TEST_PHRASE.trim());
    writeSummary([]);
    return 0;
  }
  const { read } = await connect(env);
  const cfg = await read("get_config");

  const state = loadState();
  const load = state.load || { status: "ok", detail: "" };
  delete state.load;
  // Without the state key nothing can be saved, so monthly search budgets
  // can't be kept: no searches, and the apply step signs nothing.
  const noKey = load.status === "nokey";
  if (load.status !== "ok") note("Saved progress: " + load.status + " (" + load.detail + ").");
  for (const name of ["checked", "swept", "seen", "hiddenByChecker", "protect", "activity", "pending"]) {
    if (!state[name] || typeof state[name] !== "object") state[name] = {};
  }
  const index = Index.fromJSON(state.index);
  const now = new Date();
  const budgets = {};
  for (const s of SERVICES) budgets[s.name] = budget(state, now, s.monthly, "search_" + s.name);
  const disabled = new Set();
  let searchesThisRun = 0;
  // Brave keeps a card on file: when this month's count of searches was lost
  // (no valid saved progress), it isn't used this run, so a lost or planted
  // state can never make the checker run past its free quota.
  const searchKeys = noKey ? [] : SERVICES.filter((s) => s.key() && (s.name !== "brave" || load.status === "ok")).map((s) => s.label);
  if (!noKey && load.status !== "ok" && env.BRAVE_API_KEY) note("Brave is not used this run: this month's count of its searches is unknown.");
  const spendable = {
    services: () => SERVICES.filter((s) => searchKeys.includes(s.label) && !disabled.has(s.name)),
    ok: (s) => searchesThisRun < PER_RUN && budgets[s.name].left() > 0,
    leftThisRun: () => Math.min(PER_RUN - searchesThisRun,
      spendable.services().reduce((sum, s) => sum + budgets[s.name].left(), 0)),
    any: () => spendable.services().some((s) => spendable.ok(s)),
    spend: (s) => { searchesThisRun += 1; budgets[s.name].spend(); },
    disable: (s) => disabled.add(s.name),
  };
  note(searchKeys.length ? "Phrase search with: " + searchKeys.join(", ") + "." : "No phrase search this run: only SwarmTales' own text is compared.");

  // ---------------------------------------------------------- the plan
  const actions = [];
  const planned = new Set();
  let lastSave = 0;
  function save(force) {
    if (!force && Date.now() - lastSave < SAVE_EVERY_MS) return;
    state.index = index.toJSON();
    writeAtomic(STATE_FILE, JSON.stringify(state));
    writeAtomic(PLAN_FILE, JSON.stringify({ v: 1, stories: STORIES, made: new Date().toISOString(), actions }));
    lastSave = Date.now();
  }
  const outOfTime = () => Date.now() - startedAt > BUDGET_MS;

  function plan(action) {
    const id = action.kind + ":" + action.story + ":" + action.seq;
    if (planned.has(id)) return;
    planned.add(id);
    actions.push(action);
    note("  " + action.kind.toUpperCase() + " story " + action.story + " part " + action.seq + ": " + action.note);
  }

  /** Plans a hide; the apply step re-checks the evidence on the chain before signing. */
  function hide(storyId, seq, seg, seen, afterRestore) {
    plan({
      kind: "hide", story: Number(storyId), seq: Number(seq), t: textKey(seg.text), reason: seen.reason,
      note: cleanNote(seen.why, "copied text"), src: seen.src || null, label: seen.label || "",
      copyOf: seen.copyOf || undefined, sourceKind: seen.sourceKind || undefined, published: seen.published || undefined,
      afterRestore: afterRestore || undefined,
    });
  }

  /** A public note under the part. Nothing is hidden. Never over a note it already has. */
  function sourceNote(storyId, seq, seg, text) {
    if (seg.source_note && seg.source_note.length) return;
    plan({ kind: "note", story: Number(storyId), seq: Number(seq), t: textKey(seg.text), note: cleanNote(text, "Parts of this text also appear elsewhere.") });
  }

  /**
   * A part's fingerprint, with when each of its hashes was first written
   * (AB-076): an edit or a paid change never makes the words it left alone
   * look new. Words the part had when it was last checked keep their time;
   * for a part never checked, its kept versions say when each first
   * appeared. Words nothing older shows are dated by the part's last change.
   * Returns { hashes, at, newer } in the index's form, or null when the
   * versions could not all be read (O1-16): then the part waits for the next
   * run instead of having its old words dated "now".
   */
  async function dateText(storyId, seq, seg) {
    const hashes = fingerprint(seg.text);
    const now = textAt(seg);
    const first = new Map();
    const prev = index.parts.get(storyId + ":" + seq);
    const total = Number(seg.version_count || 0);
    if (prev) {
      for (const h of prev.hashes) first.set(h, dateOf(prev, h));
    } else if (now > Number(seg.created_at || 0) && total > 0) {
      let versions;
      try {
        const ask = (from, count) => read("get_versions", { story_id: String(storyId), seq: String(seq), from, count });
        versions = await readAllVersions(ask, total);
      } catch (error) {
        note("  could not read the versions of story " + storyId + " part " + seq + " (" + errText(error) + "): checked next run");
        return null;
      }
      if (versions.length !== total) {
        note("  read " + versions.length + " of " + total + " versions of story " + storyId + " part " + seq + ": checked next run");
        return null;
      }
      for (const v of versions) {
        const at = Number(v.at || 0);
        if (!at) {
          note("  a version of story " + storyId + " part " + seq + " has no date: checked next run");
          return null;
        }
        for (const h of fingerprint(v.text)) if (!first.has(h)) first.set(h, at);
      }
    }
    const when = hashes.map((h) => first.get(h) || now);
    const at = when.length ? Math.min(...when) : now;
    const newer = {};
    hashes.forEach((h, i) => { if (when[i] > at) newer[h] = when[i]; });
    return { hashes, at, newer };
  }

  /** Indexes a part's dated text; `skip` keeps only the dates (a copy, or a part with a note). */
  function indexText(key, seg, dated, skip, copyOf = undefined) {
    index.add(key, seg.author, dated.hashes, dated.at, copyOf, { newer: dated.newer, skip });
  }

  /**
   * Compares one part's text with SwarmTales and, with alsoWeb, the web.
   * Plans a source note for a partial match. Returns "defer" (search budget
   * used up: try next run) or a verdict: { v: "clean" }, { v: "note" },
   * { v: "copy", reason, why, note, src, label, copyOf | sourceKind+published }
   * (a clear copy, to be hidden) or { v: "cited", ... } (a clear copy of a
   * source the writer cited: left alone while the citation names it).
   */
  async function checkPart(storyId, seq, seg, alsoWeb, dated) {
    const key = storyId + ":" + seq;
    const { hashes } = dated;
    const at = (h) => dateOf(dated, h);
    // Only words written before this part's count, so an original is never
    // flagged for a copy made after it (AB-005), even after an edit (AB-076).
    const match = index.bestMatch(hashes, seg.author, key, at);
    if (match && (isDuplicate(hashes, match) || isPartialDuplicate(hashes, match))) {
      const [srcStory, srcSeq] = match.key.split(":");
      const pct = Math.round(match.ratio * 100);
      const noteText = "About " + pct + "% of this text also appears in story " + srcStory + ", part " + srcSeq + ".";
      if (isDuplicate(hashes, match)) {
        return { v: "copy", reason: REASON.DUPLICATE, why: pct + "% of this part matches story " + srcStory + ", part " + srcSeq + ", by another writer",
          note: noteText, copyOf: match.key };
      }
      sourceNote(storyId, seq, seg, noteText);
      return { v: "note" };
    }
    // Written at the same time as a matching part: nobody can tell which is
    // the original, so both get a source note and neither is hidden (AB-024).
    const tie = index.tieMatch(hashes, seg.author, key, at);
    if (tie && (isDuplicate(hashes, tie) || isPartialDuplicate(hashes, tie))) {
      const [tieStory, tieSeq] = tie.key.split(":");
      const pct = Math.round(tie.ratio * 100);
      sourceNote(storyId, seq, seg, "About " + pct + "% of this text also appears in story " + tieStory + ", part " + tieSeq + ", written at the same time.");
      // Read the other part first: it may be gone by now, or already carry a
      // note (from the web check, say) that must not be overwritten (AB-030).
      try {
        const partner = await read("get_segment", { story_id: tieStory, seq: tieSeq });
        if (Number(partner.status) === 1 && partner.text) {
          sourceNote(tieStory, tieSeq, partner, "Much of this text also appears in story " + storyId + ", part " + seq + ", written at the same time.");
        }
      } catch (error) {
        note("  could not read story " + tieStory + " part " + tieSeq + ": " + errText(error));
      }
      return { v: "note" };
    }
    // With a search key set, a long part is never judged without its search:
    // out of searches, it waits for the next run (AB-083).
    if (alsoWeb && String(seg.text).length >= WEB_MIN_CHARS && searchKeys.length) {
      const web = await webCheck(seg.text, spendable, seg.citation);
      if (web === "defer") return "defer";
      if (web) {
        const noteText = "Parts of this text also appear in " + web.label + ".";
        // Hidden only when the source is a book provably older than the part
        // (M-11). A website, or a book that may be newer (it may have copied
        // the part), gets a note and the part stays visible.
        if (web.action === "hide" && web.kind === "book" && provablyOlder(web.published, seg.created_at)) {
          const found = { reason: REASON.COPYRIGHT, why: "copied text: " + web.found + " of " + web.of + " phrases found, " + web.same + " of them in " +
            web.label + " (published " + web.published + ")", note: noteText, src: web.source, label: web.label, sourceKind: "book", published: web.published };
          // The writer named this source: left alone, but only while the citation names it (AB-067).
          return { v: web.cited ? "cited" : "copy", ...found };
        }
        if (web.cited) return { v: "clean" }; // the writer named this source
        sourceNote(storyId, seq, seg, noteText);
        return { v: "note" };
      }
    }
    return { v: "clean" };
  }

  /**
   * O1-07: the chain says the story's opener or an editor restored a checker
   * hide of this part (restore_segment sets refund_forfeited only for a hide
   * the checker made), so its text is never hidden again. Which text: the
   * one the saved progress says was hidden then, or else the text now
   * (recorded now), so losing the saved progress can only protect more.
   */
  function openerRestored(key, seg) {
    if (!(seg.restored && seg.refund_forfeited)) return false;
    const t = textKey(seg.text);
    if (!state.protect[key]) state.protect[key] = t;
    return state.protect[key] === t;
  }

  /**
   * Acts on a part's verdict. A clear copy is hidden, and a hide writer
   * reports made for copying is taken over in place (AB-071, AB-078). A hide
   * the admin holds is left to the admin. A copy whose checker hide was
   * undone (its opener restored it, or the admin) is never hidden again for
   * the same text; it gets a source note instead.
   */
  async function enforce(storyId, seq, seg, seen) {
    const key = storyId + ":" + seq;
    if (seen.v === "copy" && Number(seg.hidden_by || 0) !== 2 && openerRestored(key, seg)) seen.v = "overruled";
    if (seen.v === "overruled") {
      // Indexed after all, so a copy of it made later is still caught.
      const entry = index.parts.get(key);
      if (!entry || entry.skip) {
        indexText(key, seg, entry || { hashes: fingerprint(seg.text), at: textAt(seg) }, false, seen.copyOf);
      }
      if (seen.note) sourceNote(storyId, seq, seg, seen.note);
      return;
    }
    if (seen.v !== "copy") return;
    const by = Number(seg.hidden_by || 0);
    if (seg.hidden) {
      if (by === 2) {
        if (!state.hiddenByChecker[key]) state.hiddenByChecker[key] = { source: seen.src || null, label: seen.label || "", t: textKey(seg.text) };
        return;
      }
      if (by !== 1) {
        seen.admin = true; // the admin's hide: left to the admin
        return;
      }
      // A hide writer reports made for anything but copying (abuse, spam) is
      // never taken over, so no citation can lift it (AB-078).
      const reason = Number(seg.moderation_reason || 0);
      if (reason !== REASON.COPYRIGHT && reason !== REASON.DUPLICATE) return;
    } else if (seen.admin) {
      // The admin looked at it and unhid it: only the admin decides (AB-077).
      seen.v = "overruled";
      await enforce(storyId, seq, seg, seen);
      return;
    }
    hide(storyId, seq, seg, seen, seg.restored && seg.refund_forfeited);
  }

  /**
   * Checks a live part whose text the checker hasn't judged yet (new, or
   * changed since: AB-067), or re-reads its citation, then acts on the
   * verdict. Returns "done", "defer" (out of searches) or "retry" (its
   * versions could not be read).
   */
  async function review(storyId, seq, seg, alsoWeb) {
    const key = storyId + ":" + seq;
    const t = textKey(seg.text);
    const c = textKey(seg.citation);
    let seen = state.seen[key];
    if (!seen || seen.t !== t) {
      const dated = await dateText(storyId, seq, seg);
      if (!dated) return "retry";
      const verdict = await checkPart(storyId, seq, seg, alsoWeb, dated);
      if (verdict === "defer") return "defer";
      seen = state.seen[key] = { t, c, ...verdict };
      // Only clean and cited text counts as an original; the rest keeps its dates (AB-076).
      indexText(key, seg, dated, !(verdict.v === "clean" || verdict.v === "cited"));
    } else if (seen.c !== c) {
      seen.c = c;
      // A cited source counts only while the citation still names it (AB-067).
      if (seen.v === "cited" || (seen.v === "copy" && seen.src)) seen.v = citationCovers(seg.citation || "", seen.src) ? "cited" : "copy";
    }
    await enforce(storyId, seq, seg, seen);
    return "done";
  }

  /** Whether a live part read again needs review this run. */
  function needsReview(key, seg) {
    const seen = state.seen[key];
    if (!seen || seen.t !== textKey(seg.text)) return true;
    if (seen.v === "copy" || seen.v === "cited") return true;
    return seen.v === "overruled" && !!seen.note && !(seg.source_note && seg.source_note.length);
  }

  // Parts the checker hid: bring one back when its writer has named the source,
  // and stop holding the ones someone else took over or undid. Only the
  // checker's own hide (hidden_by 2): never one the admin or writer reports
  // made (AB-061).
  for (const key of Object.keys(state.hiddenByChecker)) {
    try {
      const [sid, sq] = key.split(":");
      const seg = await read("get_segment", { story_id: sid, seq: sq });
      const entry = state.hiddenByChecker[key];
      if (Number(seg.status) !== 1) {
        delete state.hiddenByChecker[key];
        continue;
      }
      if (!seg.hidden || Number(seg.hidden_by || 0) !== 2) {
        // Its opener restored it (which forfeits the refund), or the admin
        // took it over or unhid it: the checker never hides this text again.
        if (seg.restored && seg.refund_forfeited && !seg.hidden) state.protect[key] = entry.t || textKey(seg.text);
        if (state.seen[key]) state.seen[key].v = "overruled";
        delete state.hiddenByChecker[key];
        continue;
      }
      if (seg.citation && citationCovers(seg.citation, entry.source)) {
        plan({ kind: "unhide", story: Number(sid), seq: Number(sq), t: textKey(seg.text), note: "source cited by the writer",
          src: entry.source, label: entry.label || "" });
      }
    } catch (error) {
      note("  could not re-check " + key + ": " + errText(error));
    }
  }

  // 1. Read every story's new parts, and its older parts again whenever
  // anything in the story changed since they were checked: a part reworded
  // after its check is checked again, web search included (AB-067). Parts
  // are read a few at a time (M-5).
  // A run out of time stops reading; the next one starts reading where it
  // stopped (state.readFrom), so no story waits for good behind the others.
  const next = Number(cfg.next_story_id || 1);
  const fresh = [];
  const full = [];
  const marks = new Map(); // story id -> what it looked like when read in full
  const reread = new Set();
  const first = Number(state.readFrom) >= 1 && Number(state.readFrom) < next ? Number(state.readFrom) : 1;
  delete state.readFrom;
  for (let n = 0; n < next - 1; n++) {
    const id = ((first - 1 + n) % (next - 1)) + 1;
    if (outOfTime() && fresh.some((s) => s.parts.length)) {
      state.readFrom = id;
      note("Out of time while reading stories: reading goes on from story " + id + " next run.");
      break;
    }
    try {
      const st = await read("get_story", { story_id: String(id) });
      const status = Number(st.status || 0);
      if (!status) continue;
      const count = Number(st.segment_count || 0);
      const checkedUpTo = Number(state.checked[id] || 0);
      const mark = activityMark(st);
      // Text changes while a story is open, locked or in its final edit.
      const again = status <= 3 && (mark === null || state.activity[id] !== mark);
      const parts = [];
      for (const { seq, seg } of await readParts(read, id, again ? 1 : checkedUpTo + 1, count, PER_READ)) {
        const key = id + ":" + seq;
        reread.add(key);
        if (seq > checkedUpTo) parts.push({ seq, at: Number(seg.created_at || 0), seg, isNew: true });
        else if (Number(seg.status) !== 1 || !seg.text) delete state.seen[key];
        else if (needsReview(key, seg)) parts.push({ seq, at: textAt(seg), seg });
      }
      fresh.push({ id, parts });
      if (again) marks.set(id, mark);
      if ((status === 2 || status === 3) && !state.swept[id]) full.push({ id, count });
    } catch (error) {
      note("Story " + id + ": " + errText(error) + " (will retry next run)");
    }
  }
  // Copies waiting to be hidden, and cited copies, in stories not read again:
  // their hide or their citation can change without any new text.
  for (const key of Object.keys(state.seen)) {
    const seen = state.seen[key];
    if (reread.has(key) || (seen.v !== "copy" && seen.v !== "cited")) continue;
    const [sid, sq] = key.split(":").map(Number);
    try {
      const seg = await read("get_segment", { story_id: String(sid), seq: String(sq) });
      if (Number(seg.status) !== 1 || !seg.text) delete state.seen[key];
      else if (needsReview(key, seg)) fresh.push({ id: sid, parts: [{ seq: sq, at: textAt(seg), seg }] });
    } catch (error) {
      note("  could not re-check " + key + ": " + errText(error));
    }
  }

  // 2. Check them oldest first across all stories, so a copy is always
  // checked after the text it copied, whatever the story numbers (AB-005).
  // A story's new parts stay in part order, so state.checked stays a safe
  // "done up to" mark when the run stops early. Hidden parts are checked
  // too: one hidden by writer reports is taken over if it is a copy (AB-071).
  // A part that waited for its search last run is checked first (AB-083).
  // At least one part is checked every run, whatever the time budget.
  const stopped = new Set();
  const waiting = (p) => (state.pending[p.story + ":" + p.seq] ? 1 : 0);
  const order = checkOrder(fresh).sort((a, b) => waiting(b) - waiting(a));
  const left = new Map();
  for (const p of order) left.set(p.story, (left.get(p.story) || 0) + 1);
  let done = 0;
  for (const { story: id, seq, seg, isNew } of order) {
    if (stopped.has(id)) continue;
    if (done > 0 && outOfTime()) {
      note("Out of time: the remaining parts are checked next run.");
      break;
    }
    const key = id + ":" + seq;
    try {
      if (Number(seg.status) === 1 && seg.text) {
        const r = await review(id, seq, seg, true);
        // Out of free searches for this run: this part and everything after
        // it waits for the next run, still unchecked.
        if (r === "defer") {
          state.pending[key] = true;
          break;
        }
        // Its versions couldn't be read: this story waits for the next run.
        if (r === "retry") {
          stopped.add(id);
          continue;
        }
      }
      delete state.pending[key];
      if (isNew) state.checked[id] = seq;
      left.set(id, left.get(id) - 1);
      done += 1;
      save(false);
    } catch (error) {
      stopped.add(id);
      note("Story " + id + ": " + errText(error) + " (will retry next run)");
    }
  }
  // A story read in full counts as up to date once every part of it is done.
  // A change in the last few minutes may share its second with one still to
  // come, so such a story is read in full again next run. last_activity_at
  // is on Stories' activity clock, which stops while Stories is paused.
  const clock = activityNow(cfg, now.getTime() / 1000);
  for (const [id, mark] of marks) {
    const recent = mark === null || clock - Number(mark.split(":")[0]) < 300;
    if (!left.get(id) && !recent) state.activity[id] = mark;
    else delete state.activity[id];
  }

  // 3. Before a story can be finished: one more full comparison, once.
  for (const { id, count } of full) {
    if (outOfTime() && done > 0) break;
    try {
      note("Story " + id + " is full: checking all of it once more before it can be finished.");
      for (const { seq, seg } of await readParts(read, id, 1, count, PER_READ)) {
        if (Number(seg.status) !== 1 || !seg.text) continue;
        const key = id + ":" + seq;
        const t = textKey(seg.text);
        const seen = state.seen[key];
        if (seen && seen.t === t && (seen.v === "copy" || seen.v === "overruled")) continue;
        const dated = await dateText(id, seq, seg);
        if (!dated) throw new Error("part " + seq + " could not be dated");
        const verdict = await checkPart(id, seq, seg, false, dated);
        if (verdict === "defer" || verdict.v !== "copy") continue;
        state.seen[key] = { t, c: textKey(seg.citation), ...verdict };
        indexText(key, seg, dated, true);
        await enforce(id, seq, seg, state.seen[key]);
      }
      state.swept[id] = true;
      done += 1;
    } catch (error) {
      note("Story " + id + ": " + errText(error) + " (will retry next run)");
    }
  }

  save(true);
  note("Planned: " + actions.filter((a) => a.kind === "hide").length + " hide(s), " + actions.filter((a) => a.kind === "note").length + " note(s), " +
    actions.filter((a) => a.kind === "unhide").length + " unhide(s). Searches this run: " + searchesThisRun + "." +
    SERVICES.filter((s) => searchKeys.includes(s.label)).map((s) => " " + s.label + " left this month: " + budgets[s.name].left() + ".").join(""));
  writeSummary(actions);
  if (noKey) {
    note("::error title=Copy checker::" + load.detail + ": this run only reported. Add CHECKER_STATE_KEY to the copy-checker environment.");
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code), (error) => {
  console.error(logLine("Copy checker stopped: " + errText(error)));
  process.exit(1);
});
