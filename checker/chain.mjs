/**
 * The copy checker's connection to the Stories contract, shared by the plan
 * step (check.mjs, no key) and the apply step (apply.mjs, moderator key).
 *
 * Trust: the checker believes what its node (RPC) answers. A node that lies
 * could make it judge text that isn't on the chain, or miss text that is.
 * Mitigations: the node must serve the expected chain id (AB-015), every
 * write is a public signed transaction the chain itself validates (the
 * contract refuses a hide of an admin hide, a part that is gone, a bad
 * note), and the apply step re-reads each part right before signing. Use a
 * node you trust (the Koinos Foundation's, or your own) in RPC.
 */
import { createHash } from "crypto";
import fs from "fs";
import { createRequire } from "module";
import { checkChainId, expectedChainId } from "./lib.mjs";

const require = createRequire(new URL("../web/package.json", import.meta.url));
export const koilib = require("koilib");

/**
 * The Stories ABI is a committed file, checked against this hash before use
 * (audit L-12, owner decision 4a): the apply job, which holds the moderator
 * key, no longer builds ABIs from the proto with protobufjs at run time.
 * Regenerate both with: node checker/make-abi.mjs
 */
export const STORIES_ABI_SHA256 = "46719bcc94f0545a5f066241b89a23e4766c47f5ccf427052e392150d63ad4cb";

/** sha256 of an ABI file's text, ignoring line endings (a Windows checkout has CRLF). */
export function abiHash(text) {
  return createHash("sha256").update(String(text).replace(/\r\n/g, "\n")).digest("hex");
}

/** The Stories ABI from text (checker/stories.abi.json), or an error if it isn't the pinned file. */
export function loadStoriesAbi(text = fs.readFileSync(new URL("./stories.abi.json", import.meta.url), "utf8")) {
  if (abiHash(text) !== STORIES_ABI_SHA256) {
    throw new Error("checker/stories.abi.json is not the reviewed Stories ABI (its sha256 differs from STORIES_ABI_SHA256). Nothing was signed.");
  }
  return JSON.parse(text);
}

export async function connect(env) {
  if (!env.STORIES_ADDRESS) throw new Error("Set STORIES_ADDRESS.");
  const rpc = env.RPC || "https://testnet.koinosfoundation.org";
  const provider = new koilib.Provider([rpc]);
  const chainId = expectedChainId(rpc, env.EXPECTED_CHAIN_ID);
  checkChainId(chainId, await provider.getChainId());
  const stories = new koilib.Contract({ id: env.STORIES_ADDRESS, abi: loadStoriesAbi(), provider });
  const read = async (name, args) => (await stories.functions[name](args || {})).result || {};
  return { provider, stories, read, chainId };
}

/**
 * Now on Stories' activity clock (story.last_activity_at): wall time minus
 * every second Stories spent paused (the M-1 fix).
 */
export function activityNow(cfg, nowSec) {
  const pausedAt = Number(cfg.paused_at || 0);
  return nowSec - Number(cfg.paused_seconds || 0) - (pausedAt > 0 ? Math.max(0, nowSec - pausedAt) : 0);
}

/** The time budget in milliseconds: TIME_BUDGET_MINUTES (default 20, comfortably under the job's 30). */
export function timeBudgetMs(value) {
  const n = value === undefined || value === "" ? 20 : Number(value);
  return Number.isFinite(n) && n >= 0 ? n * 60000 : 20 * 60000;
}
