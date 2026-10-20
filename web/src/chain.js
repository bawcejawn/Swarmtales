/**
 * Read-only calls and operation encoding against the public Koinos RPC.
 * No private keys. Writes are encoded here and signed by a wallet adapter.
 */
import { Contract, Provider, utils } from "koilib";
import { abis } from "./generated/abis.js";
import { assertExpectedChain, contracts, network } from "./config.js";
import { headTimeSeconds } from "./lib/money.js";

let provider;
let verifiedChainId = "";

export function getProvider() {
  if (!provider) provider = new Provider([network.rpc]);
  return provider;
}

export function verifiedChain() {
  return verifiedChainId;
}

export async function verifyChain() {
  let chainId;
  try {
    chainId = await getProvider().getChainId();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error("Could not reach " + network.rpc + " (" + message + ").");
  }
  assertExpectedChain(chainId);
  verifiedChainId = chainId;
  return chainId;
}

function abiContract(name, signer) {
  const ids = { ink: contracts.ink, shop: contracts.shop, stories: contracts.stories };
  if (!ids[name]) throw new Error("Unknown contract " + name);
  return new Contract({
    id: ids[name],
    abi: abis[name],
    provider: getProvider(),
    signer,
  });
}

export function tokenContract(signer) {
  return new Contract({
    id: contracts.paymentToken,
    abi: utils.tokenAbi,
    provider: getProvider(),
    signer,
  });
}

function instance(name, signer) {
  return name === "token" ? tokenContract(signer) : abiContract(name, signer);
}

/** A read that does not ask a wallet to sign. */
export async function read(name, method, args) {
  const { result } = await instance(name).functions[method](args || {});
  return result == null ? null : result;
}

export async function encode(name, method, args) {
  return instance(name).encodeOperation({ name: method, args: args || {} });
}

/**
 * Mana a wallet can use right now. After a transaction, the node keeps its
 * whole mana limit set aside for a few minutes, even once it is in a block.
 */
export async function freeMana(address) {
  const total = BigInt((await getProvider().getAccountRc(address)) || "0");
  let reserved = 0n;
  try {
    const r = await getProvider().call("mempool.get_reserved_account_rc", { account: address });
    if (r && r.rc) reserved = BigInt(r.rc);
  } catch {
    reserved = 0n;
  }
  return { total, reserved, free: total > reserved ? total - reserved : 0n };
}

/** Ask for what an action measured, plus a quarter, and never more than is free. */
export function manaLimit(used, free) {
  let limit = (BigInt(used) * 125n) / 100n + 1000000n;
  if (limit > free) limit = free;
  return limit;
}

export async function getMana(address) {
  return getProvider().getAccountRc(address);
}

export async function getHeadSeconds() {
  const head = await getProvider().getHeadInfo();
  return headTimeSeconds(head);
}

export async function loadAccount(address) {
  const [mana, token, ink, membership, promo, openCount, trial, now] = await Promise.all([
    getMana(address),
    read("token", "balanceOf", { owner: address }),
    read("ink", "balance_of", { owner: address }),
    read("shop", "get_membership", { account: address }),
    read("shop", "get_promo_claimed", { account: address }),
    read("stories", "get_open_count", { account: address }),
    read("stories", "get_trial_used", { account: address }),
    getHeadSeconds(),
  ]);
  return {
    mana: mana || "0",
    token: token && token.value ? token.value : "0",
    ink: ink && ink.value ? ink.value : "0",
    membership: membership || {},
    promo: promo && promo.value ? promo.value : "0",
    openCount: openCount && openCount.value ? Number(openCount.value) : 0,
    trial: trial && trial.value ? trial.value : "0",
    now,
  };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  const workers = [];
  const n = Math.min(limit, items.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

export async function loadOverview() {
  const [storiesCfg, shopCfg, asset, writerPrice, shortPrice, bookPrice, packS, packM, packL] = await Promise.all([
    read("stories", "get_config", {}),
    read("shop", "get_config", {}),
    read("shop", "get_asset", { token: contracts.paymentToken }),
    read("shop", "get_price", { item: 2, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 7, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 6, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 3, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 4, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 5, token: contracts.paymentToken }),
  ]);
  const price = (r) => (r && r.value ? r.value : "0");
  const nextCat = Number((storiesCfg && storiesCfg.next_category_id) || 0);
  const ids = [];
  for (let id = 1; id < nextCat && id <= 255; id++) ids.push(id);
  const categories = await mapPool(ids, 6, async (id) => {
    const cat = await read("stories", "get_category", { category_id: id });
    return { id, name: (cat && cat.name) || ("Category " + id), active: !!(cat && cat.active) };
  });
  return {
    storiesCfg: storiesCfg || {},
    shopCfg: shopCfg || {},
    asset: asset || {},
    writerPrice: writerPrice && writerPrice.value ? writerPrice.value : "0",
    shortPrice: shortPrice && shortPrice.value ? shortPrice.value : "0",
    bookPrice: bookPrice && bookPrice.value ? bookPrice.value : "0",
    packs: [
      { item: 3, name: "Small", price: price(packS), ink: (shopCfg && shopCfg.pack_s_ink) || "0" },
      { item: 4, name: "Medium", price: price(packM), ink: (shopCfg && shopCfg.pack_m_ink) || "0" },
      { item: 5, name: "Large", price: price(packL), ink: (shopCfg && shopCfg.pack_l_ink) || "0" },
    ],
    categories,
  };
}

export async function listStories(nextStoryId) {
  const last = Number(nextStoryId || 0) - 1;
  if (!Number.isFinite(last) || last < 1) return { stories: [], truncated: false };
  const ids = [];
  const cap = 200;
  for (let id = 1; id <= last && id <= cap; id++) ids.push(id);
  const rows = await mapPool(ids, 6, async (id) => {
    const story = await read("stories", "get_story", { story_id: String(id) });
    return { id, story: story || {} };
  });
  return { stories: rows.filter((row) => Number(row.story.status || 0) !== 0), truncated: last > cap };
}

export async function loadStory(id) {
  const story = await read("stories", "get_story", { story_id: String(id) });
  const count = Number((story && story.segment_count) || 0);
  const segments = [];
  if (Number(story && story.status) !== 0 && count > 0) {
    for (let start = 1; start <= count; start += 10) {
      const page = await read("stories", "get_segments", {
        story_id: String(id),
        start: String(start),
        limit: 10,
      });
      const values = page && Array.isArray(page.values) ? page.values : [];
      segments.push(...values);
    }
  }
  return { story: story || {}, segments };
}

export async function quoteCost(text) {
  const result = await read("stories", "quote_cost", { text });
  return result && result.value ? result.value : "0";
}

export async function writerFlags(storyId, address) {
  const [editor, allowed] = await Promise.all([
    read("stories", "is_editor", { story_id: String(storyId), account: address }),
    read("stories", "is_allowed", { story_id: String(storyId), account: address }),
  ]);
  return {
    editor: !!(editor && editor.value),
    allowed: !!(allowed && allowed.value),
  };
}

/**
 * After a wallet reports a transaction id, ask the node whether it landed.
 * A missing receipt is not treated as success or failure.
 */
export async function lookupTransaction(transactionId) {
  try {
    const rows = await getProvider().getTransactionsById([transactionId]);
    const row = rows && (rows.transactions ? rows.transactions[0] : rows[0]);
    return row || null;
  } catch {
    return null;
  }
}
