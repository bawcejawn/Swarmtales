/**
 * RSS feeds for the built site (dist/feeds/): the newest parts across public
 * stories, and the newest stories. Run after `vite build`; the Pages workflow
 * runs it on every deploy and once an hour, so readers (and Discord or
 * Telegram feed bots) hear about new parts without any server or email.
 * Read-only: no wallet, no key. If the node can't be reached, the feeds say
 * so and the build still succeeds.
 *
 * Run: node scripts/build-feeds.mjs [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, Provider } from "koilib";
import { abis } from "../src/generated/abis.js";
import { assertExpectedChain, contracts, network, SITE } from "../src/config.js";
import { feedXml, latestParts, newestStories } from "./feeds-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(here, "..", "dist"), "feeds");
const MAX_STORIES = 200;
const PARTS_PER_STORY = 5;
const TIMEOUT_MS = 20000;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

async function readChain() {
  const provider = new Provider([network.rpc]);
  assertExpectedChain(await withTimeout(provider.getChainId(), TIMEOUT_MS));
  const stories = new Contract({ id: contracts.stories, abi: abis.stories, provider });
  const call = async (method, args) => (await withTimeout(stories.functions[method](args || {}), TIMEOUT_MS)).result || {};
  const cfg = await call("get_config");
  const last = Math.min(Number(cfg.next_story_id || 1) - 1, MAX_STORIES);
  const rows = [];
  for (let id = 1; id <= last; id++) {
    const story = await call("get_story", { story_id: String(id) });
    if (!Number(story.status || 0)) continue;
    const count = Number(story.segment_count || 0);
    let parts = [];
    if (count > 0 && Number(story.visibility) === 1) {
      const start = Math.max(1, count - PARTS_PER_STORY + 1);
      const page = await call("get_segments", { story_id: String(id), start: String(start), limit: PARTS_PER_STORY }).catch(() => ({}));
      parts = (page.values || []).map((segment, i) => ({ seq: start + i, segment }));
    }
    rows.push({ id, story, parts });
  }
  return rows;
}

let rows = [];
let error = "";
try {
  rows = await readChain();
} catch (e) {
  error = e && e.message ? e.message : String(e);
  console.log("Feeds: could not read " + network.rpc + " (" + error + "). Writing empty feeds.");
}
const site = SITE.url;
const now = new Date();
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "latest.xml"), feedXml({
  title: "SwarmTales: new parts",
  link: site,
  self: site + "feeds/latest.xml",
  description: "The newest parts added to public SwarmTales stories" + (network.mainnet ? "." : " (test version on the Koinos testnet)."),
  items: latestParts(rows, site, 50),
  now,
}));
fs.writeFileSync(path.join(outDir, "stories.xml"), feedXml({
  title: "SwarmTales: new stories",
  link: site,
  self: site + "feeds/stories.xml",
  description: "Stories newly opened on SwarmTales" + (network.mainnet ? "." : " (test version on the Koinos testnet)."),
  items: newestStories(rows, site, 30),
  now,
}));
console.log("Feeds: " + rows.length + " stories read; wrote " + path.relative(process.cwd(), outDir) + (error ? " (empty: node not reachable)" : ""));
