/**
 * Read-only probe of the live Foundation testnet.
 * No wallet, no signature, no write. Run: npm run read-testnet
 */
import { Contract, Provider, utils } from "koilib";
import { abis } from "../src/generated/abis.js";
import { assertExpectedChain, contracts, network } from "../src/config.js";

const SAMPLE = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww";
const QUOTES = ["a", "😀", "⭐", "👍🏽", "🇺🇸", "👨‍👩‍👧", "Hi 😀"];

const provider = new Provider([network.rpc]);

function contract(name) {
  const ids = { ink: contracts.ink, shop: contracts.shop, stories: contracts.stories };
  return new Contract({ id: ids[name], abi: abis[name], provider });
}

async function call(name, method, args) {
  const target = name === "token"
    ? new Contract({ id: contracts.paymentToken, abi: utils.tokenAbi, provider })
    : contract(name);
  const { result } = await target.functions[method](args || {});
  return result || null;
}

const chainId = await provider.getChainId();
assertExpectedChain(chainId);

const story = await call("stories", "get_story", { story_id: "1" });
const page = await call("stories", "get_segments", { story_id: "1", start: "1", limit: 10 });
const storiesCfg = await call("stories", "get_config", {});
const shopCfg = await call("shop", "get_config", {});
const writerPrice = await call("shop", "get_price", { item: 2, token: contracts.paymentToken });
const shortPrice = await call("shop", "get_price", { item: 7, token: contracts.paymentToken });
const nextCat = Number((storiesCfg && storiesCfg.next_category_id) || 0);
const categories = [];
for (let id = 1; id < nextCat && id <= 20; id++) {
  const cat = await call("stories", "get_category", { category_id: id });
  categories.push({ id, name: cat && cat.name, active: !!(cat && cat.active) });
}
const quotes = {};
for (const text of QUOTES) {
  const quoted = await call("stories", "quote_cost", { text });
  quotes[text] = quoted && quoted.value ? quoted.value : null;
}
const account = {
  address: SAMPLE,
  tkoin: (await call("token", "balanceOf", { owner: SAMPLE }) || {}).value || "0",
  ink: (await call("ink", "balance_of", { owner: SAMPLE }) || {}).value || "0",
  mana: await provider.getAccountRc(SAMPLE),
  membership: await call("shop", "get_membership", { account: SAMPLE }),
  promo: await call("shop", "get_promo_claimed", { account: SAMPLE }),
};

const segments = page && Array.isArray(page.values) ? page.values : [];
const report = {
  rpc: network.rpc,
  chainId,
  contracts,
  stories: {
    contribution_cap: storiesCfg && storiesCfg.contribution_cap,
    next_story_id: storiesCfg && storiesCfg.next_story_id,
    next_category_id: storiesCfg && storiesCfg.next_category_id,
    categories,
  },
  shop: {
    paused: shopCfg && shopCfg.paused,
    promo_enabled: shopCfg && shopCfg.promo_enabled,
    writerMonth: writerPrice && writerPrice.value,
    openShort: shortPrice && shortPrice.value,
  },
  story1: story,
  segmentCount: segments.length,
  segmentChars: segments.map((row) => (row && row.text ? String(row.text).length : 0)),
  storyTextChars: segments.reduce((sum, row) => sum + (row && row.text && Number(row.status) !== 2 ? String(row.text).length : 0), 0),
  quotes,
  account,
};

console.log(JSON.stringify(report, null, 2));
