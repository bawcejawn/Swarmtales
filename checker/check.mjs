#!/usr/bin/env node
/**
 * SwarmTales copy checker. Runs on a schedule in GitHub Actions (free for
 * public repositories). Each run:
 *   1. reads every story part added since the last run;
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
 *        - a match with a source the writer cited is left alone;
 *        - a part the story's opener restored is never hidden again by the
 *          checker (it can still get a note).
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
import fs from "fs";
import { createRequire } from "module";
import {
  HIDE_FOUND, Index, REASON, WEB_MIN_CHARS, budget, checkChainId, checkOrder, citationCovers, decide, expectedChainId, fingerprint, isDuplicate, isPartialDuplicate,
  normalizeResults, pickPhrases, resultMatches, worthAsking,
} from "./lib.mjs";

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
 * A phrase counts as found when any service finds it. Books are asked first
 * (the free quota is large and copied book text is the main risk), then the web.
 */
/**
 * Search up to five phrases of a part. Returns null (nothing worth noting),
 * "defer" (not enough free searches left this run: try next run), or
 * { action: "hide" | "note", found, same, label, cited }.
 */
async function webCheck(text, spendable, citation) {
  const phrases = pickPhrases(text);
  if (phrases.length < HIDE_FOUND) return null;
  if (spendable.leftThisRun() < phrases.length) return "defer";
  const found = [];
  const labels = new Map();
  for (let i = 0; i < phrases.length; i++) {
    if (!worthAsking(found.filter(Boolean).length, i, phrases.length)) break;
    let hit = null;
    for (const service of spendable.services()) {
      if (!spendable.ok(service)) continue;
      spendable.spend(service);
      const result = await searchOnce(service, phrases[i]);
      if (result === "failed") {
        spendable.disable(service);
        continue;
      }
      if (result) {
        hit = result;
        break;
      }
    }
    if (hit) {
      let host = "";
      try { host = new URL(hit.url).host; } catch { host = hit.url || "a website"; }
      const key = hit.source ? (hit.source.title + "|" + hit.source.author).toLowerCase() : host.toLowerCase();
      if (!labels.has(key)) labels.set(key, { label: hit.label || host, source: hit.source || host });
      found.push(key);
    } else {
      found.push(null);
    }
    if (!spendable.any()) break;
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

  async function hide(storyId, seq, reason, why) {
    const action = { story: storyId, seq, reason, kind: "hide", note: why.slice(0, 200), sent: false };
    actions.push(action);
    note("  HIDE story " + storyId + " part " + seq + ": " + action.note);
    action.sent = await sendAsModerator("set_segment_hidden", {
      story_id: String(storyId), seq: String(seq), hidden: true, reason, note: action.note,
    });
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

  /** Returns "clean", "flagged" or "defer" (search budget used up: try next run). */
  async function checkPart(storyId, seq, seg, alsoWeb) {
    const key = storyId + ":" + seq;
    const hashes = fingerprint(seg.text);
    // Only text written before this part counts, so an original is never
    // flagged for a copy made after it (AB-005).
    const match = index.bestMatch(hashes, seg.author, key, Number(seg.created_at || 0));
    if (match && (isDuplicate(hashes, match) || isPartialDuplicate(hashes, match))) {
      const [srcStory, srcSeq] = match.key.split(":");
      const pct = Math.round(match.ratio * 100);
      if (isDuplicate(hashes, match) && !seg.restored) {
        await hide(storyId, seq, REASON.DUPLICATE, pct + "% of this part matches story " + srcStory + ", part " + srcSeq + ", by another writer");
        return "flagged";
      }
      await sourceNote(storyId, seq, seg, "About " + pct + "% of this text also appears in story " + srcStory + ", part " + srcSeq + ".");
      return "flagged";
    }
    if (alsoWeb && String(seg.text).length >= WEB_MIN_CHARS && spendable.any()) {
      const web = await webCheck(seg.text, spendable, seg.citation);
      if (web === "defer") return "defer";
      if (web && web.cited) return "clean"; // the writer named this source
      if (web && web.action === "hide" && !seg.restored) {
        await hide(storyId, seq, REASON.COPYRIGHT, "copied text: " + web.found + " of " + web.of + " phrases found, " + web.same + " of them in " + web.label);
        // Remembered so the part comes back by itself if its writer names this source.
        state.hiddenByChecker[key] = { source: web.source, label: web.label };
        return "flagged";
      }
      if (web) {
        await sourceNote(storyId, seq, seg, "Parts of this text also appear in " + web.label + ".");
        return "flagged";
      }
    }
    return "clean";
  }

  // Parts the checker hid: bring one back when its writer has named the source,
  // and forget the ones the opener restored.
  for (const key of Object.keys(state.hiddenByChecker)) {
    try {
      const [sid, sq] = key.split(":");
      const seg = await read("get_segment", { story_id: sid, seq: sq });
      const entry = state.hiddenByChecker[key];
      if (!seg.hidden || Number(seg.status) !== 1) {
        delete state.hiddenByChecker[key];
        continue;
      }
      if (seg.citation && citationCovers(seg.citation, entry.source)) {
        note("  UNHIDE story " + sid + " part " + sq + ": the writer named the source (" + seg.citation.slice(0, 80) + ")");
        const ok = await sendAsModerator("set_segment_hidden", {
          story_id: sid, seq: sq, hidden: false, reason: 0, note: "source cited by the writer",
        });
        actions.push({ story: sid, seq: sq, reason: REASON.COPYRIGHT, kind: "unhide", note: "source cited by the writer", sent: ok });
        if (ok || !signer) delete state.hiddenByChecker[key];
      }
    } catch (error) {
      note("  could not re-check " + key + ": " + (error && error.message ? error.message : String(error)));
    }
  }

  // 1. Read every story's new parts.
  const next = Number(cfg.next_story_id || 1);
  const fresh = [];
  const full = [];
  for (let id = 1; id < next; id++) {
    try {
      const st = await read("get_story", { story_id: String(id) });
      const status = Number(st.status || 0);
      if (!status) continue;
      const count = Number(st.segment_count || 0);
      const parts = [];
      for (let start = Number(state.checked[id] || 0) + 1; start <= count; start += 10) {
        const page = await read("get_segments", { story_id: String(id), start: String(start), limit: 10 });
        (page.values || []).forEach((seg, i) => parts.push({ seq: start + i, at: Number(seg.created_at || 0), seg }));
      }
      fresh.push({ id, parts });
      if ((status === 2 || status === 3) && !state.swept[id]) full.push({ id, count });
    } catch (error) {
      note("Story " + id + ": " + (error && error.message ? error.message : String(error)) + " (will retry next run)");
    }
  }

  // 2. Check them oldest first across all stories, so a copy is always
  // checked after the text it copied, whatever the story numbers (AB-005).
  // A story's parts stay in part order, so state.checked stays a safe
  // "done up to" mark when the run stops early.
  const stopped = new Set();
  for (const { story: id, seq, seg } of checkOrder(fresh)) {
    if (stopped.has(id)) continue;
    try {
      if (Number(seg.status) !== 1 || seg.hidden || !seg.text) {
        state.checked[id] = seq;
        continue;
      }
      const result = await checkPart(id, seq, seg, true);
      if (result === "defer") {
        // Out of free searches for this run: this part and everything after it waits for the next run.
        break;
      }
      if (result === "clean" || seg.restored) index.add(id + ":" + seq, seg.author, fingerprint(seg.text), seg.created_at);
      state.checked[id] = seq;
    } catch (error) {
      stopped.add(id);
      note("Story " + id + ": " + (error && error.message ? error.message : String(error)) + " (will retry next run)");
    }
  }

  // 3. Before a story can be finished: one more full comparison, once.
  for (const { id, count } of full) {
    try {
      note("Story " + id + " is full: checking all of it once more before it can be finished.");
      for (let start = 1; start <= count; start += 10) {
        const page = await read("get_segments", { story_id: String(id), start: String(start), limit: 10 });
        (page.values || []).forEach((seg, i) => { seg._seq = start + i; });
        for (const seg of page.values || []) {
          if (Number(seg.status) !== 1 || seg.hidden || !seg.text) continue;
          await checkPart(id, seg._seq, seg, false);
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
