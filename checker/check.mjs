#!/usr/bin/env node
/**
 * SwarmTales copy checker. Runs on a schedule in GitHub Actions (free for
 * public repositories). Each run:
 *   1. reads every story part added since the last run;
 *   2. compares it with all other writers' text on SwarmTales (fingerprints);
 *   3. optionally, searches for three exact phrases from longer parts, using
 *      whichever free search keys are set (all optional, all free, no card):
 *        GOOGLE_BOOKS_KEY  Google Books: searches inside millions of books
 *        TAVILY_API_KEY    Tavily web search (free: 1,000 searches a month)
 *        BRAVE_API_KEY     Brave web search (Brave now needs a card; kept for anyone who has a key)
 *   4. REVIEW FIRST (the default): a possible match is NOT hidden. It is listed
 *      in the run summary and in one GitHub issue, "Copy checker: parts to
 *      review", so a person can look at it first. To hide it, run the
 *      workflow by hand with "hide_part" (for example 4:7); to undo a hide,
 *      use "unhide_part". Set the repository variable CHECKER_MODE=auto to let
 *      the checker hide high-confidence matches by itself instead.
 *      Hiding is signed with the MODERATOR key, which can only hide and
 *      unhide. Every hide is a public event with a note.
 *   5. when a story fills up or enters its final edit, checks all of it once
 *      more against everything else, before it can be finished.
 *
 * Environment:
 *   STORIES_ADDRESS   Stories contract (required)
 *   RPC               node URL (default: the Foundation testnet)
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
 *   CHECKER_MODE      "review" (default): only list possible matches; "auto": hide them
 *   HIDE_PART         "story:part": hide this part now (after a person reviewed it), then stop
 *   UNHIDE_PART       "story:part": unhide this part now, then stop
 *   GITHUB_TOKEN, GITHUB_REPOSITORY  (set by GitHub Actions) for the review issue
 *   DRY_RUN=1         never send anything
 */
import fs from "fs";
import { createRequire } from "module";
import { Index, REASON, WEB_MATCHES_TO_HIDE, WEB_MIN_CHARS, budget, fingerprint, isDuplicate, normalizeResults, pickPhrases, resultMatches } from "./lib.mjs";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { Contract, Provider, Signer, Transaction } = require("koilib");
const { abis } = await import("../web/src/generated/abis.js");

const env = process.env;
const STORIES = env.STORIES_ADDRESS;
const RPC = env.RPC || "https://testnet.koinosfoundation.org";
const STATE_FILE = env.STATE_FILE || "checker-state.json";
const DRY_RUN = env.DRY_RUN === "1";
const AUTO = String(env.CHECKER_MODE || "").trim().toLowerCase() === "auto";
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
    ? actions.map((a) => `| ${a.story} | ${a.seq} | ${a.reason === REASON.COPYRIGHT ? "outside match" : "duplicate"} | ${a.note} | ${a.sent ? "hidden" : AUTO ? "would hide" : "to review"} |`).join("\n")
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
async function webCheck(text, spendable) {
  const phrases = pickPhrases(text);
  if (phrases.length < WEB_MATCHES_TO_HIDE) return null;
  let matched = 0;
  let where = "";
  for (const phrase of phrases) {
    let hit = null;
    for (const service of spendable.services()) {
      if (!spendable.ok(service)) continue;
      spendable.spend(service);
      const found = await searchOnce(service, phrase);
      if (found === "failed") {
        spendable.disable(service);
        continue;
      }
      if (found) {
        hit = found;
        break;
      }
    }
    if (hit) {
      matched += 1;
      if (!where) where = hit.label || new URL(hit.url).host;
    }
    if (!spendable.any()) break;
  }
  return matched >= WEB_MATCHES_TO_HIDE ? { matched, of: phrases.length, where } : null;
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

/** The GitHub issue that collects parts to review (created once, then reused). */
async function reportForReview(items) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!items.length || !token || !repo) return;
  const api = (path, init) => fetch("https://api.github.com/repos/" + repo + path, {
    ...init,
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
  });
  const title = "Copy checker: parts to review";
  const found = await api("/issues?state=open&per_page=100&creator=github-actions%5Bbot%5D").then((r) => (r.ok ? r.json() : []));
  let issue = Array.isArray(found) ? found.find((i) => i.title === title) : null;
  if (!issue) {
    const res = await api("/issues", { method: "POST", body: JSON.stringify({
      title,
      body: "The copy checker lists parts here that **might** be copied. Nothing has been hidden.\n\n" +
        "For each one: open the part on the site and compare it with the source in the note.\n" +
        "- **Copied:** Actions → Copy checker → Run workflow → type `story:part` (for example `4:7`) in **hide_part** → Run.\n" +
        "- **Fine:** do nothing.\n\nClose this issue when the list is done; the next possible match opens a new one.",
    }) });
    if (!res.ok) {
      note("Could not open the review issue (" + res.status + "). The list is in this run's summary.");
      return;
    }
    issue = await res.json();
  }
  const site = "https://bawcejawn.github.io/Swarmtales/#/stories/";
  const lines = items.map((a) => "- **" + a.story + ":" + a.seq + "**: " + a.note + " · [open the story](" + site + a.story + ")");
  await api("/issues/" + issue.number + "/comments", { method: "POST", body: JSON.stringify({ body: "Possible matches found " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC:\n\n" + lines.join("\n") }) });
  note("Listed " + items.length + " part(s) for review in issue #" + issue.number + ".");
}

/** Hide or unhide one part by hand, after a person reviewed it. */
async function manualModeration(which, hidden) {
  const m = /^\s*(\d+)\s*[:/ -]\s*(\d+)\s*$/.exec(which);
  if (!m) throw new Error('Write the part as story:part, for example 4:7 (you wrote "' + which + '").');
  if (!env.MODERATOR_WIF) throw new Error("The MODERATOR_WIF secret is not set, so nothing can be hidden.");
  const provider = new Provider([RPC]);
  const stories = new Contract({ id: STORIES, abi: abis.stories, provider });
  const cfg = (await stories.functions.get_config({})).result || {};
  const signer = Signer.fromWif(env.MODERATOR_WIF.trim());
  signer.provider = provider;
  if (signer.getAddress() !== cfg.moderator) throw new Error("The moderator key is not the contract's moderator (" + (cfg.moderator || "none") + ").");
  const seg = (await stories.functions.get_segment({ story_id: m[1], seq: m[2] })).result || {};
  if (!Number(seg.status)) throw new Error("Story " + m[1] + " has no part " + m[2] + ".");
  const reason = hidden ? REASON.COPYRIGHT : Number(seg.moderation_reason || REASON.COPYRIGHT);
  const why = hidden ? "copied text, confirmed by a person after the copy checker flagged it" : "reviewed by a person: not copied";
  note((hidden ? "Hiding" : "Unhiding") + " story " + m[1] + " part " + m[2] + ": " + why);
  if (DRY_RUN) return;
  const mana = BigInt(await provider.getAccountRc(signer.getAddress()));
  const limit = mana < 50000000n ? mana : 50000000n; // at most 0.5 mana (a hide uses about 0.05)
  const tx = new Transaction({ signer, provider, options: { payer: signer.getAddress(), rcLimit: limit.toString() } });
  await tx.pushOperation(await stories.encodeOperation({
    name: "set_segment_hidden",
    args: { actor: signer.getAddress(), story_id: m[1], seq: m[2], hidden, reason, note: why },
  }));
  await tx.prepare();
  await tx.sign();
  const receipt = await tx.send();
  await tx.wait();
  if (receipt && receipt.reverted) throw new Error("The chain refused: " + (receipt.logs || []).join(" "));
  note("Done: transaction " + tx.transaction.id);
}

async function main() {
  if (env.TEST_PHRASE && env.TEST_PHRASE.trim()) {
    await testPhrase(env.TEST_PHRASE.trim());
    writeSummary([]);
    return;
  }
  if (!STORIES) throw new Error("Set STORIES_ADDRESS.");
  if (env.HIDE_PART && env.HIDE_PART.trim()) {
    await manualModeration(env.HIDE_PART.trim(), true);
    writeSummary([]);
    return;
  }
  if (env.UNHIDE_PART && env.UNHIDE_PART.trim()) {
    await manualModeration(env.UNHIDE_PART.trim(), false);
    writeSummary([]);
    return;
  }
  const provider = new Provider([RPC]);
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
  if (!AUTO) note("Review first: possible matches are listed for a person to check. Nothing is hidden automatically.");
  else if (!signer) note("Report-only: nothing will be hidden this run.");

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
    any: () => spendable.services().some((s) => spendable.ok(s)),
    spend: (s) => { searchesThisRun += 1; budgets[s.name].spend(); },
    disable: (s) => disabled.add(s.name),
  };
  const searchKeys = SERVICES.filter((s) => s.key()).map((s) => s.label);
  note(searchKeys.length ? "Phrase search with: " + searchKeys.join(", ") + "." : "No search key set: only SwarmTales' own text is compared.");
  const actions = [];

  async function hide(storyId, seq, reason, why) {
    const action = { story: storyId, seq, reason, note: why.slice(0, 200), sent: false };
    const key = storyId + ":" + seq;
    state.flagged = state.flagged || {};
    if (!AUTO) {
      // List each part once, not every hour.
      if (state.flagged[key]) return;
      state.flagged[key] = true;
      actions.push(action);
      note("  TO REVIEW story " + storyId + " part " + seq + ": " + action.note);
      return;
    }
    actions.push(action);
    note("  HIDE story " + storyId + " part " + seq + ": " + action.note);
    if (!signer) return;
    const mana = BigInt(await provider.getAccountRc(signer.getAddress()));
    if (mana === 0n) {
      note("  the moderator wallet has no mana; send it a little KOIN (it is never spent)");
      return;
    }
    const limit = mana < 50000000n ? mana : 50000000n; // at most 0.5 mana (a hide uses about 0.05)
    const tx = new Transaction({ signer, provider, options: { payer: signer.getAddress(), rcLimit: limit.toString() } });
    await tx.pushOperation(await stories.encodeOperation({
      name: "set_segment_hidden",
      args: { actor: signer.getAddress(), story_id: String(storyId), seq: String(seq), hidden: true, reason, note: action.note },
    }));
    await tx.prepare();
    await tx.sign();
    const receipt = await tx.send();
    await tx.wait();
    if (receipt && receipt.reverted) note("  the chain refused: " + (receipt.logs || []).join(" "));
    else action.sent = true;
  }

  async function checkPart(storyId, seq, seg, alsoWeb) {
    const key = storyId + ":" + seq;
    const hashes = fingerprint(seg.text);
    const match = index.bestMatch(hashes, seg.author, key);
    if (isDuplicate(hashes, match)) {
      const [srcStory, srcSeq] = match.key.split(":");
      await hide(storyId, seq, REASON.DUPLICATE, "matches story " + srcStory + " part " + srcSeq + " (" + Math.round(match.ratio * 100) + "% of its text)");
      return false;
    }
    if (alsoWeb && String(seg.text).length >= WEB_MIN_CHARS && spendable.any()) {
      const web = await webCheck(seg.text, spendable);
      if (web) {
        await hide(storyId, seq, REASON.COPYRIGHT, "copy match: " + web.matched + " of " + web.of + " phrases found, e.g. in " + web.where);
        return false;
      }
    }
    return true;
  }

  const next = Number(cfg.next_story_id || 1);
  for (let id = 1; id < next; id++) {
    try {
      const st = await read("get_story", { story_id: String(id) });
      const status = Number(st.status || 0);
      if (!status) continue;
      const count = Number(st.segment_count || 0);
      const done = Number(state.checked[id] || 0);
      for (let start = done + 1; start <= count; start += 10) {
        const page = await read("get_segments", { story_id: String(id), start: String(start), limit: 10 });
        const values = page.values || [];
        for (let i = 0; i < values.length; i++) {
          const seq = start + i;
          const seg = values[i];
          if (Number(seg.status) !== 1 || seg.hidden || !seg.text) continue;
          const clean = await checkPart(id, seq, seg, true);
          if (clean) index.add(id + ":" + seq, seg.author, fingerprint(seg.text));
        }
        state.checked[id] = Math.min(count, start + values.length - 1);
      }
      // Before a story can be finished: one more full comparison, once.
      if ((status === 2 || status === 3) && !state.swept[id]) {
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
      }
    } catch (error) {
      note("Story " + id + ": " + (error && error.message ? error.message : String(error)) + " (will retry next run)");
    }
  }

  saveState(state, index);
  if (!AUTO) await reportForReview(actions).catch((error) => note("Review issue: " + (error && error.message ? error.message : String(error))));
  note("Done. " + actions.length + " part(s) flagged. Searches this run: " + searchesThisRun + "." +
    SERVICES.filter((s) => s.key()).map((s) => " " + s.label + " left this month: " + budgets[s.name].left() + ".").join(""));
  writeSummary(actions);
}

main().catch((error) => {
  console.error("Copy checker stopped: " + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
