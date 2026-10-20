#!/usr/bin/env node
/**
 * SwarmTales copy checker. Runs on a schedule in GitHub Actions (free for
 * public repositories). Each run:
 *   1. reads every story part added since the last run;
 *   2. compares it with all other writers' text on SwarmTales (fingerprints);
 *   3. optionally, if BRAVE_API_KEY is set, searches the web for three exact
 *      phrases from longer parts (free plan: about 2,000 searches a month);
 *   4. hides a part on a high-confidence match, signing with the MODERATOR key,
 *      which can only hide and unhide. Every hide is a public event with a note.
 *   5. when a story fills up or enters its final edit, checks all of it once
 *      more against everything else, before it can be finished.
 *
 * Environment:
 *   STORIES_ADDRESS   Stories contract (required)
 *   RPC               node URL (default: the Foundation testnet)
 *   MODERATOR_WIF     the moderator's private key (secret). Without it the
 *                     checker only reports what it would hide.
 *   BRAVE_API_KEY     optional, enables the web phrase check
 *   SEARCH_MONTHLY    searches per month to stay under (default 1800)
 *   SEARCH_PER_RUN    searches per run (default 40)
 *   IGNORE_HOSTS      comma list of hosts never counted as a source
 *   STATE_FILE        where progress is kept between runs (default checker-state.json)
 *   DRY_RUN=1         never send anything
 */
import fs from "fs";
import { createRequire } from "module";
import { Index, REASON, WEB_MATCHES_TO_HIDE, WEB_MIN_CHARS, budget, fingerprint, isDuplicate, pickPhrases, resultMatches } from "./lib.mjs";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { Contract, Provider, Signer, Transaction } = require("koilib");
const { abis } = await import("../web/src/generated/abis.js");

const env = process.env;
const STORIES = env.STORIES_ADDRESS;
const RPC = env.RPC || "https://testnet.koinosfoundation.org";
const STATE_FILE = env.STATE_FILE || "checker-state.json";
const DRY_RUN = env.DRY_RUN === "1";
const MONTHLY = Number(env.SEARCH_MONTHLY || 1800);
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
    ? actions.map((a) => `| ${a.story} | ${a.seq} | ${a.reason === REASON.COPYRIGHT ? "web match" : "duplicate"} | ${a.note} | ${a.sent ? "hidden" : "would hide"} |`).join("\n")
    : "| | | | nothing to hide | |";
  fs.appendFileSync(file, "## SwarmTales copy checker\n\n| story | part | why | note | action |\n|---|---|---|---|---|\n" + rows + "\n\n```\n" + log.join("\n") + "\n```\n");
}

async function webCheck(text, spendable) {
  const phrases = pickPhrases(text);
  if (phrases.length < WEB_MATCHES_TO_HIDE) return null;
  let matched = 0;
  let where = "";
  for (const phrase of phrases) {
    if (!spendable.ok()) return null;
    spendable.spend();
    const url = "https://api.search.brave.com/res/v1/web/search?count=5&q=" + encodeURIComponent('"' + phrase + '"');
    const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_API_KEY } });
    await new Promise((r) => setTimeout(r, 1100)); // the free plan allows 1 request a second
    if (!res.ok) {
      note("  web search failed (" + res.status + "); skipping the web check for this part");
      return null;
    }
    const body = await res.json();
    const hit = ((body.web && body.web.results) || []).find((r) => resultMatches(phrase, r, IGNORE));
    if (hit) {
      matched += 1;
      if (!where) where = new URL(hit.url).host;
    }
  }
  return matched >= WEB_MATCHES_TO_HIDE ? { matched, of: phrases.length, where } : null;
}

async function main() {
  if (!STORIES) throw new Error("Set STORIES_ADDRESS.");
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
  if (!signer) note("Report-only: nothing will be hidden this run.");

  const state = loadState();
  state.checked = state.checked || {};
  state.swept = state.swept || {};
  const index = Index.fromJSON(state.index);
  const search = budget(state, new Date(), MONTHLY);
  let searchesThisRun = 0;
  const spendable = {
    ok: () => !!env.BRAVE_API_KEY && searchesThisRun < PER_RUN && search.left() > 0,
    spend: () => { searchesThisRun += 1; search.spend(); },
  };
  const actions = [];

  async function hide(storyId, seq, reason, why) {
    const action = { story: storyId, seq, reason, note: why.slice(0, 200), sent: false };
    actions.push(action);
    note("  HIDE story " + storyId + " part " + seq + ": " + action.note);
    if (!signer) return;
    const mana = BigInt(await provider.getAccountRc(signer.getAddress()));
    if (mana === 0n) {
      note("  the moderator wallet has no mana; send it a little KOIN (it is never spent)");
      return;
    }
    const limit = mana < 500000000n ? mana : 500000000n; // at most 5 mana
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
    if (alsoWeb && String(seg.text).length >= WEB_MIN_CHARS && spendable.ok()) {
      const web = await webCheck(seg.text, spendable);
      if (web) {
        await hide(storyId, seq, REASON.COPYRIGHT, "web match: " + web.matched + " of " + web.of + " phrases found, e.g. on " + web.where);
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
  note("Done. " + actions.length + " part(s) flagged. Web searches this run: " + searchesThisRun + "; left this month: " + search.left() + ".");
  writeSummary(actions);
}

main().catch((error) => {
  console.error("Copy checker stopped: " + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
