#!/usr/bin/env node
/**
 * The copy checker's saved progress, sealed with an HMAC (audit M-10).
 *
 * The state lives in the Actions cache, which other workflows of the
 * repository (the Pages build, and the build tools it runs) can also write.
 * So the checker never trusts a state file it did not seal itself: the seal
 * is HMAC-SHA256 with CHECKER_STATE_KEY, a secret only the copy-checker
 * environment holds, over a label, the Stories address and the exact state
 * text. A file without a valid seal is ignored and reported; the run then
 * starts from fresh progress. That is safe because every protection that
 * matters for honest writers is read from the chain, not from this file
 * (O1-07): a part whose checker hide its opener restored is never hidden
 * again, the admin's hides are never touched, and nothing is hidden on an
 * unknown date.
 *
 * What a seal can't stop: someone able to write the cache can put back an
 * OLDER file this checker sealed (a rollback). That only makes the checker
 * forget recent work: it checks parts again, and may hide again a copy the
 * admin unhid by hand in that window (the admin can unhide it again). The
 * seal names when and by which run it was made, and the load step prints it.
 *
 * Used as a command by the workflow's load job, which holds the key and runs
 * no installed packages:
 *   node checker/state.mjs open <sealed file> <out file>
 * writes the state to <out file> as plain JSON for the plan job, with
 * `load: { status, detail }` saying what happened ("ok", "fresh", "invalid"
 * or "nokey"). It never fails because of the file's contents.
 */
import { createHmac, timingSafeEqual } from "crypto";
import fs from "fs";
import { pathToFileURL } from "url";

const LABEL = "swarmtales-copy-checker-state/v1";
export const MIN_KEY_LENGTH = 32;

function mac(key, stories, body) {
  return createHmac("sha256", key).update(LABEL + "\n" + stories + "\n" + body).digest();
}

/** Why a key can't be used, or "" when it can. */
export function keyProblem(key) {
  if (!key) return "CHECKER_STATE_KEY is not set";
  if (String(key).length < MIN_KEY_LENGTH) return "CHECKER_STATE_KEY is shorter than " + MIN_KEY_LENGTH + " characters";
  return "";
}

/** The sealed file's text for a state. */
export function sealState(state, key, stories, now = new Date()) {
  const problem = keyProblem(key);
  if (problem) throw new Error(problem);
  const body = JSON.stringify({ ...state, load: undefined, sealedAt: now.toISOString(), sealedBy: process.env.GITHUB_RUN_ID || "" });
  return JSON.stringify({ v: 1, mac: mac(key, String(stories || ""), body).toString("hex"), body });
}

/**
 * Opens a sealed file's text (null: no file). Returns { state, status, detail }:
 * status "ok" (the seal is valid), "fresh" (no file), "invalid" (ignored) or
 * "nokey" (no usable key: nothing can be trusted or saved).
 */
export function openState(text, key, stories, now = new Date()) {
  const problem = keyProblem(key);
  if (problem) return { state: {}, status: "nokey", detail: problem };
  if (text === null || text === undefined) return { state: {}, status: "fresh", detail: "no saved progress (the first run, or the cache expired)" };
  const invalid = (why) => ({ state: {}, status: "invalid", detail: "the saved progress was ignored: " + why });
  let outer;
  try {
    outer = JSON.parse(text);
  } catch {
    return invalid("it is not a sealed state file");
  }
  if (!outer || outer.v !== 1 || typeof outer.mac !== "string" || typeof outer.body !== "string" || !/^[0-9a-f]{64}$/.test(outer.mac)) {
    return invalid("it is not a sealed state file");
  }
  if (!timingSafeEqual(Buffer.from(outer.mac, "hex"), mac(key, String(stories || ""), outer.body))) {
    return invalid("its seal does not match (made with another key or for another Stories address, or changed by someone else)");
  }
  let state;
  try {
    state = JSON.parse(outer.body);
  } catch {
    return invalid("it can't be read");
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) return invalid("it can't be read");
  const at = Date.parse(state.sealedAt || "");
  if (!(at <= now.getTime() + 5 * 60 * 1000)) return invalid("its date is missing or in the future");
  return { state, status: "ok", detail: "saved " + state.sealedAt + (state.sealedBy ? " by run " + state.sealedBy : "") };
}

/** Writes a file so a reader never sees half of it. */
export function writeAtomic(file, text) {
  fs.writeFileSync(file + ".tmp", text);
  fs.renameSync(file + ".tmp", file);
}

function cli([cmd, input, output]) {
  if (cmd !== "open" || !input || !output) {
    console.error("usage: node checker/state.mjs open <sealed file> <out file>");
    process.exit(2);
  }
  let text = null;
  try {
    text = fs.readFileSync(input, "utf8");
  } catch {
    text = null;
  }
  const res = openState(text, process.env.CHECKER_STATE_KEY, process.env.STORIES_ADDRESS);
  if (res.status === "ok") console.log("Saved progress: seal OK, " + res.detail + ".");
  else if (res.status === "fresh") console.log("::warning title=Copy checker::Starting from fresh progress: " + res.detail + ".");
  else if (res.status === "invalid") console.log("::error title=Copy checker::" + res.detail + ". Starting from fresh progress; protections come from the chain.");
  else console.log("::error title=Copy checker::" + res.detail + ". The checker only reports this run: nothing is searched, hidden or saved. Add CHECKER_STATE_KEY to the copy-checker environment.");
  writeAtomic(output, JSON.stringify({ ...res.state, load: { status: res.status, detail: res.detail } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli(process.argv.slice(2));
