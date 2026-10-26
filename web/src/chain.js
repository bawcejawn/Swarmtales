/**
 * Read-only calls and operation encoding against the public Koinos RPC.
 * No private keys. Writes are encoded here and signed by a wallet adapter.
 */
import { Contract, Provider, utils } from "koilib";
import { abis } from "./generated/abis.js";
import { assertExpectedChain, contracts, DEFAULT_PAYMENT, isAddress, network, pinnedToken } from "./config.js";
import { headTimeSeconds } from "./lib/money.js";
import { confirmTransaction } from "./lib/confirm.js";
import { readAllSegments } from "./lib/segments.js";
import { sponsorableOperations, sponsorRcEstimate, sponsorRcLimit } from "./lib/sponsor.js";
import { checkPaymentToken, codeHashFromMeta } from "./lib/payment.js";

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
  const ids = { ink: contracts.ink, shop: contracts.shop, stories: contracts.stories, sponsor: contracts.sponsor };
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
 * The ABIs of the contracts these operations call, keyed by contract id, so
 * a wallet that can decode them (Kondor) shows the function and its
 * arguments (max_price, min_ink, ...) in its confirm window (audit M-9).
 */
export function abisFor(operations) {
  const known = {
    [contracts.ink]: abis.ink,
    [contracts.shop]: abis.shop,
    [contracts.stories]: abis.stories,
    [contracts.paymentToken]: utils.tokenAbi,
  };
  const out = {};
  for (const op of operations || []) {
    const id = op && op.call_contract && op.call_contract.contract_id;
    if (id && known[id]) out[id] = known[id];
  }
  return out;
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

/**
 * Whether the mana sponsor should pay for these operations, and with which
 * mana limit: { payer, payee, rcLimit } or null (pay with the user's own
 * mana). Any failure to read the sponsor means null: the user pays, as before.
 */
export async function sponsorFunding(address, operations) {
  if (!contracts.sponsor || !isAddress(contracts.sponsor)) return null;
  const ids = { ink: contracts.ink, shop: contracts.shop, stories: contracts.stories };
  if (!sponsorableOperations(operations, ids, [contracts.paymentToken])) return null;
  const want = sponsorRcEstimate(operations);
  if (contracts.sponsorKind === "payer") {
    // Any other paying contract (a mana station): no reads to make first.
    try {
      const free = await freeMana(contracts.sponsor);
      return free.free >= want ? { payer: contracts.sponsor, payee: address, rcLimit: want } : null;
    } catch {
      return null;
    }
  }
  try {
    const [cfg, mine, total, head, free] = await Promise.all([
      read("sponsor", "get_config", {}),
      read("sponsor", "get_usage", { account: address }),
      read("sponsor", "get_total_usage", {}),
      getProvider().getHeadInfo(),
      freeMana(contracts.sponsor),
    ]);
    if (!cfg) return null;
    const tokenListed = (cfg.tokens || []).includes(contracts.paymentToken);
    if (!tokenListed && operations.some((op) => op.call_contract.contract_id === contracts.paymentToken)) return null;
    const room = sponsorRcLimit({
      cfg, mine, total, ids,
      headMs: head && head.head_block_time,
      sponsorFree: free.free,
    });
    // Ask only when the sponsor can cover a realistic limit for these calls.
    return room >= want ? { payer: contracts.sponsor, payee: address, rcLimit: want } : null;
  } catch {
    return null;
  }
}

/** The sha256 of the code at `address` (hex), or null when there is none or the node won't say. */
export async function codeHashOf(address) {
  try {
    return codeHashFromMeta(await getProvider().invokeGetContractMetadata(address));
  } catch {
    return null;
  }
}

/**
 * Every payment token the Shop has turned on that this page may use: the
 * page's own token first (the overview checks it, M-8 and H-3), then the
 * others from shop.get_assets that are pinned in config.js PAYMENT_TOKENS
 * and whose decimals, Shop record and code hash match their pin (audit H-3,
 * L-18). Symbol and decimals always come from the pin, never from the node.
 */
export async function loadPaymentTokens() {
  const addresses = [DEFAULT_PAYMENT.address];
  try {
    const r = await read("shop", "get_assets", {});
    for (const t of (r && r.tokens) || []) if (isAddress(t) && !addresses.includes(t) && pinnedToken(t)) addresses.push(t);
  } catch {
    /* an older Shop without get_assets: only the page's own token */
  }
  const out = [];
  for (const address of addresses) {
    const asset = await read("shop", "get_asset", { token: address }).catch(() => null);
    if (!asset || !asset.enabled) continue;
    if (address === DEFAULT_PAYMENT.address) {
      out.push({ ...DEFAULT_PAYMENT, usable_from: asset.usable_from || "0" });
      continue;
    }
    const pin = pinnedToken(address);
    const token = new Contract({ id: address, abi: utils.tokenAbi, provider: getProvider() });
    const [dec, codeHash] = await Promise.all([token.functions.decimals({}).then((r) => r.result).catch(() => null), codeHashOf(address)]);
    const check = checkPaymentToken({ expected: pin, tokenDecimals: dec && dec.value, asset, now: 0, codeHash });
    if (!check.mismatch) out.push({ address, symbol: pin.symbol, decimals: pin.decimals, codeHash: pin.codeHash, usable_from: asset.usable_from || "0" });
  }
  return out;
}

export async function getMana(address) {
  return getProvider().getAccountRc(address);
}

export async function getHeadSeconds() {
  const head = await getProvider().getHeadInfo();
  return headTimeSeconds(head);
}

export async function loadAccount(address) {
  const [mana, token, ink, membership, promo, openCount, trial, now, status, mult] = await Promise.all([
    getMana(address),
    read("token", "balanceOf", { owner: address }),
    read("ink", "balance_of", { owner: address }),
    read("shop", "get_membership", { account: address }),
    read("shop", "get_promo_claimed", { account: address }),
    read("stories", "get_open_count", { account: address }),
    read("stories", "get_trial_used", { account: address }),
    getHeadSeconds(),
    read("stories", "get_account_status", { account: address }),
    read("stories", "get_open_multiplier", { account: address }),
  ]);
  return {
    blocked: !!(status && status.blocked),
    strikes: status && status.strikes ? Number(status.strikes) : 0,
    mana: mana || "0",
    token: token && token.value ? token.value : "0",
    ink: ink && ink.value ? ink.value : "0",
    membership: membership || {},
    promo: promo && promo.value ? promo.value : "0",
    openCount: openCount && openCount.value ? Number(openCount.value) : 0,
    openMultiplier: mult && mult.value ? Number(mult.value) : 1,
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
  const [storiesCfg, shopCfg, asset, writerPrice, shortPrice, bookPrice, packS, packM, packL, tokenDecimals, tokenCodeHash, now, poemPrice] = await Promise.all([
    read("stories", "get_config", {}),
    read("shop", "get_config", {}),
    read("shop", "get_asset", { token: contracts.paymentToken }),
    read("shop", "get_price", { item: 2, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 7, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 6, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 3, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 4, token: contracts.paymentToken }),
    read("shop", "get_price", { item: 5, token: contracts.paymentToken }),
    // The token's own decimals, checked against config.js before any price is shown (M-8).
    read("token", "decimals", {}).catch(() => null),
    // ... and its code, checked against its pin (H-3).
    codeHashOf(contracts.paymentToken),
    getHeadSeconds(),
    read("shop", "get_price", { item: 10, token: contracts.paymentToken }).catch(() => null),
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
    poemPrice: poemPrice && poemPrice.value ? poemPrice.value : "0",
    packs: [
      { item: 3, name: "Small", price: price(packS), ink: (shopCfg && shopCfg.pack_s_ink) || "0" },
      { item: 4, name: "Medium", price: price(packM), ink: (shopCfg && shopCfg.pack_m_ink) || "0" },
      { item: 5, name: "Large", price: price(packL), ink: (shopCfg && shopCfg.pack_l_ink) || "0" },
    ],
    categories,
    tokenDecimals: tokenDecimals && tokenDecimals.value != null ? Number(tokenDecimals.value) : null,
    tokenCodeHash,
    now: Number(now || 0),
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

/** One part, read on its own. */
export async function loadSegment(storyId, seq) {
  return read("stories", "get_segment", { story_id: String(storyId), seq: String(seq) });
}

/** A page of parts from `start` (at most `limit`): { values, next }. */
export async function loadSegmentPage(storyId, start, limit) {
  return read("stories", "get_segments", { story_id: String(storyId), start: String(start), limit });
}

/**
 * A story and all its parts. Parts are read a few at a time, following the
 * contract's `next`, and one by one where a page can't be read (M-5).
 */
export async function loadStory(id) {
  const story = await read("stories", "get_story", { story_id: String(id) });
  const count = Number((story && story.segment_count) || 0);
  const segments = Number(story && story.status) !== 0 && count > 0
    ? await readAllSegments({
      readPage: (start, limit) => loadSegmentPage(id, start, limit),
      readOne: (seq) => loadSegment(id, seq),
      count,
    })
    : [];
  return { story: story || {}, segments };
}

/** Whether this wallet already reported a part. */
export async function hasReported(storyId, seq, address) {
  const r = await read("stories", "has_reported", { story_id: String(storyId), seq: String(seq), account: address });
  return !!(r && r.value);
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
 * Wait until a transaction is in a block and its receipt says how it went
 * (or the time runs out). Returns { state: confirmed | reverted | unknown, logs }.
 */
export function waitForConfirmation(transactionId, ms = 90000) {
  return confirmTransaction(transactionId, {
    lookupTransaction,
    getBlockReceipts: async (blockIds) => {
      const result = await getProvider().getBlocksById(blockIds, { returnBlock: false, returnReceipt: true });
      return result && Array.isArray(result.block_items) ? result.block_items : [];
    },
    waitMs: ms,
    sleep: (t) => new Promise((r) => setTimeout(r, t)),
  });
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
