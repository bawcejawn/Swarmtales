/**
 * Pure helpers for deploy/deploy.js. Nothing in this file talks to the
 * network, reads a key, or writes a file, so it can be unit tested.
 */
"use strict";

const crypto = require("crypto");

// ---- Signed invite/promo links (fixes H2 and H3) ----
// Build the exact message the Shop and Stories contracts recover a
// signature against. Callers pass raw address bytes (from koilib's
// decodeBase58), so this file stays free of network and heavy deps.
const PROMO_DOMAIN = "swarmtales/promo/v1";
const INVITE_DOMAIN = "swarmtales/invite/v1";

function u64BE(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
}

function promoMessage(shopBytes, campaignId, accountBytes) {
  return Buffer.concat([Buffer.from(PROMO_DOMAIN), Buffer.from(shopBytes), u64BE(campaignId), Buffer.from(accountBytes)]);
}

function inviteMessage(storiesBytes, storyId, inviteId, accountBytes) {
  return Buffer.concat([Buffer.from(INVITE_DOMAIN), Buffer.from(storiesBytes), u64BE(storyId), u64BE(inviteId), Buffer.from(accountBytes)]);
}

function sha256(bytes) {
  return new Uint8Array(crypto.createHash("sha256").update(Buffer.from(bytes)).digest());
}

// Networks this script knows. The chain id is checked against the node
// before anything is signed, so a wrong or swapped URL stops the run.
const NETWORKS = {
  testnet: {
    name: "Koinos testnet (Koinos Foundation)",
    rpc: "https://testnet.koinosfoundation.org",
    chainId: "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==",
    koin: "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju",
    mainnet: false,
  },
  mainnet: {
    name: "Koinos MAINNET (real KOIN)",
    rpc: "https://api.koinos.io",
    chainId: "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==",
    koin: "15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL",
    mainnet: true,
  },
};

const MAINNET_FLAG = "--i-understand-this-is-mainnet";
const SECRET_ENV = "SWARMTALES_DEPLOY_SECRET";

// Ink mint reasons Shop may use: PURCHASE(1) MEMBERSHIP(2) STARTER(3) PROMO(4).
// Bit n is reason n, so the mask is 2+4+8+16 = 30. REFUND(5) is not included.
const SHOP_MINT_MASK = 30;

// Ink mint reasons Stories may use: REFUND(5) only, so the mask is 2^5 = 32.
// Stories can never mint purchase, membership, starter or promo Ink.
const STORIES_MINT_MASK = 32;

// Categories `wire-stories` creates, in this order (ids 1 to 11).
const STORY_CATEGORIES = [
  "Fantasy",
  "Sci-Fi",
  "Mystery & Thriller",
  "Romance",
  "Horror",
  "Comedy",
  "Adventure",
  "Drama",
  "Historical",
  "Poetry & Experimental",
  "Other",
];

// Text sizes `measure` dry-runs, in Ink (UTF-16 code units).
const MEASURE_SIZES = [100, 500, 1000, 2000, 4000];

// Default sample for `test-write` when --size and --text are both omitted.
const DEFAULT_TEST_WRITE_SIZE = 100;

// Story kinds and visibility from stories.proto (koilib needs numbers).
const STORY_KIND = { BOOK: 1, SHORT: 2 };
const STORY_VISIBILITY = { PUBLIC: 1, UNLISTED: 2, PRIVATE: 3 };

/** UTF-16 code units: exactly what Stories charges for text. */
function inkCost(text) {
  return String(text).length;
}

/**
 * Text for `measure` that costs exactly `units` Ink. Plain mode is
 * ordinary words. Emoji mode mixes in 😀 (2 units) so the dry run shows
 * the cost of surrogate pairs. Never starts or ends with a space, never
 * has line breaks, so Stories accepts it.
 */
function measurementText(units, emoji) {
  const n = Number(units);
  if (!Number.isInteger(n) || n < 1) fail("measurement size must be a whole number of at least 1");
  const word = emoji ? "story\uD83D\uDE00 " : "story ";
  let out = "";
  while (out.length + word.length <= n) out += word;
  while (out.length < n) out += "a";
  if (out.endsWith(" ")) out = out.slice(0, -1) + "a";
  if (inkCost(out) !== n) fail("internal: measurement text has the wrong length");
  return out;
}

/** A non-negative whole number from a flag or a chain read. Never accepts blanks or decimals. */
function asWhole(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) fail(label + " must be a whole number of 0 or more.");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) fail(label + " must be a whole number of 0 or more.");
    return BigInt(value);
  }
  if (typeof value !== "string") fail(label + " must be a whole number of 0 or more.");
  const s = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(s)) fail(label + " must be a whole number of 0 or more.");
  return BigInt(s);
}

/**
 * Story id for `measure` and `test-write`. The opener of that story can
 * write without the Writer-membership checks that apply to everyone else.
 */
function requireStoryId(value) {
  if (value === undefined || value === null || value === true || !/^[1-9][0-9]*$/.test(String(value))) {
    fail("Add --story <id> (a story you opened, so no membership check is needed).");
  }
  return String(value);
}

/** Same opener rule as `measure`: this wallet opened the story. */
function assertStoryOpener(storyId, opener, user) {
  if (opener !== user) {
    fail("Story " + storyId + " was opened by " + (opener || "nobody") + ", not " + user + ". Use your own story.");
  }
}

/**
 * Plan the one `contribute` that `test-write` will send.
 *
 * `request` is { size, emoji, text } from the command flags.
 * `limits` is { cap, maxChars, usedChars, balance } from the chain
 * (whole numbers, as strings, numbers, or bigints).
 *
 * Generated text (no --text) defaults to 100 plain units and is lowered
 * to the per-submission cap and the space left in the story. Custom text
 * is refused when it does not fit; it is never shortened. A balance below
 * the cost of the text that would be sent is refused. Nothing here signs
 * or broadcasts.
 *
 * Returns { text, cost, requested, capped, cap, spaceLeft, balance, emoji, custom }.
 * Costs are decimal strings.
 */
function planTestWrite(request, limits) {
  const req = request || {};
  const lim = limits || {};
  if (lim.cap === undefined || lim.cap === null || lim.cap === "") fail("Could not read the per-submission cap. Nothing was sent.");
  if (lim.maxChars === undefined || lim.maxChars === null || lim.maxChars === "") fail("Could not read this story's size. Nothing was sent.");
  if (lim.balance === undefined || lim.balance === null || lim.balance === "") fail("Could not read the Ink balance. Nothing was sent.");

  const cap = asWhole(lim.cap, "contribution cap");
  const maxChars = asWhole(lim.maxChars, "story size");
  const usedRaw = lim.usedChars === undefined || lim.usedChars === null || lim.usedChars === "" ? "0" : lim.usedChars;
  const used = asWhole(usedRaw, "used characters");
  const balance = asWhole(lim.balance, "Ink balance");
  if (used > maxChars) fail("This story is already over its size. Nothing was sent.");
  const space = maxChars - used;
  if (cap < 1n) fail("The per-submission cap is 0. Nothing was sent.");

  const hasText = req.text !== undefined && req.text !== null;
  const hasSize = req.size !== undefined && req.size !== null;
  if (hasText && req.text === true) fail("--text needs the words to write.");
  if (hasText && typeof req.text !== "string") fail("--text needs the words to write.");
  if (hasSize && hasText) fail("Use either --text or --size.");
  if (hasText && req.emoji) fail("--emoji applies to the generated sample. Leave it off when you pass --text.");

  let text;
  let requested;
  let capped = false;
  const emoji = !hasText && !!req.emoji;

  if (hasText) {
    text = req.text;
    if (text.length === 0) fail("The text is empty. Nothing was sent.");
    requested = BigInt(inkCost(text));
    if (requested > cap) {
      fail("That text costs " + requested + " Ink, over the per-submission cap of " + cap + ". Nothing was sent.");
    }
    if (requested > space) {
      fail("That text costs " + requested + " Ink, and this story has " + space + " left. Nothing was sent.");
    }
  } else {
    if (hasSize && req.size === true) fail("--size needs a whole number of Ink units.");
    const raw = hasSize ? asWhole(req.size, "--size") : BigInt(DEFAULT_TEST_WRITE_SIZE);
    if (raw < 1n) fail("--size must be at least 1.");
    if (space < 1n) fail("This story has no space left. Nothing was sent.");
    let size = raw;
    if (size > cap) {
      size = cap;
      capped = true;
    }
    if (size > space) {
      size = space;
      capped = true;
    }
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) fail("That size is too large to build. Nothing was sent.");
    text = measurementText(Number(size), emoji);
    requested = raw;
  }

  const cost = BigInt(inkCost(text));
  if (balance < cost) {
    const note = capped ? " (size was lowered from " + requested + " to " + cost + ")" : "";
    fail("Ink balance is " + balance + " and this text costs " + cost + note + ". Nothing was sent.");
  }
  return {
    text,
    cost: cost.toString(),
    requested: requested.toString(),
    capped,
    cap: cap.toString(),
    spaceLeft: space.toString(),
    balance: balance.toString(),
    emoji,
    custom: hasText,
  };
}

/**
 * shop.set_addresses replaces all four addresses at once. Build its
 * arguments from what the Shop has on chain now, changing only `stories`.
 * Refuses if the chain disagrees with what the user said, or if a
 * different Stories contract is already set.
 */
function shopAddressesForStories(onChain, wanted) {
  const cfg = onChain || {};
  const treasury = cfg.treasury || "";
  const founder = cfg.founder || "";
  const ink = cfg.ink || "";
  const current = cfg.stories || "";
  if (!isAddress(treasury) || !isAddress(founder)) fail("Shop has no treasury or founder set yet. Run wire first.");
  if (ink !== wanted.ink) fail("Shop points at Ink " + (ink || "(none)") + " but you gave --ink " + wanted.ink + ". Nothing was changed.");
  if (wanted.treasury && wanted.treasury !== treasury) fail("Shop treasury on chain is " + treasury + " but you gave --treasury " + wanted.treasury + ". Nothing was changed.");
  if (wanted.founder && wanted.founder !== founder) fail("Shop founder on chain is " + founder + " but you gave --founder " + wanted.founder + ". Nothing was changed.");
  if (current && current !== wanted.stories) fail("Shop already points at a different Stories contract (" + current + "). Nothing was changed.");
  return { treasury, founder, ink, stories: wanted.stories };
}

// Ink amounts used by `wire` unless overridden (writer month, packs S/M/L,
// starter for a book, starter for a short story).
const DEFAULT_INK_AMOUNTS = {
  writer_month: "15000",
  pack_s: "5000",
  pack_m: "15000",
  pack_l: "45000",
  starter_book: "20000",
  starter_short: "10000",
};

// Testnet-only prices for `test-asset`, in base units of an 8-decimal token
// (100000000 = 1 token). Small on purpose. These are NOT launch prices.
// Enum values from shop.proto. koilib needs the numbers, not the names.
const SHOP_ITEMS = {
  ITEM_READER_MONTH: 1,
  ITEM_WRITER_MONTH: 2,
  ITEM_PACK_S: 3,
  ITEM_PACK_M: 4,
  ITEM_PACK_L: 5,
  ITEM_OPEN_BOOK: 6,
  ITEM_OPEN_SHORT: 7,
  ITEM_CLOSE_BOOK: 8,
  ITEM_CLOSE_SHORT: 9,
};
const TIER_READER = 1;
const TIER_WRITER = 2;

// Test promo used by `test-promo` and `claim-promo` (testnet only).
const TEST_PROMO = {
  amount: "500",
  budget_total: "5000",
  daily_cap: "1000",
  days: 7,
};

/**
 * A negative check passes only if the node rejected the call for a
 * contract reason. Network, mana and nonce problems are inconclusive,
 * because they say nothing about the contract.
 */
function classifyRejection(message) {
  const m = String(message || "");
  if (/rc limit|have the rc|mana|nonce|chain id|fetch|ECONN|ETIMEDOUT|socket|Premature close|contract does not exist/i.test(m)) {
    return "INCONCLUSIVE";
  }
  return "PASS";
}

const TEST_PRICES = {
  ITEM_READER_MONTH: "100000000",
  ITEM_WRITER_MONTH: "200000000",
  ITEM_PACK_S: "50000000",
  ITEM_PACK_M: "100000000",
  ITEM_PACK_L: "200000000",
  ITEM_OPEN_BOOK: "100000000",
  ITEM_OPEN_SHORT: "50000000",
  ITEM_CLOSE_BOOK: "50000000",
  ITEM_CLOSE_SHORT: "25000000",
};

const ADDRESS_RE = /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/;

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

class UserError extends Error {}

function fail(message) {
  throw new UserError(message);
}

function requireAddress(value, label) {
  if (!value) fail("Missing " + label + ". Add --" + label + " <address>.");
  if (!isAddress(value)) fail(label + " does not look like a Koinos address: " + value);
  return value;
}

/**
 * Parse argv (without node and script path).
 * Returns { command, target, flags } where flags maps name -> string|true.
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  const secretFlags = ["key", "wif", "private-key", "privatekey", "secret", "seed", "mnemonic", "password"];
  for (const name of Object.keys(flags)) {
    if (secretFlags.indexOf(name.toLowerCase()) !== -1) {
      fail(
        "Do not pass a key on the command line (--" + name + "). It would be saved in your " +
          "terminal history. Run the command without it and paste the key at the hidden prompt."
      );
    }
  }
  return { command: positional[0], target: positional[1], rest: positional.slice(2), flags };
}

/**
 * Pick the network. Testnet is the default. Mainnet needs both
 * --network mainnet and the long confirmation flag.
 */
function resolveNetwork(flags) {
  const name = flags.network === undefined ? "testnet" : String(flags.network);
  const net = NETWORKS[name];
  if (!net) fail("Unknown network '" + name + "'. Use testnet (default) or mainnet.");
  if (net.mainnet && flags[MAINNET_FLAG.slice(2)] !== true) {
    fail(
      "Refusing to use mainnet. This guide is for testnet. If you really mean mainnet, " +
        "add " + MAINNET_FLAG + " as well."
    );
  }
  const rpc = typeof flags.rpc === "string" ? flags.rpc : net.rpc;
  if (!/^https:\/\//.test(rpc)) fail("RPC URL must start with https:// : " + rpc);
  return Object.assign({}, net, { key: name, rpc });
}

/** Stop if the node's chain id is not the one this network expects. */
function checkChainId(net, actual) {
  if (actual !== net.chainId) {
    fail(
      "Chain id mismatch. Expected " + net.chainId + " for " + net.name + " but the node at " +
        net.rpc + " reports " + actual + ". Nothing was signed."
    );
  }
}

/**
 * Turn what the user pasted into constructor input for koilib's Signer.
 * Accepts a WIF (51-52 base58 chars) or a 64-char hex private key.
 * Never puts the secret in an error message.
 */
function classifySecret(raw) {
  const s = String(raw || "").trim();
  if (s === "") fail("No key was entered.");
  if (/\s/.test(s)) {
    fail("That looks like a seed phrase (it has spaces). This script only takes a single private key (WIF). Nothing was used.");
  }
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return { kind: "hex", value: s.replace(/^0x/, "").toLowerCase() };
  if (/^[1-9A-HJ-NP-Za-km-z]{51,52}$/.test(s)) return { kind: "wif", value: s };
  if (isAddress(s)) fail("That is a public address, not a private key.");
  fail("That does not look like a private key (WIF or 64 hex characters). Nothing was used.");
}

/** Refuse unless the key really controls the address we expect. */
function checkSignerAddress(derived, expected, label) {
  if (derived !== expected) {
    fail(
      "Wrong key. This key controls " + derived + " but " + label + " is " + expected +
        ". Nothing was signed."
    );
  }
}

/** Mana / rc (1e8 per KOIN) as a readable string. */
function formatMana(rc) {
  const n = BigInt(rc);
  const whole = n / 100000000n;
  const frac = (n % 100000000n).toString().padStart(8, "0").slice(0, 4);
  return whole.toString() + "." + frac;
}

/** rc limit for the real send: 25% above the dry run, never above what the payer has. */
function rcLimitFor(rcUsed, available) {
  const used = BigInt(rcUsed);
  const avail = BigInt(available);
  let limit = (used * 125n) / 100n + 1000000n;
  if (limit > avail) limit = avail;
  return limit.toString();
}

/**
 * The build writes abi/<name>.abi: methods with "entry-point" (hex text),
 * "argument", "return", "read-only", and "types" (a base64 protobuf
 * descriptor that keeps the snake_case field names from the .proto).
 * koilib wants entry_point (number), argument, return, read_only, types.
 * The -abi.json file is not used: its field names are camelCase.
 */
function toKoilibAbi(generated) {
  if (!generated || typeof generated.methods !== "object" || typeof generated.types !== "string") {
    fail("The generated .abi file is not in the expected format. Rebuild the contract.");
  }
  const methods = {};
  for (const name of Object.keys(generated.methods)) {
    const m = generated.methods[name];
    const raw = m["entry-point"];
    const entry = typeof raw === "number" ? raw : parseInt(String(raw), 16);
    if (!Number.isFinite(entry)) fail("ABI method " + name + " has no entry point. Rebuild the contract.");
    methods[name] = {
      entry_point: entry,
      argument: m.argument,
      return: m.return,
      read_only: !!m["read-only"],
      description: m.description,
    };
  }
  return { methods, types: generated.types };
}

/** Read the user's single-line answer and decide if it confirms. */
function isConfirmation(answer) {
  return String(answer || "").trim() === "SEND";
}

module.exports = {
  STORIES_MINT_MASK,
  STORY_CATEGORIES,
  MEASURE_SIZES,
  DEFAULT_TEST_WRITE_SIZE,
  STORY_KIND,
  STORY_VISIBILITY,
  inkCost,
  measurementText,
  requireStoryId,
  assertStoryOpener,
  planTestWrite,
  shopAddressesForStories,
  NETWORKS,
  MAINNET_FLAG,
  SECRET_ENV,
  SHOP_MINT_MASK,
  DEFAULT_INK_AMOUNTS,
  TEST_PRICES,
  SHOP_ITEMS,
  TIER_READER,
  TIER_WRITER,
  TEST_PROMO,
  classifyRejection,
  UserError,
  fail,
  isAddress,
  requireAddress,
  parseArgs,
  resolveNetwork,
  checkChainId,
  classifySecret,
  checkSignerAddress,
  formatMana,
  rcLimitFor,
  isConfirmation,
  toKoilibAbi,
  PROMO_DOMAIN,
  INVITE_DOMAIN,
  promoMessage,
  inviteMessage,
  sha256,
};
