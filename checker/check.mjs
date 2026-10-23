#!/usr/bin/env node
/**
 * SwarmTales copy checker. Runs on a schedule in GitHub Actions (free for
 * public repositories). Each run:
 *   1. reads every story part added since the last run, and every part
 *      whose text or citation changed since it was checked (a part
 *      reworded after its check is checked again, AB-067);
 *   2. compares it with other writers' text on SwarmTales written before it
 *      (fingerprints), oldest parts first, so the later of two matching
 *      parts is the one treated as the copy;
 *   3. optionally, searches for three exact phrases from longer parts, using
 *      whichever free search keys are set (all optional, all free, no card):
 *        GOOGLE_BOOKS_KEY  Google Books: searches inside millions of books
 *        TAVILY_API_KEY    Tavily web search (free: 1,000 searches a month)
 *        BRAVE_API_KEY     Brave web search (Brave now needs a card; kept for anyone who has a key)
 *   4. acts gently, by itself (no one has to review anything):
 *        - a clear copy is hidden: 4 or more of 5 phrases found, 3 or more in
 *          the same book or site; or 80%+ of the part matches another
 *          writer's part on SwarmTales;
 *        - a partial match is NOT hidden: it gets a public source note under
 *          the part ("Parts of this text also appear in …");
 *        - a match with a part written at the same time (same block or
 *          second) is NOT hidden: both parts get a source note, since
 *          nobody can tell which came first;
 *        - a match with a source the writer cited is left alone;
 *        - a part hidden by writer reports is checked too; a clear copy is
 *          taken over as the checker's hide, so restoring it forfeits the
 *          refund as if the checker had hidden it first (AB-071);
 *        - a part whose checker hide its opener restored (or the admin
 *          undid) is never hidden again for the same text (it can still get
 *          a note); new text is checked again.
 *      Signed with the MODERATOR key, which can only hide, unhide and add
 *      notes. Every action is a public event with a note.
 *   5. when a story fills up or enters its final edit, checks all of it once
 *      more against everything else, before it can be finished.
 *
 * Environment:
 *   STORIES_ADDRESS   Stories contract (required)
 *   RPC               node URL (default: the Foundation testnet)
 *   EXPECTED_CHAIN_ID the chain id the node must serve; needed for any node other than
 *                     the Foundation testnet or api.koinos.io (checked before signing)
 *   MODERATOR_WIF     the moderator's private key (secret). Without it the
 *                     checker only reports what it would hide.
 *   GOOGLE_BOOKS_KEY  optional, book phrase check (stays under BOOKS_MONTHLY, default 25000;
 *                     Google's free quota is 1,000 a day)
 *   TAVILY_API_KEY    optional, web phrase check (stays under TAVILY_MONTHLY, default 950)
 *   BRAVE_API_KEY     optional, web phrase check (stays under SEARCH_MONTHLY, default 1800)
 *   SEARCH_PER_RUN    searches per run, all services together (default 40)
 *   TEST_PHRASE       if set: only search this phrase with every service that has a key,
 *                     print what each one found, and stop (to check the keys work)
 *   IGNORE_HOSTS      comma list of hosts never counted as a source
 *   STATE_FILE        where progress is kept between runs (default checker-state.json)
 *   DRY_RUN=1         never send anything
 */
import { createHash } from "crypto";
import fs from "fs";
import { createRequire } from "module";
import {
  HIDE_FOUND, Index, REASON, WEB_MIN_CHARS, budget, checkChainId, checkOrder, citationCovers, dateOf, decide, expectedChainId, fingerprint, isDuplicate,
  isPartialDuplicate, normalizeResults, pickPhrases, resultMatches, worthAsking,
} from "./lib.mjs";
import { readAllVersions } from "../web/src/lib/versions.js";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { Contract, Provider, Signer, Transaction } = require("koilib");
const { abis } = await import("../web/src/generated/abis.js");

const env = process.env;
const STORIES = env.STORIES_ADDRESS;
const RPC = env.RPC || "https://testnet.koinosfoundation.org";
const STATE_FILE = env.STATE_FILE || "checker-state.json";
const DRY_RUN = env.DRY_RUN === "1";
const MONTHLY = Number(env.SEARCH_MONTHLY || 1800);
const BOOKS_MONTHLY = Number(env.BOOKS_MONTHLY || 25000);
const TAVILY_MONTHLY = Number(env.TAVILY_MONTHLY || 950);
const PER_RUN = Number(env.SEARCH_PER_RUN || 40);
const IGNORE = ["bawcejawn.github.io", "koinosblocks.com", "koiner.app", "kollection.app"]
  .concat(String(env.IGNORE_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

const log = [];
function note(line) {
  console.log(line);
  log.push(line);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { checked: {}, swept: {}, index: {} };
  }
}

function saveState(state, index) {
  state.index = index.toJSON();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function writeSummary(actions) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const rows = actions.length
    ? actions.map((a) => `| ${a.story} | ${a.seq} | ${a.kind === "note" ? "source note" : a.kind === "unhide" ? "brought back" : a.reason === REASON.COPYRIGHT ? "copied text" : "duplicate"} | ${a.note} | ${a.kind === "note" ? (a.sent ? "noted" : "would note") : a.kind === "unhide" ? (a.sent ? "unhidden" : "would unhide") : a.sent ? "hidden" : "would hide"} |`).join("\n")
    : "| | | | nothing to hide | |";
  fs.appendFileSync(file, "## SwarmTales copy checker\n\n| story | part | why | note | action |\n|---|---|---|---|---|\n" + rows + "\n\n```\n" + log.join("\n") + "\n```\n");
}

/** A short key for a text, to notice when a part's text or citation changes (AB-067). */
function textKey(text) {
  return createHash("sha256").update(String(text || "")).digest("base64").slice(0, 16);
}

/**
 * When a part's text last changed: its last edit, or when it was added. Used
 * for the order parts are checked in, and as the time of words nothing older
 * shows (AB-076: words are compared by when they were first written).
 */
function textAt(seg) {
  const created = Number(seg.created_at || 0);
  const edited = Number(seg.last_edited_at || 0);
  return edited > created ? edited : created;
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
    async ask(phrase) {
      const url = "https://www.googleapis.com/books/v1/volumes?maxResults=5&q=" + encodeURIComponent('"' + phrase + '"') +
        "&key=" + encodeURIComponent(env.GOOGLE_BOOKS_KEY.trim());
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      return res;
    },
  },
  {
    name: "tavily",
    label: "Tavily",
    key: () => env.TAVILY_API_KEY,
    monthly: TAVILY_MONTHLY,
    async ask(phrase) {
      return fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.TAVILY_API_KEY.trim() },
        body: JSON.stringify({ query: '"' + phrase + '"', search_depth: "basic", max_results: 5 }),
      });
    },
  },
  {
    name: "brave",
    budgetName: "search",
    label: "Brave",
    key: () => env.BRAVE_API_KEY,
    monthly: MONTHLY,
    async ask(phrase) {
      const url = "https://api.search.brave.com/res/v1/web/search?count=5&q=" + encodeURIComponent('"' + phrase + '"');
      const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_API_KEY.trim() } });
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
    note("  " + service.label + " search failed (" + (error && error.message ? error.message : String(error)) + ")");
    return "failed";
  }
}

/**
 * Search up to five phrases of a part. A phrase counts as found when any
 * service finds it. Books are asked first (the free quota is large and copied
 * book text is the main risk), then the web. Returns null (nothing worth
 * noting), "defer" (a phrase that mattered went unanswered: no free searches
 * left this run, or every service failed; try next run, AB-083), or
 * { action: "hide" | "note", found, same, label, cited }.
 */
async function webCheck(text, spendable, citation) {
  const phrases = pickPhrases(text);
  if (phrases.length < HIDE_FOUND) return null;
  if (!spendable.any() || spendable.leftThisRun() < phrases.length) return "defer";
  const found = [];
  const labels = new Map();
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
    if (hit) {
      let host = "";
      try { host = new URL(hit.url).host; } catch { host = hit.url || "a website"; }
      const key = hit.source ? (hit.source.title + "|" + hit.source.author).toLowerCase() : host.toLowerCase();
      if (!labels.has(key)) labels.set(key, { label: hit.label || host, source: hit.source || host });
      found.push(key);
    } else {
      found.push(null);
    }
  }
  const d = decide(found);
  if (d.action === "none") return null;
  const where = labels.get(d.source);
  const cited = !!where && citationCovers(citation || "", where.source);
  return { action: d.action, found: d.found, same: d.same, of: phrases.length, label: where ? where.label : "", source: where ? where.source : null, cited };
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
      note("  " + service.label + ": FAILED (" + (error && error.message ? error.message : String(error)) + ")");
    }
  }
}

async function main() {
  if (env.TEST_PHRASE && env.TEST_PHRASE.trim()) {
    await testPhrase(env.TEST_PHRASE.trim());
    writeSummary([]);
    return;
  }
  if (!STORIES) throw new Error("Set STORIES_ADDRESS.");
  const provider = new Provider([RPC]);
  // Sign only for the chain we expect, checked against the node (AB-015).
  const chainId = expectedChainId(RPC, env.EXPECTED_CHAIN_ID);
  checkChainId(chainId, await provider.getChainId());
  const stories = new Contract({ id: STORIES, abi: abis.stories, provider });
  const read = async (name, args) => (await stories.functions[name](args || {})).result || {};

  const cfg = await read("get_config");
  let signer = null;
  if (env.MODERATOR_WIF && !DRY_RUN) {
    signer = Signer.fromWif(env.MODERATOR_WIF.trim());
    signer.provider = provider;
    if (signer.getAddress() !== cfg.moderator) {
      note("The moderator key (" + signer.getAddress() + ") is not the contract's moderator (" + (cfg.moderator || "none") + "). Report-only this run.");
      signer = null;
    }
  }
  if (!signer) note("Report-only: nothing will be hidden this run.");

  const state = loadState();
  state.checked = state.checked || {};
  state.swept = state.swept || {};
  const index = Index.fromJSON(state.index);
  const now = new Date();
  const budgets = {};
  for (const s of SERVICES) budgets[s.name] = budget(state, now, s.monthly, s.budgetName || "search_" + s.name);
  const disabled = new Set();
  let searchesThisRun = 0;
  const spendable = {
    services: () => SERVICES.filter((s) => s.key() && !disabled.has(s.name)),
    ok: (s) => searchesThisRun < PER_RUN && budgets[s.name].left() > 0,
    leftThisRun: () => Math.min(PER_RUN - searchesThisRun,
      spendable.services().reduce((sum, s) => sum + budgets[s.name].left(), 0)),
    any: () => spendable.services().some((s) => spendable.ok(s)),
    spend: (s) => { searchesThisRun += 1; budgets[s.name].spend(); },
    disable: (s) => disabled.add(s.name),
  };
  const searchKeys = SERVICES.filter((s) => s.key()).map((s) => s.label);
  note(searchKeys.length ? "Phrase search with: " + searchKeys.join(", ") + "." : "No search key set: only SwarmTales' own text is compared.");
  const actions = [];

  state.noted = state.noted || {};
  state.hiddenByChecker = state.hiddenByChecker || {};
  // Each part's text and citation as last checked, and the verdict (AB-067).
  state.seen = state.seen || {};
  state.activity = state.activity || {};
  // Parts an older checker found hidden and never checked.
  const neverChecked = new Set(Object.keys(state.hiddenWhenRead || {}));
  delete state.hiddenWhenRead;

  /** Sign one Stories call with the moderator key (at most 0.5 mana; a hide uses about 0.05). */
  async function sendAsModerator(name, args) {
    if (!signer) return false;
    const mana = BigInt(await provider.getAccountRc(signer.getAddress()));
    if (mana === 0n) {
      note("  the moderator wallet has no mana; send it a little KOIN (it is never spent)");
      return false;
    }
    const limit = mana < 50000000n ? mana : 50000000n;
    const tx = new Transaction({ signer, provider, options: { payer: signer.getAddress(), rcLimit: limit.toString(), chainId } });
    await tx.pushOperation(await stories.encodeOperation({ name, args: { actor: signer.getAddress(), ...args } }));
    await tx.prepare();
    await tx.sign();
    const receipt = await tx.send();
    await tx.wait();
    if (receipt && receipt.reverted) {
      note("  the chain refused: " + (receipt.logs || []).join(" "));
      return false;
    }
    return true;
  }

  /** Returns whether the hide was sent. */
  async function hide(storyId, seq, reason, why) {
    const action = { story: storyId, seq, reason, kind: "hide", note: String(why || "copied text").slice(0, 200), sent: false };
    actions.push(action);
    note("  HIDE story " + storyId + " part " + seq + ": " + action.note);
    action.sent = await sendAsModerator("set_segment_hidden", {
      story_id: String(storyId), seq: String(seq), hidden: true, reason, note: action.note,
    });
    return action.sent;
  }

  /** A public note under the part. Nothing is hidden. Added once per part. */
  async function sourceNote(storyId, seq, seg, text) {
    const key = storyId + ":" + seq;
    if (state.noted[key] || (seg.source_note && seg.source_note.length)) return;
    const action = { story: storyId, seq, reason: 0, kind: "note", note: text.slice(0, 200), sent: false };
    actions.push(action);
    note("  NOTE story " + storyId + " part " + seq + ": " + action.note);
    action.sent = await sendAsModerator("set_source_note", { story_id: String(storyId), seq: String(seq), note: action.note });
    if (action.sent || !signer) state.noted[key] = true;
  }

  /**
   * A part's fingerprint, with when each of its hashes was first written
   * (AB-076): an edit or a paid change never makes the words it left alone
   * look new. Words the part had when it was last checked keep their time;
   * for a part never checked, its kept versions say when each first
   * appeared. Words nothing older shows are dated by the part's last change.
   * Returns { hashes, at, newer } in the index's form.
   */
  async function dateText(storyId, seq, seg) {
    const hashes = fingerprint(seg.text);
    const now = textAt(seg);
    const first = new Map();
    const prev = index.parts.get(storyId + ":" + seq);
    if (prev) {
      for (const h of prev.hashes) first.set(h, dateOf(prev, h));
    } else if (now > Number(seg.created_at || 0) && Number(seg.version_count || 0) > 0) {
      try {
        const ask = (from, count) => read("get_versions", { story_id: String(storyId), seq: String(seq), from, count });
        for (const v of await readAllVersions(ask, seg.version_count)) {
          for (const h of fingerprint(v.text)) if (!first.has(h)) first.set(h, Number(v.at || 0));
        }
      } catch (error) {
        note("  could not read the versions of story " + storyId + " part " + seq + ": " + (error && error.message ? error.message : String(error)));
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
   * Adds a source note for a partial match. Returns "defer" (search budget
   * used up: try next run) or a verdict: { v: "clean" }, { v: "note" },
   * { v: "copy", reason, why, note, src, label, copyOf } (a clear copy, to be
   * hidden) or { v: "cited", ... } (a clear copy of a source the writer cited:
   * left alone while the citation names it). `dated`: the text's hashes and
   * when each was first written (dateText).
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
      await sourceNote(storyId, seq, seg, noteText);
      return { v: "note" };
    }
    // Written at the same time as a matching part: nobody can tell which is
    // the original, so both get a source note and neither is hidden (AB-024).
    const tie = index.tieMatch(hashes, seg.author, key, at);
    if (tie && (isDuplicate(hashes, tie) || isPartialDuplicate(hashes, tie))) {
      const [tieStory, tieSeq] = tie.key.split(":");
      const pct = Math.round(tie.ratio * 100);
      await sourceNote(storyId, seq, seg, "About " + pct + "% of this text also appears in story " + tieStory + ", part " + tieSeq + ", written at the same time.");
      // Read the other part first: it may be gone by now, or already carry a
      // note (from the web check, say) that must not be overwritten (AB-030).
      try {
        const partner = await read("get_segment", { story_id: tieStory, seq: tieSeq });
        if (Number(partner.status) === 1) {
          await sourceNote(Number(tieStory), Number(tieSeq), partner, "Much of this text also appears in story " + storyId + ", part " + seq + ", written at the same time.");
        }
      } catch (error) {
        note("  could not read story " + tieStory + " part " + tieSeq + ": " + (error && error.message ? error.message : String(error)));
      }
      return { v: "note" };
    }
    // With a search key set, a long part is never judged without its search:
    // out of searches, it waits for the next run (AB-083).
    if (alsoWeb && String(seg.text).length >= WEB_MIN_CHARS && searchKeys.length) {
      const web = await webCheck(seg.text, spendable, seg.citation);
      if (web === "defer") return "defer";
      if (web && web.action === "hide") {
        const found = { reason: REASON.COPYRIGHT, why: "copied text: " + web.found + " of " + web.of + " phrases found, " + web.same + " of them in " + web.label,
          note: "Parts of this text also appear in " + web.label + ".", src: web.source, label: web.label };
        // The writer named this source: left alone, but only while the citation names it (AB-067).
        return { v: web.cited ? "cited" : "copy", ...found };
      }
      if (web && web.cited) return { v: "clean" }; // the writer named this source
      if (web) {
        await sourceNote(storyId, seq, seg, "Parts of this text also appear in " + web.label + ".");
        return { v: "note" };
      }
    }
    return { v: "clean" };
  }

  /**
   * Acts on a part's verdict. A clear copy is hidden, and a hide writer
   * reports made is taken over in place, so it is treated exactly like one the
   * checker made first: no refund on removal, and restoring it forfeits the
   * refund (AB-071). A hide the admin holds is left to the admin. A copy whose
   * checker hide was undone (its opener restored it, or the admin) is never
   * hidden again for the same text; it gets a source note instead.
   */
  async function enforce(storyId, seq, seg, seen) {
    const key = storyId + ":" + seq;
    if (seen.v === "overruled") {
      // Indexed after all, so a copy of it made later is still caught.
      const entry = index.parts.get(key);
      if (!entry || entry.skip) {
        indexText(key, seg, entry || { hashes: fingerprint(seg.text), at: textAt(seg) }, false, seen.copyOf);
      }
      if (seen.note) await sourceNote(storyId, seq, seg, seen.note);
      return;
    }
    if (seen.v !== "copy") return;
    const by = Number(seg.hidden_by || 0);
    if (seg.hidden) {
      if (by === 2) {
        if (!state.hiddenByChecker[key]) state.hiddenByChecker[key] = { source: seen.src || null, label: seen.label || "" };
        return;
      }
      // The admin's hide, or one from before hidden_by that may be the admin's.
      if (by === 3 || (by === 0 && !seg.hidden_by_reports)) {
        seen.admin = true;
        return;
      }
      // A hide writer reports made for anything but copying (abuse, spam) is
      // never taken over, so no citation can lift it (AB-078). If its opener
      // restores it, the copy is hidden then.
      const reason = Number(seg.moderation_reason || 0);
      if (reason !== REASON.COPYRIGHT && reason !== REASON.DUPLICATE) return;
    } else if (seen.admin) {
      // The admin looked at it and unhid it: only the admin can unhide the
      // admin's hide, whatever `restored` says from an older restore (AB-077).
      seen.v = "overruled";
      await enforce(storyId, seq, seg, seen);
      return;
    }
    // Remembered so the part comes back by itself if its writer names this
    // source, but only a hide that was sent: in a report-only run, or when
    // the chain refused it, the checker hid nothing it may undo (AB-061).
    if (await hide(storyId, seq, seen.reason, seen.why)) {
      state.hiddenByChecker[key] = { source: seen.src || null, label: seen.label || "" };
    }
  }

  /**
   * Checks a live part whose text the checker hasn't judged yet (new, or
   * changed since: AB-067), or re-reads its citation, then acts on the
   * verdict. Returns "defer" when the search budget ran out.
   */
  async function review(storyId, seq, seg, alsoWeb) {
    const key = storyId + ":" + seq;
    const t = textKey(seg.text);
    const c = textKey(seg.citation);
    let seen = state.seen[key];
    // Recorded by the hide re-check without the text: it is the text hidden then.
    if (seen && seen.t === undefined) seen.t = t;
    if (!seen || seen.t !== t) {
      const dated = await dateText(storyId, seq, seg);
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
  function needsReview(key, seq, seg, checkedUpTo) {
    const seen = state.seen[key];
    if (!seen) {
      const hid = state.hiddenByChecker[key];
      if (hid) {
        // Hidden by an older checker, which kept no verdict.
        state.seen[key] = { t: textKey(seg.text), c: textKey(seg.citation), v: "copy", reason: REASON.COPYRIGHT, why: "copied text",
          note: hid.label ? "Parts of this text also appear in " + hid.label + "." : "", src: hid.source, label: hid.label };
        return true;
      }
      // Checked by an older checker, which kept no text key: its text counts
      // as checked unless it was edited after it was written, was hidden
      // when that checker read it (and so never checked), or has a citation:
      // that checker kept no record of the parts it brought back because
      // their writer cited the source, so clearing the citation must find
      // them uncited (AB-080).
      const edited = Number(seg.last_edited_at || 0) > Number(seg.created_at || 0);
      if (seq <= checkedUpTo && !neverChecked.has(key) && !edited && !seg.citation) {
        state.seen[key] = { t: textKey(seg.text), c: textKey(seg.citation), v: "clean" };
        return false;
      }
      return true;
    }
    if (seen.t !== textKey(seg.text)) return true;
    if (seen.v === "copy" || seen.v === "cited") return true;
    return seen.v === "overruled" && !!seen.note && !state.noted[key] && !(seg.source_note && seg.source_note.length);
  }

  // Parts the checker hid: bring one back when its writer has named the source,
  // and stop holding the ones someone else took over or undid. Only the
  // checker's own hide (hidden_by 2): never one the admin or writer reports
  // made, or took over (AB-061).
  for (const key of Object.keys(state.hiddenByChecker)) {
    try {
      const [sid, sq] = key.split(":");
      const seg = await read("get_segment", { story_id: sid, seq: sq });
      const entry = state.hiddenByChecker[key];
      const seen = state.seen && state.seen[key];
      if (Number(seg.status) !== 1) {
        delete state.hiddenByChecker[key];
        continue;
      }
      if (!seg.hidden || Number(seg.hidden_by || 0) !== 2) {
        // Its opener restored it (which forfeits the refund), or the admin
        // took it over or unhid it: the checker never hides this text again.
        // Only a hide the chain accepted is recorded here, so it landed;
        // `restored` may be left over from an older restore and says nothing
        // about this one (AB-077).
        if (seen) seen.v = "overruled";
        delete state.hiddenByChecker[key];
        continue;
      }
      if (seg.citation && citationCovers(seg.citation, entry.source)) {
        note("  UNHIDE story " + sid + " part " + sq + ": the writer named the source (" + seg.citation.slice(0, 80) + ")");
        const ok = await sendAsModerator("set_segment_hidden", {
          story_id: sid, seq: sq, hidden: false, reason: 0, note: "source cited by the writer",
        });
        actions.push({ story: sid, seq: sq, reason: REASON.COPYRIGHT, kind: "unhide", note: "source cited by the writer", sent: ok });
        if (ok || !signer) {
          delete state.hiddenByChecker[key];
          // Kept: if the citation stops naming the source, it is hidden again (AB-067).
          if (state.seen) {
            state.seen[key] = { reason: REASON.COPYRIGHT, why: "copied text from " + (entry.label || "a source"),
              note: entry.label ? "Parts of this text also appear in " + entry.label + "." : "",
              ...(seen || {}), v: "cited", c: undefined, src: entry.source, label: entry.label };
          }
        }
      }
    } catch (error) {
      note("  could not re-check " + key + ": " + (error && error.message ? error.message : String(error)));
    }
  }

  // 1. Read every story's new parts.
  // And its older parts again whenever anything in the story changed since
  // they were checked: a part reworded after its check is checked again, web
  // search included (AB-067).
  const next = Number(cfg.next_story_id || 1);
  const fresh = [];
  const full = [];
  const marks = new Map(); // story id -> what it looked like when read in full
  const reread = new Set();
  for (let id = 1; id < next; id++) {
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
      for (let start = again ? 1 : checkedUpTo + 1; start <= count; start += 10) {
        const page = await read("get_segments", { story_id: String(id), start: String(start), limit: 10 });
        (page.values || []).forEach((seg, i) => {
          const seq = start + i;
          const key = id + ":" + seq;
          reread.add(key);
          if (seq > checkedUpTo) parts.push({ seq, at: Number(seg.created_at || 0), seg, isNew: true });
          else if (Number(seg.status) !== 1 || !seg.text) delete state.seen[key];
          else if (needsReview(key, seq, seg, checkedUpTo)) parts.push({ seq, at: textAt(seg), seg });
        });
      }
      fresh.push({ id, parts });
      if (again) marks.set(id, mark);
      if ((status === 2 || status === 3) && !state.swept[id]) full.push({ id, count });
    } catch (error) {
      note("Story " + id + ": " + (error && error.message ? error.message : String(error)) + " (will retry next run)");
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
      else if (needsReview(key, sq, seg, sq)) fresh.push({ id: sid, parts: [{ seq: sq, at: textAt(seg), seg }] });
    } catch (error) {
      note("  could not re-check " + key + ": " + (error && error.message ? error.message : String(error)));
    }
  }

  // 2. Check them oldest first across all stories, so a copy is always
  // checked after the text it copied, whatever the story numbers (AB-005).
  // A story's new parts stay in part order, so state.checked stays a safe
  // "done up to" mark when the run stops early. Hidden parts are checked
  // too: one hidden by writer reports is taken over if it is a copy (AB-071).
  // A part that waited for its search last run is checked first (AB-083).
  const stopped = new Set();
  state.pending = state.pending || {};
  const waiting = (p) => (state.pending[p.story + ":" + p.seq] ? 1 : 0);
  const order = checkOrder(fresh).sort((a, b) => waiting(b) - waiting(a));
  const left = new Map();
  for (const p of order) left.set(p.story, (left.get(p.story) || 0) + 1);
  for (const { story: id, seq, seg, isNew } of order) {
    if (stopped.has(id)) continue;
    const key = id + ":" + seq;
    try {
      if (Number(seg.status) === 1 && seg.text) {
        // Out of free searches for this run: this part and everything after
        // it waits for the next run, still unchecked.
        if (await review(id, seq, seg, true) === "defer") {
          state.pending[key] = true;
          break;
        }
      }
      delete state.pending[key];
      if (isNew) state.checked[id] = seq;
      left.set(id, left.get(id) - 1);
    } catch (error) {
      stopped.add(id);
      note("Story " + id + ": " + (error && error.message ? error.message : String(error)) + " (will retry next run)");
    }
  }
  // A story read in full counts as up to date once every part of it is done.
  // A change in the last few minutes may share its second with one still to
  // come, so such a story is read in full again next run.
  for (const [id, mark] of marks) {
    const recent = mark === null || now.getTime() / 1000 - Number(mark.split(":")[0]) < 300;
    if (!left.get(id) && !recent) state.activity[id] = mark;
    else delete state.activity[id];
  }

  // 3. Before a story can be finished: one more full comparison, once.
  for (const { id, count } of full) {
    try {
      note("Story " + id + " is full: checking all of it once more before it can be finished.");
      for (let start = 1; start <= count; start += 10) {
        const page = await read("get_segments", { story_id: String(id), start: String(start), limit: 10 });
        (page.values || []).forEach((seg, i) => { seg._seq = start + i; });
        for (const seg of page.values || []) {
          if (Number(seg.status) !== 1 || !seg.text) continue;
          const key = id + ":" + seg._seq;
          const t = textKey(seg.text);
          const seen = state.seen[key];
          if (seen && seen.t === t && (seen.v === "copy" || seen.v === "overruled")) continue;
          const dated = await dateText(id, seg._seq, seg);
          const verdict = await checkPart(id, seg._seq, seg, false, dated);
          if (verdict === "defer" || verdict.v !== "copy") continue;
          state.seen[key] = { t, c: textKey(seg.citation), ...verdict };
          indexText(key, seg, dated, true);
          await enforce(id, seg._seq, seg, state.seen[key]);
        }
      }
      state.swept[id] = true;
    } catch (error) {
      note("Story " + id + ": " + (error && error.message ? error.message : String(error)) + " (will retry next run)");
    }
  }

  saveState(state, index);
  note("Done. Hidden: " + actions.filter((a) => a.kind === "hide").length + ". Source notes: " + actions.filter((a) => a.kind === "note").length + ". Searches this run: " + searchesThisRun + "." +
    SERVICES.filter((s) => s.key()).map((s) => " " + s.label + " left this month: " + budgets[s.name].left() + ".").join(""));
  writeSummary(actions);
}

main().catch((error) => {
  console.error("Copy checker stopped: " + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
