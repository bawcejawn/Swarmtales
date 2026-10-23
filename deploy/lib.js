/**
 * Pure helpers for deploy/deploy.js. Nothing in this file talks to the
 * network, reads a key, or writes a file, so it can be unit tested.
 */
"use strict";

const crypto = require("crypto");

// ---- MAINNET ADDRESSES (audit M-6) ----
// Fill in each address once that contract is uploaded to mainnet (one line
// each), and the payment stablecoin's address before set-asset. Until then
// "" means "not pinned yet". On mainnet every command refuses any other
// address unless PIN_OVERRIDE_FLAG is given; only `upload` may name an
// address that is not pinned yet (that is how it gets one).
const MAINNET_PINNED = {
  ink: "",
  shop: "",
  stories: "",
  token: "",
};
const PINNED_ROLES = ["ink", "shop", "stories", "token"];
const CONTRACT_ROLES = ["ink", "shop", "stories"];
const PIN_OVERRIDE_FLAG = "--i-understand-this-address-is-not-pinned";
const HASH_OVERRIDE_FLAG = "--i-understand-the-code-hash-is-not-verified";

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
    trustedRpcs: ["https://api.koinos.io"],   // the only nodes --rpc may name on mainnet
    chainId: "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==",
    koin: "15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL",
    mainnet: true,
    pinned: MAINNET_PINNED,
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
const STORY_VISIBILITY = { PUBLIC: 1, PRIVATE: 3 };

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
  const word = emoji ? "story😀 " : "story ";
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

/** A whole number from a flag, from `min` to `max`. */
function wholeInRange(value, label, min, max) {
  const n = Number(value);
  if (typeof value !== "string" && typeof value !== "number") fail(label + " must be a whole number from " + min + " to " + max + ".");
  if (!/^[0-9]+$/.test(String(value).trim()) || !Number.isInteger(n) || n < min || n > max) {
    fail(label + " must be a whole number from " + min + " to " + max + ".");
  }
  return n;
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
 * different Stories contract is already set: Shop's Stories address is set
 * once, like its Ink address (AB-050, C1-07).
 */
function shopAddressesForStories(onChain, wanted) {
  const cfg = onChain || {};
  const treasury = cfg.treasury || "";
  const founder = cfg.founder || "";
  const ink = cfg.ink || "";
  if (!isAddress(treasury) || !isAddress(founder)) fail("Shop has no treasury or founder set yet. Run wire first.");
  // On mainnet the payout addresses are never taken from the node alone (AB-009).
  if (wanted.mainnet && (!wanted.treasury || !wanted.founder)) {
    fail("On mainnet, give --treasury and --founder: they are checked against the Shop on chain instead of trusting the node. Nothing was changed.");
  }
  if (ink !== wanted.ink) fail("Shop points at Ink " + (ink || "(none)") + " but you gave --ink " + wanted.ink + ". Nothing was changed.");
  if (wanted.treasury && wanted.treasury !== treasury) fail("Shop treasury on chain is " + treasury + " but you gave --treasury " + wanted.treasury + ". Nothing was changed.");
  if (wanted.founder && wanted.founder !== founder) fail("Shop founder on chain is " + founder + " but you gave --founder " + wanted.founder + ". Nothing was changed.");
  requireSetOnce("Shop's Stories address", cfg.stories, wanted.stories);
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

// Enum values from shop.proto. koilib needs the numbers, not the names.
const SHOP_ITEMS = {
  ITEM_READER_MONTH: 1,
  ITEM_WRITER_MONTH: 2,
  ITEM_PACK_S: 3,
  ITEM_PACK_M: 4,
  ITEM_PACK_L: 5,
  ITEM_OPEN_BOOK: 6,
  ITEM_OPEN_SHORT: 7,
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

// The published site, for promo share links (docs/UI.md). --site overrides it.
const DEFAULT_SITE = "https://bawcejawn.github.io/Swarmtales/";
const DEFAULT_PROMO_AMOUNT = "100";

/**
 * A promo date: "now", a day ("2026-11-01", midnight UTC), or a UTC time
 * ("2026-11-01T18:00", seconds and a trailing Z optional). Returns unix seconds.
 */
function parsePromoDate(value, label, nowSec) {
  const raw = value === undefined || value === true ? "" : String(value).trim();
  if (raw === "now") return nowSec;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?Z?)?$/.exec(raw);
  if (!m) fail("--" + label + " must be now, a day like 2026-11-01, or a UTC time like 2026-11-01T18:00.");
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  const back = new Date(ms);
  if (back.getUTCFullYear() !== Number(m[1]) || back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3]) ||
      Number(m[4] || 0) > 23 || Number(m[5] || 0) > 59 || Number(m[6] || 0) > 59) {
    fail("--" + label + " is not a real date: " + raw + ".");
  }
  return Math.floor(ms / 1000);
}

/**
 * The create_campaign arguments for `promo-new`, without the link key.
 * --amount defaults to 100 Ink per wallet; --budget (total Ink) and --end are
 * required; --start defaults to now; --daily-cap is optional (0 = none).
 */
function planPromoCampaign(flags, nowSec) {
  const amount = String(asWhole(flags.amount === undefined ? DEFAULT_PROMO_AMOUNT : flags.amount, "--amount"));
  if (BigInt(amount) < 1n) fail("--amount must be at least 1 Ink.");
  if (flags.budget === undefined || flags.budget === true) fail("--budget is required: the most Ink this campaign may give in total.");
  const budget = String(asWhole(flags.budget, "--budget"));
  if (BigInt(budget) < BigInt(amount)) fail("--budget must cover at least one claim (" + amount + " Ink).");
  const dailyCap = flags["daily-cap"] === undefined ? "0" : String(asWhole(flags["daily-cap"], "--daily-cap"));
  if (dailyCap !== "0" && BigInt(dailyCap) < BigInt(amount)) fail("--daily-cap must be 0 (no cap) or cover at least one claim (" + amount + " Ink).");
  if (flags.end === undefined || flags.end === true) fail("--end is required: when the campaign stops (a day like 2026-12-31, UTC).");
  const startsAt = flags.start === undefined ? nowSec : parsePromoDate(flags.start, "start", nowSec);
  const endsAt = parsePromoDate(flags.end, "end", nowSec);
  if (endsAt <= nowSec) fail("--end is in the past.");
  if (endsAt <= startsAt) fail("--end must be after --start.");
  return {
    amount,
    budget_total: budget,
    daily_cap: dailyCap,
    starts_at: String(startsAt),
    ends_at: String(endsAt),
    single_use: false,
    enabled: true,
  };
}

/** The share link for a shared campaign. Contains the link key: show it once, never log it. */
function promoShareLink(site, campaignId, wif) {
  const base = String(site || DEFAULT_SITE);
  if (!/^https:\/\/[^\s#?]+$/.test(base)) fail("--site must be an https:// address with no # or ?.");
  return base.replace(/\/?$/, "/") + "#/promo/" + campaignId + "?k=" + encodeURIComponent(wif);
}

function requireCampaignId(value) {
  if (value === undefined || value === true) fail("Give the campaign id, for example: promo-end 3");
  const id = asWhole(String(value), "The campaign id");
  if (id < 1n) fail("Give the campaign id, for example: promo-end 3");
  return String(id);
}

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

// Testnet-only prices for `test-asset`, in base units of an 8-decimal token
// (100000000 = 1 token). Small on purpose. These are NOT launch prices.
const TEST_PRICES = {
  ITEM_READER_MONTH: "100000000",
  ITEM_WRITER_MONTH: "200000000",
  ITEM_PACK_S: "50000000",
  ITEM_PACK_M: "100000000",
  ITEM_PACK_L: "200000000",
  ITEM_OPEN_BOOK: "100000000",
  ITEM_OPEN_SHORT: "50000000",
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

/** Moderation reasons, as the Stories contract numbers them. */
const MODERATION_REASONS = { copyright: 1, duplicate: 2, spam: 3, illegal: 4, other: 5 };

function requireReason(value) {
  const key = String(value || "").toLowerCase();
  if (!MODERATION_REASONS[key]) fail("--reason must be one of: " + Object.keys(MODERATION_REASONS).join(", ") + ".");
  return MODERATION_REASONS[key];
}

const VERSION_KINDS = { 1: "original", 2: "changed", 3: "removed", 4: "edited by its writer", 5: "final edit" };
// Kinds made by someone other than the writer (a paid change, a paid removal, the final edit).
const CHANGE_KINDS = [2, 3, 5];

/**
 * Who a takedown may strike, from get_segment, get_versions and get_changers
 * (AB-028, AB-029, AB-033, AB-048). A part nobody else changed strikes its
 * writer automatically; the writer's own edits don't count as a change. Once
 * anyone else changed it, the contract refuses until the admin names the
 * writer or a wallet that changed it, or chooses no strike. `recorded` is the
 * contract's own list of changers (get_changers), citation-only ones included;
 * `changers` adds the ones the versions show. `candidates` is who the admin
 * may name: whoever last edited the text first (even the writer), then the
 * writer, then the other changers. If the part was changed but no changer can
 * be named, `unseen` is true and the candidates end with UNSEEN_CHANGER.
 */
const UNSEEN_CHANGER = "someone else changed this part that this tool can't name: look up the part's " +
  "stories.citation_event and stories.revise_event on a block explorer";

function takedownStrike(seg, versions, strike, noStrike, recorded) {
  if (strike && noStrike) fail("Use --strike or --no-strike, not both.");
  const writer = (seg && seg.author) || "";
  const changers = [];
  const add = (who) => { if (who && who !== writer && !changers.includes(who)) changers.push(who); };
  for (const who of recorded || []) add(who);
  for (const v of versions || []) if (CHANGE_KINDS.includes(Number(v.kind)) || (v.by && v.by !== writer && Number(v.kind) !== 1)) add(v.by);
  const lastEditedBy = (seg && seg.last_edited_by) || "";
  if (seg && seg.edited_by_others) add(lastEditedBy);
  const changed = !!(seg && seg.edited_by_others) || Number((seg && seg.paid_changes) || 0) > 0 || changers.length > 0;
  const unseen = changed && changers.length === 0;
  const candidates = [];
  for (const who of [lastEditedBy, writer, ...changers]) if (who && !candidates.includes(who)) candidates.push(who);
  if (unseen) candidates.push(UNSEEN_CHANGER);
  return { writer, changed, changers, lastEditedBy, candidates, unseen, needsChoice: changed && !strike && !noStrike };
}

/**
 * What the admin reviewed before a takedown: the part's text_hash and
 * version_count exactly as read and shown. The contract refuses the takedown
 * if either changed since, so the strike always matches the reviewed text.
 */
function takedownReview(seg) {
  if (!seg || !seg.author) fail("There is no such part.");
  if (seg.taken_down) fail("That part was already taken down. Nothing was sent.");
  if (typeof seg.text_hash !== "string" || seg.text_hash === "") fail("Could not read the part's text fingerprint (text_hash). Nothing was sent.");
  return { reviewed_hash: seg.text_hash, reviewed_versions: Number(seg.version_count || 0) };
}

// get_versions returns at most this many per call (AB-060), fewer when they
// are long (AB-070).
const VERSIONS_PER_READ = 5;

/**
 * Every kept version of a part, oldest first, read a few at a time (AB-060).
 * `page(from, count)` returns one get_versions result ({ values, next }) or
 * just its values. Each read goes on from the contract's next, or else right
 * after the last version returned, since a page stops early when its versions
 * are long (AB-070). A read that fails is tried once more for one version.
 */
async function readVersions(page, versionCount) {
  const total = Number(versionCount || 0);
  const byNumber = new Map();
  let from = 1;
  while (from <= total) {
    let res;
    try {
      res = await page(from, VERSIONS_PER_READ);
    } catch (e) {
      res = await page(from, 1);
    }
    const values = Array.isArray(res) ? res : (res && res.values) || [];
    let added = 0;
    let last = 0;
    for (const v of values) {
      last = Math.max(last, Number(v.version));
      if (!byNumber.has(Number(v.version))) {
        byNumber.set(Number(v.version), v);
        added++;
      }
    }
    if (!added) break;
    const next = Array.isArray(res) ? 0 : Number((res && res.next) || 0);
    from = next > from ? next : last + 1;
  }
  return [...byNumber.values()].sort((a, b) => Number(a.version) - Number(b.version));
}

/** readVersions' page reader for a Stories contract (a koilib Contract). */
function versionPage(storiesC, storyId, seq) {
  return async (from, count) => {
    const { result } = await storiesC.functions.get_versions({ story_id: String(storyId), seq: String(seq), from, count });
    return result || {};
  };
}

// get_segments returns at most 10 per call, fewer once their text passes
// about 64 KB (M-5); `next` says where the next page starts.
const SEGMENTS_PER_READ = 10;

/**
 * Every part of a story, by sequence number from 1, read a page at a time.
 * `page(start, limit)` returns one get_segments result ({ values, next }).
 * A read that fails is tried once more for one part. Stops with an error
 * if the parts read are not exactly `segmentCount`, so a book hash is never
 * computed from a partial read.
 */
async function readSegments(page, segmentCount) {
  const total = Number(segmentCount || 0);
  const out = [];
  let start = 1;
  while (start <= total) {
    let res;
    try {
      res = await page(start, SEGMENTS_PER_READ);
    } catch (e) {
      res = await page(start, 1);
    }
    const values = (res && res.values) || [];
    if (!values.length) fail("Could not read part " + start + " of the story. Nothing was sent.");
    out.push(...values);
    start += values.length;
    const next = Number((res && res.next) || 0);
    if (next && next !== start) fail("The node's page of parts does not line up (next " + next + ", expected " + start + "). Nothing was sent.");
  }
  if (out.length !== total) fail("Read " + out.length + " parts but the story has " + total + ". Nothing was sent.");
  return out;
}

/**
 * The finished book as plain text, exactly as the website hashes it at
 * finalize and on the book page (web/src/main.js bookText): the title, then
 * every live, unhidden part in reading order, with "Chapter n" headings,
 * joined by newlines. `readingOrder` is web/src/lib/order.js's, so both use
 * one rule. Its sha256 (UTF-8) is the book's pdf_hash.
 */
function bookText(story, segments, readingOrder) {
  const all = segments.map((segment, i) => ({ segment, index: i + 1, seq: i + 1, insertAfter: Number(segment.insert_after || 0) }));
  const ordered = readingOrder(all).filter((b) => Number(b.segment.status) !== 2 && !b.segment.hidden);
  const lines = [String(story.title || "Untitled")];
  let chapter = 0;
  for (const b of ordered) {
    if (!chapter || b.segment.starts_chapter) {
      chapter += 1;
      lines.push("", "Chapter " + chapter, "");
    }
    lines.push(String(b.segment.text || ""));
  }
  return { text: lines.join("\n"), parts: ordered.length, hidden: segments.filter((s) => Number(s.status) !== 2 && s.hidden).length };
}

/** replace-pdf may run only on a finalized story that a takedown left needing a new book hash. */
function requireNeedsNewPdf(story, storyId) {
  if (!story || !story.opener) fail("There is no story " + storyId + ".");
  if (Number(story.status) !== 4 || !story.needs_new_pdf) {
    fail("Story " + storyId + " does not need a new book hash (only a finished book that had a part taken down does). Nothing was sent.");
  }
}

/** A book link for replace_pdf / finalize: 1 to 200 plain characters. */
function requirePdfUri(uri) {
  const s = String(uri || "");
  if (!/^[\x21-\x7e]{1,200}$/.test(s)) fail("The book link must be 1 to 200 plain characters (--uri).");
  return s;
}

const HIDDEN_BY = { 1: "writer reports", 2: "the copy checker", 3: "the admin" };

/**
 * What `deploy.js hide` will do for a part (AB-061, AB-062), or fail before
 * any key is asked for. Hiding a part that is already hidden is the admin
 * taking over that hide in one transaction: it becomes an admin hide, so the
 * opener can't restore it and removing it refunds nothing. The moderator key
 * may take over a hide writer reports made, as the copy checker does for a
 * copy (AB-071). Only the admin unhides an admin hide.
 */
function hidePlan(seg, hidden, actor, admin) {
  if (!seg || !seg.author) fail("There is no such part.");
  if (Number(seg.status) !== 1) fail("That part was removed; nothing to hide or unhide.");
  const by = Number(seg.hidden_by || 0);
  if (seg.hidden && !HIDDEN_BY[by]) fail("That part is hidden but says nobody hid it (hidden_by " + by + "). Check the Stories ABI is current. Nothing was sent.");
  const who = HIDDEN_BY[by];
  if (!hidden) {
    if (!seg.hidden) fail("That part is not hidden. Nothing was sent.");
    if (by === 3 && actor !== admin) fail("The admin hid this part, so only the admin key can unhide it. Nothing was sent.");
    return "UNHIDE (hidden by " + who + ")";
  }
  if (!seg.hidden) return "HIDE";
  if (by === 3) fail("The admin already hid this part. Nothing was sent.");
  if (actor !== admin) {
    if (by === 1) {
      return "HIDE AS THE CHECKER (now hidden by writer reports; in one transaction it becomes the checker's hide: removing it " +
        "refunds nothing and restoring it gives up the refund)";
    }
    fail("That part is already hidden (by " + who + "). Only the admin key can take over a hide. Nothing was sent.");
  }
  return "HIDE AS THE ADMIN (now hidden by " + who + "; in one transaction it becomes an admin hide: the opener can't restore it " +
    "and removing it refunds nothing)";
}

/** A set-once address (AB-037, AB-050): empty on chain, or already exactly `wanted`. */
function requireSetOnce(what, onChain, wanted) {
  if (onChain && onChain !== wanted) {
    fail(what + " is already " + onChain + " and can never be changed (you gave " + wanted + "). Nothing was changed.\n" + SHOP_MOVE_HELP);
  }
}

const SHOP_MOVE_HELP =
  "Stories' Ink and Shop addresses and Shop's Ink and Stories addresses are set once and can never be changed " +
  "(AB-050, C1-07): they run inside users' own signed transactions. Moving to a new contract needs a reviewed code " +
  "upload with the contract key (docs/ADMIN_POWERS.md, docs/KEY_CUSTODY.md section 6), not wire.";

/**
 * One line per kept version of a part, oldest first, with the full text, for
 * the admin to compare (AB-033). With the part itself, a last line shows the
 * live text and who last edited it whenever it differs from the newest
 * version (or there is none).
 */
function versionHistory(versions, seg) {
  const when = (at) => Number(at || 0) ? new Date(Number(at) * 1000).toISOString().replace(".000Z", "Z") : "?";
  const lines = (versions || []).map((v) =>
    "  v" + v.version + " " + (VERSION_KINDS[Number(v.kind)] || "kind " + v.kind) + " by " + (v.by || v.author || "?") +
      " at " + when(v.at) + ": " + JSON.stringify(String(v.text || "")));
  if (seg) {
    const live = String(seg.text || "");
    const newest = versions && versions.length ? String(versions[versions.length - 1].text || "") : null;
    if (newest === null || newest !== live) {
      lines.push("  live text, last edited by " + (seg.last_edited_by || seg.author || "?") + " at " + when(seg.last_edited_at || seg.created_at) +
        ": " + JSON.stringify(live));
    }
  }
  return lines;
}

// ---------- command line ----------

// Switches: present or absent, never followed by a value (O1-10).
const BOOLEAN_FLAGS = [
  "i-understand-this-is-mainnet", "i-understand-this-replaces-mainnet-code",
  PIN_OVERRIDE_FLAG.slice(2), HASH_OVERRIDE_FLAG.slice(2),
  "upgrade", "disable", "private", "emoji", "not-opener", "unhide", "no-strike", "unblock",
];
const SECRET_FLAGS = ["key", "wif", "private-key", "privatekey", "secret", "seed", "mnemonic", "password", "link-key"];
const RETIRED_FLAGS = {
  "expect-sha256": "--expect-sha256 is gone: the reviewed release hashes are pinned in deploy/release-hashes.json, and upload checks the build against them.",
  "replace-stories": "--replace-stories is gone: Shop's Stories address is set once and can never be changed (C1-07).",
  "replace-shop": SHOP_MOVE_HELP,
};

/**
 * Parse argv (without node and script path) into
 * { command, target, rest, flags }. A switch (BOOLEAN_FLAGS) never takes a
 * value, so `--unhide x` is refused instead of read as "hide"; every other
 * flag needs one. Keys, retired flags, repeated flags and (given `known`)
 * flags no command uses are refused.
 */
function parseArgs(argv, known) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (SECRET_FLAGS.includes(name.toLowerCase())) {
      fail("Do not pass a key on the command line (--" + name + "). It would be saved in your terminal history. " +
        "Run the command without it and paste the key at the hidden prompt.");
    }
    if (RETIRED_FLAGS[name]) fail(RETIRED_FLAGS[name]);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || (known && !known.includes(name))) fail("--" + name + " is not a flag this tool knows. Nothing was done.");
    if (Object.prototype.hasOwnProperty.call(flags, name)) fail("--" + name + " is given twice. Give it once.");
    if (BOOLEAN_FLAGS.includes(name)) {
      const next = argv[i + 1];
      if (eq !== -1 || (next !== undefined && !next.startsWith("--"))) {
        fail("--" + name + " is a switch and takes no value" + (eq !== -1 ? "" : ", but '" + next + "' follows it") +
          ". Leave the value out (or move it before the switch). Nothing was done.");
      }
      flags[name] = true;
    } else if (eq !== -1) {
      flags[name] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) fail("--" + name + " needs a value. Nothing was done.");
      flags[name] = next;
      i++;
    }
  }
  return { command: positional[0], target: positional[1], rest: positional.slice(2), flags };
}

/**
 * Refuse flags the command does not use, and positional values it does not
 * take, so a typo or a stray word never changes what is sent.
 */
function checkCommandArgs(args, allowed, positionals) {
  for (const name of Object.keys(args.flags)) {
    if (!allowed.includes(name)) fail("'" + args.command + "' does not use --" + name + ". Nothing was done. Run help to see its flags.");
  }
  const extra = [args.target, ...args.rest].filter((v) => v !== undefined).slice(positionals || 0);
  if (extra.length) fail("Unexpected '" + extra[0] + "' on the command line. Nothing was done.");
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
  // The dry run hands a fully signed transaction to this node, and some
  // commands read addresses from it, so mainnet only uses listed nodes (AB-009).
  if (net.mainnet && !net.trustedRpcs.includes(rpc)) {
    fail("On mainnet, --rpc must be one of: " + net.trustedRpcs.join(", ") + ". A node you don't trust could send the signed dry run. Nothing was signed.");
  }
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

// ---------- pinned mainnet addresses and release hashes (M-6, O1-13) ----------

function checkPinnedTable(pinned) {
  for (const role of PINNED_ROLES) {
    if (typeof pinned[role] !== "string" || (pinned[role] !== "" && !isAddress(pinned[role]))) {
      fail("deploy/lib.js MAINNET_PINNED." + role + " must be \"\" or a Koinos address.");
    }
  }
}
checkPinnedTable(MAINNET_PINNED);

/**
 * On mainnet, `address` must be the pinned address for `role`. `uploading`
 * lets `upload` name a contract address that is not pinned yet. Returns a
 * warning line when the override flag let an unpinned address through.
 */
function checkPinned(net, role, address, flags, uploading) {
  if (!net.mainnet || address === undefined) return null;
  const pinned = net.pinned[role];
  if (pinned === address || (!pinned && uploading)) return null;
  const what = pinned ? "the pinned mainnet " + role + " address is " + pinned : "no mainnet " + role + " address is pinned in deploy/lib.js yet";
  if (flags[PIN_OVERRIDE_FLAG.slice(2)] === true) {
    return "WARNING: " + address + " is used as " + role + " although " + what + " (" + PIN_OVERRIDE_FLAG + ").";
  }
  fail("On mainnet, " + role + " must be the pinned address, but " + what + " and you gave " + address + ".\n" +
    "Nothing was done. If the address in deploy/lib.js (MAINNET_PINNED) is wrong or missing, fix it there (one line) and have it reviewed. " +
    "Only if you checked the address yourself, add " + PIN_OVERRIDE_FLAG + ".");
}

/** Every contract address the flags name, checked against the pinned table. `target` names the role of --contract/--expect. */
function checkPinnedFlags(net, flags, target) {
  const warnings = [];
  for (const role of PINNED_ROLES) warnings.push(checkPinned(net, role, flags[role], flags, false));
  for (const name of ["contract", "expect"]) {
    if (flags[name] === undefined || !net.mainnet) continue;
    if (!CONTRACT_ROLES.includes(target)) fail("Say which contract --" + name + " is: ink, shop or stories.");
    warnings.push(checkPinned(net, target, flags[name], flags, name === "expect"));
  }
  return warnings.filter(Boolean);
}

/** A key that controls a pinned MAINNET address is never used on testnet (one key per contract per network). */
function refuseCrossNetworkKey(net, address) {
  if (net.mainnet) return;
  for (const role of PINNED_ROLES) {
    if (NETWORKS.mainnet.pinned[role] && NETWORKS.mainnet.pinned[role] === address) {
      fail(address + " is the pinned MAINNET " + role + " address. Never use a mainnet contract key on testnet " +
        "(or a testnet key on mainnet): make a new wallet for each contract on each network. Nothing was signed.");
    }
  }
}

/** deploy/release-hashes.json: { ink, shop, stories } as "" (not pinned yet) or a lowercase sha256 hex. */
function parseReleaseHashes(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail("deploy/release-hashes.json is not valid JSON.");
  }
  const out = {};
  for (const key of Object.keys(data || {})) {
    if (key !== "about" && !CONTRACT_ROLES.includes(key)) fail("deploy/release-hashes.json has an unknown entry '" + key + "'.");
  }
  for (const role of CONTRACT_ROLES) {
    const v = data[role];
    if (typeof v !== "string" || (v !== "" && !/^[0-9a-f]{64}$/.test(v))) {
      fail("deploy/release-hashes.json: '" + role + "' must be \"\" or 64 lowercase hex characters.");
    }
    out[role] = v;
  }
  return out;
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * The wasm about to be uploaded against the release hash pinned in
 * deploy/release-hashes.json (AB-006, O1-13). Mainnet uploads only the
 * pinned release build. Testnet uploads anything and says whether it is the
 * release. No message prints a hash, so nothing invites pasting one in.
 * Returns true (the release), false (not it) or null (none pinned).
 */
function checkWasmHash(wasm, role, release, mainnet) {
  const want = release[role];
  if (mainnet && !want) {
    fail("No release hash is pinned for " + role + " in deploy/release-hashes.json. Mainnet uploads only the reviewed " +
      "release build: fill it in from the published release hashes (AUDIT_SCOPE.md), have it reviewed, and run this again. Nothing was sent.");
  }
  if (!want) return null;
  const matches = sha256Hex(wasm) === want;
  if (!matches && mainnet) {
    fail("This " + role + " build is NOT the reviewed release build pinned in deploy/release-hashes.json. Rebuild from " +
      "the release tag with the pinned toolchain (a debug, stale or changed build never matches). Do not edit the pinned " +
      "hash to make it match. Nothing was sent.");
  }
  return matches;
}

/** The code hash the chain returns (get_contract_metadata: "0x1220" + sha256 hex) as plain sha256 hex, or null. */
function codeHashFromMeta(meta) {
  const raw = meta && meta.value && meta.value.hash;
  const m = typeof raw === "string" && /^0x1220([0-9a-fA-F]{64})$/.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Before a wiring command (M-6): the code at `address` must be the release
 * build for `role`. On mainnet a mismatch always stops; a hash the node
 * would not give stops unless HASH_OVERRIDE_FLAG. Testnet only warns.
 * Returns a line to print, or null.
 */
function checkCodeHash(net, role, address, hashHex, release, flags) {
  const want = release[role];
  if (!net.mainnet) {
    if (!want) return null;
    if (!hashHex) return "Note: could not read the code hash of " + role + " at " + address + " (testnet: carrying on).";
    return hashHex === want ? null : "Note: " + role + " at " + address + " is not the pinned release build (fine on testnet).";
  }
  if (!want) {
    fail("No release hash is pinned for " + role + " in deploy/release-hashes.json, so the code at " + address +
      " can't be checked. Fill it in first. Nothing was sent.");
  }
  if (!hashHex) {
    const why = "The node did not return the code hash of " + role + " at " + address + " (chain get_contract_metadata through " +
      "invoke_system_call), so this tool can't confirm it runs the reviewed release build.";
    if (flags[HASH_OVERRIDE_FLAG.slice(2)] === true) return "WARNING: " + why + " Carrying on because of " + HASH_OVERRIDE_FLAG + ".";
    fail(why + "\nNothing was sent. Try again later, or check the hash on a block explorer and then add " + HASH_OVERRIDE_FLAG + ".");
  }
  if (hashHex !== want) {
    fail("The code at " + address + " is NOT the reviewed " + role + " release build pinned in deploy/release-hashes.json. " +
      "Do not wire it. Nothing was sent.");
  }
  return null;
}

// ---------- settings the admin commands send ----------

const DEFAULT_REPORT_THRESHOLD = 3;
const DEFAULT_STRIKE_LIMIT = 5;

/**
 * set_moderation arguments (O1-11). The threshold and strike limit stay as
 * they are on chain unless given (0 on chain is the contract's default, 3 and 5).
 */
function planModeration(flags, cfg) {
  if (!cfg) fail("Could not read Stories' settings. Nothing was sent.");
  const off = flags.moderator === "off";
  const moderator = off ? "" : requireAddress(flags.moderator, "moderator (or the word off)");
  const threshold = flags.threshold === undefined ? Number(cfg.report_threshold || DEFAULT_REPORT_THRESHOLD) : wholeInRange(flags.threshold, "--threshold", 1, 20);
  const strikes = flags.strikes === undefined ? Number(cfg.strike_limit || DEFAULT_STRIKE_LIMIT) : wholeInRange(flags.strikes, "--strikes", 1, 20);
  return { moderator, report_threshold: threshold, strike_limit: strikes };
}

// The largest per-submission cap (O1-12): the node's read limit (M-5) and the
// Stories contract both stop at 6,000.
const CONTRIBUTION_CAP_MAX = 6000;

/** set_limits arguments for stories-limits: given flags, else what the chain has. */
function planStoriesLimits(flags, cfg) {
  if (!cfg) fail("Could not read Stories' settings. Nothing was sent.");
  const pick = (flag, current, fallback, min, max) => {
    if (flags[flag] !== undefined) return wholeInRange(flags[flag], "--" + flag, min, max);
    const n = Number(current || fallback);
    if (n < min || n > max) fail("The chain's current value for --" + flag + " (" + n + ") is outside " + min + " to " + max + ". Give --" + flag + ".");
    return n;
  };
  return {
    contribution_cap: pick("cap", cfg.contribution_cap, CONTRIBUTION_CAP_MAX, 100, CONTRIBUTION_CAP_MAX),
    trial_limit: cfg.trial_limit || 0,
    open_limit: pick("open-limit", cfg.open_limit, 3, 1, 10),
    archive_days: cfg.archive_days || 60,
    inactivity_days: cfg.inactivity_days || 30,
    full_price_projects: pick("full-price", cfg.full_price_projects, 3, 1, 10),
    max_price_multiplier: pick("price-ceiling", cfg.max_price_multiplier, 4, 1, 1024),
  };
}

// A newly enabled payment token can be used only after this wait (C1-01).
const ASSET_WAIT_SECONDS = 7 * 86400;

function utcTime(sec) {
  return new Date(Number(sec) * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * What set-asset will do. After the Shop's first sale (`sold`), enabling starts
 * its 7-day wait; before it, a token works at once. An enabled
 * token's decimals and symbol can't change; turning a token off is at once.
 * Re-enabling an enabled token is refused, so the wait is never restarted
 * by mistake. Returns { args, summary }.
 */
function planAsset(current, wanted, nowSec, sold = true) {
  const cur = current || {};
  const token = requireAddress(wanted.token, "token");
  if (!wanted.enabled) {
    if (!cur.enabled) fail("That token is not enabled. Nothing to turn off.");
    return {
      args: { token, enabled: false, decimals: Number(cur.decimals || 0), symbol: String(cur.symbol || "") },
      summary: "turn OFF payment token " + (cur.symbol || "") + " (" + token + "), at once",
    };
  }
  const decimals = wholeInRange(wanted.decimals, "--decimals", 0, 18);
  const symbol = String(wanted.symbol || "");
  if (!/^[\x21-\x7e]{1,16}$/.test(symbol)) fail("--symbol must be 1 to 16 plain characters.");
  if (cur.enabled) {
    if (Number(cur.decimals) !== decimals || cur.symbol !== symbol) {
      fail("That token is enabled as " + cur.symbol + " with " + cur.decimals + " decimals; an enabled token's decimals and symbol " +
        "can't change. Turn it off (--disable) first; after the Shop's first sale, enabling it again starts a new 7-day wait. Nothing was sent.");
    }
    fail("That token is already enabled (usable from " + utcTime(cur.usable_from || 0) + "). Nothing to send.");
  }
  return {
    args: { token, enabled: true, decimals, symbol },
    summary: "ENABLE payment token " + symbol + " (" + token + ", " + decimals + " decimals). " + (sold
      ? "The Shop has made sales, so everyone waits 7 days: it can be used from about " + utcTime(nowSec + ASSET_WAIT_SECONDS) +
        " (the exact time is set when the transaction is in a block)"
      : "The Shop has made no sale yet, so it can be used at once"),
  };
}

/** A purchase needs the token enabled and past its wait (7 days when enabled after the first sale). */
function requireUsableAsset(asset, nowSec, token) {
  if (!asset || !asset.enabled) fail("The Shop does not accept " + token + ". Run test-asset (testnet) or set-asset first.");
  if (Number(asset.usable_from || 0) > nowSec) {
    fail("The Shop accepts " + token + " only from " + utcTime(asset.usable_from) + " (the 7-day wait after enabling a token once the Shop has made sales). Nothing was sent.");
  }
}

/**
 * min_ink for buy_membership (M-2): Writer is the Ink per month the buyer
 * will get (their locked amount while a Writer term runs, else the catalog);
 * Reader is 0.
 */
function membershipMinInk(tier, membership, cfg, nowSec) {
  if (tier !== TIER_WRITER) return "0";
  const m = membership || {};
  if (Number(m.tier) === TIER_WRITER && Number(m.paid_until || 0) > nowSec && BigInt(m.ink_per_month || 0) > 0n) return String(m.ink_per_month);
  if (!cfg || !BigInt(cfg.writer_ink || 0)) fail("Could not read the Shop's Writer Ink amount. Nothing was sent.");
  return String(cfg.writer_ink);
}

/** WIF and link-key output only ever goes to a terminal, never into a file or pipe (O1-14). */
function requireTerminal(isTTY, what) {
  if (!isTTY) {
    fail(what + " prints a secret key, so it only runs in a terminal.\n" +
      "Run it again without redirecting or piping its output (no > file, no | tee).");
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

/** A mana amount typed as KOIN-style decimals ("5", "0.25") in rc. */
function parseMana(value, label) {
  const m = /^([0-9]{1,9})(?:\.([0-9]{1,8}))?$/.exec(String(value));
  if (!m) fail(label + " must be an amount of mana like 5 or 0.25.");
  const rc = BigInt(m[1]) * 100000000n + BigInt((m[2] || "").padEnd(8, "0") || "0");
  if (rc < 1n) fail(label + " must be more than 0.");
  return rc.toString();
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

const MAINNET_UPGRADE_FLAG = "--i-understand-this-replaces-mainnet-code";

/**
 * Whether `upload` may go ahead when the address already holds a contract.
 * Replacing code keeps the stored data. Testnet needs --upgrade. Mainnet
 * needs --upgrade and MAINNET_UPGRADE_FLAG too (on top of the pinned release
 * hash and --i-understand-this-is-mainnet): it is the recovery path in
 * KEY_CUSTODY.md section 6 and the way to apply a reviewed contract fix after
 * launch (AB-041).
 */
function checkUpgrade(exists, flags, mainnet, address) {
  if (!exists) return false;
  if (flags.upgrade !== true) {
    fail(address + " already has a contract on this network. Add --upgrade to replace its code (its stored data is kept)" +
      (mainnet ? ", and " + MAINNET_UPGRADE_FLAG + ": see docs/KEY_CUSTODY.md section 6 first." : "."));
  }
  if (mainnet && flags[MAINNET_UPGRADE_FLAG.slice(2)] !== true) {
    fail("Replacing MAINNET code also needs " + MAINNET_UPGRADE_FLAG + ". Follow docs/KEY_CUSTODY.md section 6. Nothing was sent.");
  }
  return true;
}

/** Stop a testnet-only command on mainnet. */
function requireTestnet(net, command) {
  if (net.mainnet) fail(command + " is for testnet only.");
}

/** A new link key: 32 bytes from the operating system's secure random source (AB-013). */
function newLinkKeyHex() {
  return crypto.randomBytes(32).toString("hex");
}

/** Read the user's single-line answer and decide if it confirms. */
function isConfirmation(answer, word) {
  return String(answer || "").trim() === (word || "SEND");
}

// ---------- multisig: prepared, unsigned transactions (M-12) ----------

const PREPARED_FORMAT = "swarmtales-prepared-transaction/1";
const PREPARED_HEADER_KEYS = ["chain_id", "rc_limit", "nonce", "operation_merkle_root", "payer", "payee"];
const PREPARED_MAX_OPS = 64;
// Mana limit for a prepared transaction unless --rc-limit is given (never above what the payer has).
const DEFAULT_PREPARED_RC = "500000000";

/** A nonce as the chain encodes it (koinos.chain.value_type, uint64_value = field 7), base64url. */
function nonceNumber(nonceB64) {
  const b = Buffer.from(String(nonceB64 || ""), "base64url");
  if (b.length < 2 || b[0] !== 0x38) fail("The transaction's nonce is not in the expected format.");
  let n = 0n;
  let shift = 0n;
  for (let i = 1; i < b.length; i++) {
    n |= BigInt(b[i] & 0x7f) << shift;
    shift += 7n;
    if (!(b[i] & 0x80)) {
      if (i !== b.length - 1) fail("The transaction's nonce is not in the expected format.");
      return n.toString();
    }
  }
  fail("The transaction's nonce is not in the expected format.");
}

/**
 * The JSON file `--prepare` writes and `cosign` / `submit` read: the unsigned
 * (or partly signed) transaction, plus what each operation is meant to be
 * (contract name, address, method, arguments) so every signer's tool can
 * decode the bytes and refuse anything that differs. No key is ever in it.
 */
function preparedFile(net, tx, described, command) {
  return {
    format: PREPARED_FORMAT,
    network: net.key,
    chain_id: net.chainId,
    command,
    prepared_at: new Date().toISOString(),
    operations: described,
    transaction: { id: tx.id, header: tx.header, operations: tx.operations, signatures: tx.signatures || [] },
  };
}

/**
 * Check a prepared transaction file before anyone signs or sends it, with
 * the signer's own ABIs and pinned addresses (never the file's word):
 * the network and chain id, that the id is the hash of the header and the
 * header commits to exactly these operations, that every operation is a
 * call to Ink, Shop or Stories (pinned on mainnet) whose entry point and
 * argument bytes are exactly the described method and arguments. Returns
 * { tx, ops: [{ contract, contractId, method, description, args }] } with
 * the arguments decoded from the bytes, for the summary.
 * `deps` is { koilib, abiFor(contract), flags }.
 */
async function verifyPrepared(file, net, deps) {
  const { Transaction, Contract } = deps.koilib;
  if (!file || file.format !== PREPARED_FORMAT) fail("That is not a SwarmTales prepared transaction file.");
  if (file.network !== net.key) {
    fail("That file is for " + file.network + ", but this run is on " + net.key + ". Use --network " + file.network +
      (file.network === "mainnet" ? " " + MAINNET_FLAG : "") + ". Nothing was signed.");
  }
  const tx = file.transaction || {};
  const header = tx.header || {};
  if (file.chain_id !== net.chainId || header.chain_id !== net.chainId) fail("The file's chain id is not " + net.name + "'s. Nothing was signed.");
  for (const key of Object.keys(header)) if (!PREPARED_HEADER_KEYS.includes(key)) fail("The transaction header has an unexpected field '" + key + "'. Nothing was signed.");
  for (const key of Object.keys(tx)) if (!["id", "header", "operations", "signatures"].includes(key)) fail("The transaction has an unexpected field '" + key + "'. Nothing was signed.");
  if (!/^[1-9][0-9]*$/.test(String(header.rc_limit || ""))) fail("The transaction's mana limit (rc_limit) is missing.");
  nonceNumber(header.nonce);
  requireAddress(header.payer, "payer");
  if (header.payee !== undefined) requireAddress(header.payee, "payee");
  const sigs = tx.signatures || [];
  if (!Array.isArray(sigs) || sigs.some((s) => typeof s !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(s))) fail("The file's signatures are not in the expected format.");
  const ops = tx.operations;
  const described = file.operations;
  if (!Array.isArray(ops) || !Array.isArray(described) || !ops.length || ops.length !== described.length || ops.length > PREPARED_MAX_OPS) {
    fail("The file's operations don't match its description. Nothing was signed.");
  }
  // The id must be the hash of this header, and the header must commit to these operations.
  const again = { header: Object.assign({}, header), operations: ops };
  delete again.header.operation_merkle_root;
  await Transaction.prepareTransaction(again);
  if (again.header.operation_merkle_root !== header.operation_merkle_root || again.id !== tx.id) {
    fail("The transaction id or its operation fingerprint does not match the operations in the file. It was changed. Nothing was signed.");
  }
  const out = [];
  const warnings = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const d = described[i] || {};
    const call = op && op.call_contract;
    if (!call || Object.keys(op).length !== 1) fail("Operation " + (i + 1) + " is not a contract call. This tool only signs calls to Ink, Shop and Stories.");
    if (!CONTRACT_ROLES.includes(d.contract)) fail("Operation " + (i + 1) + " is not a call to Ink, Shop or Stories.");
    if (call.contract_id !== d.contract_id) fail("Operation " + (i + 1) + " calls " + call.contract_id + " but says " + d.contract_id + ". Nothing was signed.");
    const warn = checkPinned(net, d.contract, call.contract_id, deps.flags || {}, false);
    if (warn) warnings.push(warn);
    const abi = deps.abiFor(d.contract);
    const method = abi.methods[d.method];
    if (!method || method.read_only) fail("Operation " + (i + 1) + ": " + d.contract + " has no write method '" + d.method + "'.");
    if (call.entry_point !== method.entry_point) fail("Operation " + (i + 1) + " calls a different entry point than " + d.contract + "." + d.method + ". Nothing was signed.");
    const c = new Contract({ id: call.contract_id, abi });
    const expected = await c.encodeOperation({ name: d.method, args: d.args || {} });
    if (expected.call_contract.args !== call.args) fail("Operation " + (i + 1) + "'s arguments are not the ones it describes. Nothing was signed.");
    const decoded = await c.decodeOperation(op);
    if (decoded.name !== d.method) fail("Operation " + (i + 1) + " decodes as " + decoded.name + ", not " + d.method + ". Nothing was signed.");
    out.push({ contract: d.contract, contractId: call.contract_id, method: d.method, description: method.description || "", args: decoded.args || {} });
  }
  return { tx, ops: out, warnings };
}

/** The human summary every signer reads before signing, and `submit` shows before sending. */
function preparedSummary(net, file, checked, signedBy) {
  const h = checked.tx.header;
  const lines = [
    "Network:   " + net.name + " (chain id checked)",
    "Prepared:  " + (file.prepared_at || "?") + " by the '" + (file.command || "?") + "' command",
    "Payer:     " + h.payer + "  (pays the mana)" + (h.payee ? "\nPayee:     " + h.payee + "  (its nonce is used)" : ""),
    "Nonce:     " + nonceNumber(h.nonce) + "  (of " + (h.payee || h.payer) + "; only one transaction can use it)",
    "Mana limit:" + " " + formatMana(h.rc_limit),
    "Transaction id: " + checked.tx.id,
    "Operations (decoded from the bytes with this computer's own ABIs):",
  ];
  checked.ops.forEach((o, i) => {
    lines.push("  " + (i + 1) + ". " + o.contract + " " + o.contractId + " ." + o.method + (o.description ? "  (" + o.description + ")" : ""));
    lines.push("     " + JSON.stringify(o.args));
  });
  lines.push("Signatures so far: " + (signedBy.length ? signedBy.join(", ") : "none"));
  return lines;
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
  MAINNET_PINNED,
  PIN_OVERRIDE_FLAG,
  HASH_OVERRIDE_FLAG,
  MAINNET_FLAG,
  MAINNET_UPGRADE_FLAG,
  checkUpgrade,
  SECRET_ENV,
  SHOP_MINT_MASK,
  DEFAULT_INK_AMOUNTS,
  TEST_PRICES,
  SHOP_ITEMS,
  TIER_READER,
  TIER_WRITER,
  TEST_PROMO,
  DEFAULT_SITE,
  parsePromoDate,
  planPromoCampaign,
  promoShareLink,
  requireCampaignId,
  classifyRejection,
  UserError,
  fail,
  isAddress,
  requireAddress,
  wholeInRange,
  parseArgs,
  checkCommandArgs,
  BOOLEAN_FLAGS,
  MODERATION_REASONS,
  requireReason,
  takedownStrike,
  takedownReview,
  UNSEEN_CHANGER,
  requireSetOnce,
  SHOP_MOVE_HELP,
  versionHistory,
  VERSIONS_PER_READ,
  readVersions,
  versionPage,
  readSegments,
  bookText,
  requireNeedsNewPdf,
  requirePdfUri,
  hidePlan,
  resolveNetwork,
  checkChainId,
  checkPinned,
  checkPinnedFlags,
  refuseCrossNetworkKey,
  parseReleaseHashes,
  sha256Hex,
  checkWasmHash,
  codeHashFromMeta,
  checkCodeHash,
  planModeration,
  CONTRIBUTION_CAP_MAX,
  planStoriesLimits,
  ASSET_WAIT_SECONDS,
  utcTime,
  planAsset,
  requireUsableAsset,
  membershipMinInk,
  requireTerminal,
  classifySecret,
  checkSignerAddress,
  formatMana,
  parseMana,
  rcLimitFor,
  isConfirmation,
  requireTestnet,
  newLinkKeyHex,
  toKoilibAbi,
  PREPARED_FORMAT,
  DEFAULT_PREPARED_RC,
  nonceNumber,
  preparedFile,
  verifyPrepared,
  preparedSummary,
  PROMO_DOMAIN,
  INVITE_DOMAIN,
  promoMessage,
  inviteMessage,
  sha256,
};
