#!/usr/bin/env node
/**
 * SwarmTales copy checker, apply step (O1-09). Runs in its own job, after
 * the plan step (check.mjs), with the MODERATOR key and CHECKER_STATE_KEY.
 * It never searches the web. It takes the plan only as a list of things to
 * check, and decides everything the key signs from fresh chain reads, its
 * own last sealed progress and, for a book, its own lookup of that book
 * (audit M-B):
 *   - a hide of a live part, with the exact text the plan judged, that is
 *     not the admin's hide, not a writer-reports hide for another reason,
 *     and not a part whose checker hide its opener restored (worked out
 *     here from the chain and this step's own sealed record, never from the
 *     plan); only with evidence this step confirms: for a duplicate, an
 *     older live part by another writer sharing 80%+ of it; for copied book
 *     text, a book this step looked up itself (Google Books, by the volume
 *     the plan names) whose publication date is older than the part (never a
 *     website: M-11). What the plan can't prove to this step is that the
 *     book holds the part's words; that stays within APPLY_MAX_HIDES hides a
 *     run (default 20), and every hide is public and can be restored;
 *   - a note on a part that has none, whose text this step writes itself
 *     from what it checked: another part's number and how much of the text
 *     they share, a book's title and author from its own lookup, or a
 *     website's host name; no text from the plan reaches the chain;
 *   - unhide the checker's own hide, as this step recorded it, whose writer
 *     cited that source.
 * Every one is a public event, and the opener can restore a checker hide.
 *
 * Then it seals the progress (state.mjs) for the next run. The fields that
 * protect writers (hiddenByChecker, protect) are this step's own, carried
 * from its last sealed file and updated only with what the chain accepted
 * (AB-061); the plan's search progress (what it checked and when) is kept
 * as it is: a misbehaving plan step could make the checker skip parts
 * anyway, but nothing it writes there can cause a hide.
 *
 * Environment: STORIES_ADDRESS, RPC, EXPECTED_CHAIN_ID (as check.mjs);
 *   MODERATOR_WIF      the moderator's private key (without it: report only)
 *   CHECKER_STATE_KEY  the state seal key (without it nothing is signed or saved)
 *   STATE_FILE         the plan step's progress (default checker-state.json)
 *   PLAN_FILE          the plan (default checker-plan.json)
 *   SEALED_FILE        where the sealed progress goes (default checker-state.sealed.json)
 *   PREV_SEALED_FILE   this step's last sealed progress (default: SEALED_FILE, read before it is replaced)
 *   TIME_BUDGET_MINUTES, APPLY_MAX_HIDES, DRY_RUN=1 (never send anything)
 */
import fs from "fs";
import { pathToFileURL } from "url";
import {
  REASON, citationCovers, cleanNote, fingerprint, isDuplicate, isPartialDuplicate, logLine, mdCell, mdFence, noteAllowed, provablyOlder,
  publishedEnd, recordSent, textAt, textKey,
} from "./lib.mjs";
import { FETCH_TIMEOUT_MS, RPC_TIMEOUT_MS, connect, koilib, timeBudgetMs, withTimeout } from "./chain.mjs";
import { keyProblem, openState, sealState, writeAtomic } from "./state.mjs";

const PART = /^[1-9]\d{0,15}$/;
const partId = (v) => (PART.test(String(v)) ? String(v) : null);
const VOLUME = /^[A-Za-z0-9_-]{1,40}$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "story:seq" -> [story, seq], or null. */
function partRef(v) {
  const [s, q] = String(v || "").split(":").map(partId);
  return s && q ? [s, q] : null;
}

/** How much of `a`'s text `b` shares: the duplicate checks' { shared, ratio }. */
function overlap(a, b) {
  const mine = fingerprint(a);
  const theirs = new Set(fingerprint(b));
  const shared = mine.filter((h) => theirs.has(h)).length;
  return { mine, match: { shared, ratio: mine.length ? shared / mine.length : 0 } };
}

/**
 * Looks books up on Google Books by volume id, this step's own read of who
 * wrote them and when (audit M-B, owner decision 2a). Returns { label,
 * source: { title, author }, published } with the latest date among them
 * (the safe side, M-11; "?" when any has none, which never counts as older),
 * or null when any can't be read.
 */
export async function lookupBooks(ids, fetchImpl = fetch) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  if (!list.length || list.length > 5 || !list.every((id) => VOLUME.test(id))) return null;
  let first = null;
  let published = "";
  for (const id of list) {
    let info;
    try {
      const res = await fetchImpl("https://www.googleapis.com/books/v1/volumes/" + encodeURIComponent(id),
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      info = ((await res.json()) || {}).volumeInfo || {};
    } catch {
      return null;
    }
    const date = String(info.publishedDate || "");
    const end = publishedEnd(date);
    if (end === null) published = "?";
    else if (published !== "?" && (!published || end > publishedEnd(published))) published = date;
    if (!first) first = { title: String(info.title || ""), author: (Array.isArray(info.authors) ? info.authors : []).map(String).join(", ") };
  }
  const title = cleanNote(first.title, "untitled", 90);
  const by = cleanNote(first.author, "", 60);
  return { label: '"' + title + '"' + (by ? " by " + by : ""), source: first, published };
}

/**
 * Why a planned action must not be signed, judged on fresh chain reads, or
 * "" when it may be. `read` is a Stories read; `ctx` is this step's own
 * { protect, hidden, lookupBooks }. Returns [why, note, source, label]: the
 * note this step wrote, and for a hide the source it confirmed.
 */
export async function check(action, read, ctx) {
  const a = action || {};
  const story = partId(a.story);
  const seq = partId(a.seq);
  if (!story || !seq) return ["not a part"];
  if (!["hide", "note", "unhide"].includes(a.kind)) return ["unknown action"];
  const key = story + ":" + seq;
  const seg = await read("get_segment", { story_id: story, seq });
  if (Number(seg.status) !== 1 || !seg.text) return ["the part is gone"];
  if (textKey(seg.text) !== a.t) return ["its text changed since it was checked"];
  const by = Number(seg.hidden_by || 0);
  // O1-07 / M-B: the chain says the opener restored a checker hide of this
  // part, so the text hidden then is never hidden again. Which text: the one
  // this step recorded then, or else the text now (recorded now, whatever
  // the action), so a lost record can only protect more. The plan has no say.
  if (seg.restored && seg.refund_forfeited && !(seg.hidden && by === 2) && !ctx.protect[key]) ctx.protect[key] = textKey(seg.text);
  if (a.kind === "unhide") {
    const mine = ctx.hidden[key];
    if (!mine) return ["it is not a hide this checker recorded"];
    if (!seg.hidden || by !== 2) return ["it is not the checker's hide"];
    if (!seg.citation || !mine.source || !citationCovers(seg.citation, mine.source)) return ["its citation doesn't name the source"];
    return ["", "source cited by the writer", mine.source, mine.label || ""];
  }
  if (a.kind === "note") {
    if (seg.source_note) return ["it already has a note"];
    if (a.about) {
      const ref = partRef(a.about);
      if (!ref || ref.join(":") === key) return ["no other part named"];
      const other = await read("get_segment", { story_id: ref[0], seq: ref[1] });
      if (Number(other.status) !== 1 || !other.text) return ["the other part is gone"];
      const { mine, match } = overlap(seg.text, other.text);
      if (!isDuplicate(mine, match) && !isPartialDuplicate(mine, match)) return ["the texts don't match enough"];
      return ["", "About " + Math.round(match.ratio * 100) + "% of this text also appears in story " + ref[0] + ", part " + ref[1] +
        (a.tie ? ", written at the same time." : ".")];
    }
    if (a.books) {
      const book = await ctx.lookupBooks(a.books);
      if (!book) return ["could not look the book up"];
      return ["", "Parts of this text also appear in " + book.label + "."];
    }
    const host = String(a.web || "").toLowerCase().replace(/^www\./, "");
    if (a.web !== undefined && HOST.test(host)) return ["", "Parts of this text also appear on " + host + "."];
    return ["the note names nothing this step can check"];
  }
  // A hide.
  if (a.reason !== REASON.COPYRIGHT && a.reason !== REASON.DUPLICATE) return ["no reason"];
  if (seg.hidden) {
    if (by !== 1) return [by === 2 ? "already hidden by the checker" : "the admin's hide"];
    const r = Number(seg.moderation_reason || 0);
    if (r !== REASON.COPYRIGHT && r !== REASON.DUPLICATE) return ["writer reports hid it for another reason"];
  }
  if (seg.restored && seg.refund_forfeited && ctx.protect[key] === textKey(seg.text)) return ["its opener restored the checker's hide"];
  if (a.reason === REASON.DUPLICATE) {
    const ref = partRef(a.copyOf);
    if (!ref || ref.join(":") === key) return ["no original named"];
    const src = await read("get_segment", { story_id: ref[0], seq: ref[1] });
    if (Number(src.status) !== 1 || !src.text) return ["the original is gone"];
    if (!src.author || src.author === seg.author) return ["the original is by the same writer"];
    const created = Number(src.created_at || 0);
    if (!(created > 0 && created < textAt(seg))) return ["the original is not older"];
    const { mine, match } = overlap(seg.text, src.text);
    if (!isDuplicate(mine, match)) return ["the texts don't match enough"];
    return ["", "copied text: " + Math.round(match.ratio * 100) + "% of this part matches story " + ref[0] + ", part " + ref[1] +
      ", by another writer", null, ""];
  }
  const book = await ctx.lookupBooks(a.books);
  if (!book) return ["could not look the book up"];
  if (!provablyOlder(book.published, seg.created_at)) return ["no book provably older than the part"];
  return ["", cleanNote("copied text: found in " + book.label + " (published " + book.published + ")", "copied text"), book.source, book.label];
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

async function main(env) {
  const STATE_FILE = env.STATE_FILE || "checker-state.json";
  const PLAN_FILE = env.PLAN_FILE || "checker-plan.json";
  const SEALED_FILE = env.SEALED_FILE || "checker-state.sealed.json";
  const PREV_SEALED_FILE = env.PREV_SEALED_FILE || SEALED_FILE;
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
  // This step's own record from its last run, read before it is replaced
  // (M-B): the protections are carried from here, never from the plan.
  const prev = openState(readText(PREV_SEALED_FILE), env.CHECKER_STATE_KEY, env.STORIES_ADDRESS);
  if (prev.status === "invalid") note("Own saved record: " + prev.detail + ". Starting from what the chain shows.");
  const own = {
    protect: { ...((prev.state && prev.state.protect) || {}) },
    hidden: { ...((prev.state && prev.state.hiddenByChecker) || {}) },
  };
  const state = readJson(STATE_FILE);
  if (!state) {
    note("No progress from the plan step: nothing to apply or save.");
    summary();
    return 0;
  }
  state.seen = state.seen || {};
  // Checker hides the plan found already in place (the run that made one
  // stopped before saving): adopted below only once the chain confirms each
  // is the checker's own hide of that text. The plan's word on its source
  // can then only ever allow an unhide, which needs the writer's citation.
  const planHidden = state.hiddenByChecker && typeof state.hiddenByChecker === "object" ? state.hiddenByChecker : {};
  const adopt = Object.keys(planHidden).filter((k) => !own.hidden[k] && partRef(k) && planHidden[k] && typeof planHidden[k] === "object");
  // The plan's search progress, with this step's own protections.
  state.protect = own.protect;
  state.hiddenByChecker = own.hidden;
  const seal = () => writeAtomic(SEALED_FILE, sealState(state, env.CHECKER_STATE_KEY, env.STORIES_ADDRESS));
  // Saved first, so the plan step's progress is kept even if signing fails.
  seal();

  const plan = readJson(PLAN_FILE);
  const actions = plan && plan.v === 1 && plan.stories === env.STORIES_ADDRESS && Array.isArray(plan.actions) ? plan.actions : [];
  if (!plan) note("No plan from the plan step.");
  else if (!actions.length) note("Nothing planned.");
  if (!actions.length && !adopt.length) {
    summary();
    return 0;
  }

  const { provider, stories, read, chainId } = await connect(env);
  for (const key of adopt) {
    const ref = partRef(key);
    const entry = planHidden[key];
    try {
      const seg = await read("get_segment", { story_id: ref[0], seq: ref[1] });
      if (Number(seg.status) === 1 && seg.hidden && Number(seg.hidden_by || 0) === 2 && textKey(seg.text) === entry.t) {
        const src = entry.source;
        own.hidden[key] = {
          source: typeof src === "string" ? src : src && typeof src === "object" ? { title: String(src.title || ""), author: String(src.author || "") } : null,
          label: cleanNote(entry.label, "", 200), t: entry.t,
        };
      }
    } catch (error) {
      note("  could not check " + key + ": " + (error && error.message ? error.message : String(error)));
    }
  }
  // Bring this step's record up to date with the chain: a checker hide that
  // is gone or undone leaves the record; one its opener restored protects
  // that text from now on (O1-07).
  for (const key of Object.keys(own.hidden)) {
    const ref = partRef(key);
    try {
      const seg = ref ? await read("get_segment", { story_id: ref[0], seq: ref[1] }) : {};
      if (Number(seg.status) !== 1) delete own.hidden[key];
      else if (!seg.hidden || Number(seg.hidden_by || 0) !== 2) {
        if (seg.restored && seg.refund_forfeited && !seg.hidden) own.protect[key] = own.hidden[key].t || textKey(seg.text);
        delete own.hidden[key];
      }
    } catch (error) {
      note("  could not re-check " + key + ": " + (error && error.message ? error.message : String(error)));
    }
  }
  seal();
  if (!actions.length) {
    summary();
    return 0;
  }
  const ctx = { protect: own.protect, hidden: own.hidden, lookupBooks: (ids) => lookupBooks(ids) };

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
    const mana = BigInt(await withTimeout(provider.getAccountRc(signer.getAddress()), RPC_TIMEOUT_MS, "The node"));
    if (mana === 0n) {
      note("  the moderator wallet has no mana; send it a little KOIN (it is never spent)");
      return false;
    }
    const limit = mana < 50000000n ? mana : 50000000n;
    const tx = new koilib.Transaction({ signer, provider, options: { payer: signer.getAddress(), rcLimit: limit.toString(), chainId } });
    await tx.pushOperation(await stories.encodeOperation({ name, args: { actor: signer.getAddress(), ...args } }));
    await tx.prepare();
    await tx.sign();
    const receipt = await withTimeout(tx.send(), RPC_TIMEOUT_MS, "The node");
    await tx.wait("byBlock", 120000); // its own limit: two minutes for the block
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
    let source = null;
    let label = "";
    try {
      [why, text, source, label] = await check(a, read, ctx);
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
      // Recorded with what this step confirmed, never the plan's word.
      recordSent(state, { kind: a.kind, story: partId(a.story), seq: partId(a.seq), t: a.t, src: source || null, label: label || "" });
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
