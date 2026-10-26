#!/usr/bin/env node
/**
 * SwarmTales copy checker, apply step (O1-09). Runs in its own job, after
 * the plan step (check.mjs), with the MODERATOR key and CHECKER_STATE_KEY.
 * It never searches the web and never reads search results: it only takes
 * the plan, re-checks every planned action against fresh chain reads, and
 * signs the ones that still hold. A plan made by a misbehaving plan job can
 * therefore only ever:
 *   - hide a live part, with the exact text the plan judged, that is not
 *     the admin's hide, not a writer-reports hide for another reason, and
 *     not a part whose checker hide its opener restored; and only with
 *     evidence the chain confirms (for a duplicate: an older live part by
 *     another writer sharing 80%+ of it) or, for copied book text, a book
 *     date older than the part (never a website: M-11); at most
 *     APPLY_MAX_HIDES hides a run (default 20);
 *   - add a note to a part that has none (cleaned to the contract's rules);
 *   - unhide the checker's own hide whose writer cited its source.
 * Every one is a public event, and the opener can restore a checker hide.
 *
 * Then it seals the progress (state.mjs) for the next run, recording only
 * the actions the chain accepted (AB-061), after each one.
 *
 * Environment: STORIES_ADDRESS, RPC, EXPECTED_CHAIN_ID (as check.mjs);
 *   MODERATOR_WIF      the moderator's private key (without it: report only)
 *   CHECKER_STATE_KEY  the state seal key (without it nothing is signed or saved)
 *   STATE_FILE         the plan step's progress (default checker-state.json)
 *   PLAN_FILE          the plan (default checker-plan.json)
 *   SEALED_FILE        where the sealed progress goes (default checker-state.sealed.json)
 *   TIME_BUDGET_MINUTES, APPLY_MAX_HIDES, DRY_RUN=1 (never send anything)
 */
import fs from "fs";
import { pathToFileURL } from "url";
import {
  REASON, citationCovers, cleanNote, fingerprint, isDuplicate, logLine, mdCell, mdFence, noteAllowed, provablyOlder, recordSent, textAt, textKey,
} from "./lib.mjs";
import { connect, koilib, timeBudgetMs } from "./chain.mjs";
import { keyProblem, sealState, writeAtomic } from "./state.mjs";

const PART = /^[1-9]\d{0,15}$/;
const partId = (v) => (PART.test(String(v)) ? String(v) : null);

/**
 * Why a planned action must not be signed, judged on fresh chain reads, or
 * "" when it may be. `read` is a Stories read. Returns [why, note].
 */
export async function check(action, read) {
  const a = action || {};
  const story = partId(a.story);
  const seq = partId(a.seq);
  if (!story || !seq) return ["not a part"];
  if (!["hide", "note", "unhide"].includes(a.kind)) return ["unknown action"];
  const seg = await read("get_segment", { story_id: story, seq });
  if (Number(seg.status) !== 1 || !seg.text) return ["the part is gone"];
  if (textKey(seg.text) !== a.t) return ["its text changed since it was checked"];
  const by = Number(seg.hidden_by || 0);
  if (a.kind === "unhide") {
    if (!seg.hidden || by !== 2) return ["it is not the checker's hide"];
    if (!seg.citation || !a.src || !citationCovers(seg.citation, a.src)) return ["its citation doesn't name the source"];
    return ["", "source cited by the writer"];
  }
  if (a.kind === "note") {
    const text = cleanNote(a.note);
    if (!text) return ["the note is empty"];
    if (seg.source_note) return ["it already has a note"];
    return ["", text];
  }
  // A hide.
  if (a.reason !== REASON.COPYRIGHT && a.reason !== REASON.DUPLICATE) return ["no reason"];
  if (seg.hidden) {
    if (by !== 1) return [by === 2 ? "already hidden by the checker" : "the admin's hide"];
    const r = Number(seg.moderation_reason || 0);
    if (r !== REASON.COPYRIGHT && r !== REASON.DUPLICATE) return ["writer reports hid it for another reason"];
  }
  if (seg.restored && seg.refund_forfeited && !a.afterRestore) return ["its opener restored the checker's hide"];
  if (a.reason === REASON.DUPLICATE) {
    const [srcStory, srcSeq] = String(a.copyOf || "").split(":").map(partId);
    if (!srcStory || !srcSeq || (srcStory === story && srcSeq === seq)) return ["no original named"];
    const src = await read("get_segment", { story_id: srcStory, seq: srcSeq });
    if (Number(src.status) !== 1 || !src.text) return ["the original is gone"];
    if (!src.author || src.author === seg.author) return ["the original is by the same writer"];
    const created = Number(src.created_at || 0);
    if (!(created > 0 && created < textAt(seg))) return ["the original is not older"];
    const mine = fingerprint(seg.text);
    const theirs = new Set(fingerprint(src.text));
    const shared = mine.filter((h) => theirs.has(h)).length;
    if (!isDuplicate(mine, { shared, ratio: mine.length ? shared / mine.length : 0 })) return ["the texts don't match enough"];
  } else if (a.sourceKind !== "book" || !provablyOlder(a.published, seg.created_at)) {
    return ["no book provably older than the part"];
  }
  return ["", cleanNote(a.note, "copied text")];
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function main(env) {
  const STATE_FILE = env.STATE_FILE || "checker-state.json";
  const PLAN_FILE = env.PLAN_FILE || "checker-plan.json";
  const SEALED_FILE = env.SEALED_FILE || "checker-state.sealed.json";
  const MAX_HIDES = Number(env.APPLY_MAX_HIDES || 20);
  const budgetMs = timeBudgetMs(env.TIME_BUDGET_MINUTES);
  const started = Date.now();
  const log = [];
  const note = (line) => { const safe = logLine(line); console.log(safe); log.push(safe); };
  const done = [];
  const summary = () => {
    if (!env.GITHUB_STEP_SUMMARY) return;
    const rows = done.length ? done.map((d) => "| " + [d.a.story, d.a.seq, d.a.kind, d.note || "", d.result].map((v) => mdCell(String(v ?? ""))).join(" | ") + " |").join("\n")
      : "| | | nothing to do | | |";
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, "## SwarmTales copy checker: apply\n\n| story | part | action | note | result |\n|---|---|---|---|---|\n" +
      rows + "\n\n" + mdFence(log.join("\n")));
  };

  const keyIssue = keyProblem(env.CHECKER_STATE_KEY);
  if (keyIssue) {
    note("::error title=Copy checker::" + keyIssue + ": nothing is signed or saved. Add it to the copy-checker environment.");
    summary();
    return 1;
  }
  const state = readJson(STATE_FILE);
  if (!state) {
    note("No progress from the plan step: nothing to apply or save.");
    summary();
    return 0;
  }
  state.hiddenByChecker = state.hiddenByChecker || {};
  state.seen = state.seen || {};
  const seal = () => writeAtomic(SEALED_FILE, sealState(state, env.CHECKER_STATE_KEY, env.STORIES_ADDRESS));
  // Saved first, so the plan step's progress is kept even if signing fails.
  seal();

  const plan = readJson(PLAN_FILE);
  const actions = plan && plan.v === 1 && plan.stories === env.STORIES_ADDRESS && Array.isArray(plan.actions) ? plan.actions : [];
  if (!plan) note("No plan from the plan step.");
  else if (!actions.length) note("Nothing planned.");
  if (!actions.length) {
    summary();
    return 0;
  }

  const { provider, stories, read, chainId } = await connect(env);
  const cfg = await read("get_config");
  let signer = null;
  if (env.MODERATOR_WIF && env.DRY_RUN !== "1") {
    signer = koilib.Signer.fromWif(env.MODERATOR_WIF.trim());
    signer.provider = provider;
    if (signer.getAddress() !== cfg.moderator) {
      note("The moderator key (" + signer.getAddress() + ") is not the contract's moderator (" + (cfg.moderator || "none") + "). Report-only this run.");
      signer = null;
    }
  }
  if (!signer) note("Report-only: nothing will be sent this run.");

  /** Sign one Stories call with the moderator key (at most 0.5 mana; a hide uses about 0.05). */
  async function send(name, args) {
    const mana = BigInt(await provider.getAccountRc(signer.getAddress()));
    if (mana === 0n) {
      note("  the moderator wallet has no mana; send it a little KOIN (it is never spent)");
      return false;
    }
    const limit = mana < 50000000n ? mana : 50000000n;
    const tx = new koilib.Transaction({ signer, provider, options: { payer: signer.getAddress(), rcLimit: limit.toString(), chainId } });
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

  let hides = 0;
  for (const raw of actions) {
    const a = raw && typeof raw === "object" ? raw : {};
    if (done.length && Date.now() - started > budgetMs) {
      note("Out of time: the rest is planned again next run.");
      break;
    }
    const where = "story " + partId(a.story) + " part " + partId(a.seq);
    let why;
    let text;
    try {
      [why, text] = await check(a, read);
    } catch (error) {
      why = "could not read it (" + (error && error.message ? error.message : String(error)) + ")";
    }
    if (!why && a.kind === "hide" && hides >= MAX_HIDES) why = "more than " + MAX_HIDES + " hides this run; the rest wait for the next run";
    if (!why && !noteAllowed(text)) why = "the note breaks the contract's rules";
    if (why) {
      note("  skipped " + String(a.kind).slice(0, 20) + " of " + where + ": " + why);
      done.push({ a, note: text, result: "skipped: " + why });
      continue;
    }
    if (a.kind === "hide") hides += 1;
    note("  " + a.kind.toUpperCase() + " " + where + ": " + text);
    let ok = false;
    if (signer) {
      try {
        ok = await send(a.kind === "note" ? "set_source_note" : "set_segment_hidden", a.kind === "note"
          ? { story_id: String(a.story), seq: String(a.seq), note: text }
          : { story_id: String(a.story), seq: String(a.seq), hidden: a.kind === "hide", reason: a.kind === "hide" ? a.reason : 0, note: text });
      } catch (error) {
        note("  sending failed: " + (error && error.message ? error.message : String(error)));
      }
    }
    done.push({ a, note: text, result: ok ? "sent" : signer ? "not sent" : "would send" });
    if (ok) {
      recordSent(state, a);
      seal();
    }
  }
  note("Done. Sent: " + done.filter((d) => d.result === "sent").length + " of " + actions.length + " planned.");
  summary();
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.env).then((code) => process.exit(code), (error) => {
    console.error(logLine("Copy checker (apply) stopped: " + (error && error.message ? error.message : String(error))));
    process.exit(1);
  });
}
