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
import { createRequire } from "module";
import { checkChainId, expectedChainId } from "./lib.mjs";

const require = createRequire(new URL("../web/package.json", import.meta.url));
export const koilib = require("koilib");

export async function connect(env) {
  if (!env.STORIES_ADDRESS) throw new Error("Set STORIES_ADDRESS.");
  const rpc = env.RPC || "https://testnet.koinosfoundation.org";
  const provider = new koilib.Provider([rpc]);
  const chainId = expectedChainId(rpc, env.EXPECTED_CHAIN_ID);
  checkChainId(chainId, await provider.getChainId());
  const { abis } = await import("../web/src/generated/abis.js");
  const stories = new koilib.Contract({ id: env.STORIES_ADDRESS, abi: abis.stories, provider });
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
