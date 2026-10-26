/**
 * Admin page helpers. Pure: each plan* function checks its inputs the way
 * the contract will, and returns the call to make:
 *   { contract: "ink"|"shop"|"stories"|"sponsor", method, args, summary }
 * The page then signs it with the connected wallet, or writes a prepared
 * transaction file for the multisig signers (the same file format as
 * `node deploy/deploy.js ... --prepare`, so `cosign` and `submit` take it).
 */
import { asWhole, formatUnits } from "./money.js";

export const PREPARED_FORMAT = "swarmtales-prepared-transaction/1";
/** Mana limit of a prepared transaction (1 mana, as the deploy tool; admin calls use under 0.1). */
export const DEFAULT_PREPARED_RC = "100000000";

/** Shop items, by their shop.proto numbers (8 and 9 are retired). */
export const SHOP_ITEMS = [
  { id: 1, name: "Reader month" },
  { id: 2, name: "Writer month" },
  { id: 3, name: "Ink pack, small" },
  { id: 4, name: "Ink pack, medium" },
  { id: 5, name: "Ink pack, large" },
  { id: 6, name: "Open a book" },
  { id: 7, name: "Open a short story" },
  { id: 10, name: "Open a poem" },
];

export const REASONS = [
  { id: 1, name: "Copyright (copied from someone else's work)" },
  { id: 2, name: "Duplicate (already on SwarmTales)" },
  { id: 3, name: "Spam" },
  { id: 4, name: "Illegal or abusive" },
  { id: 5, name: "Other" },
];

const ADDRESS_RE = /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const MAX_NOTE = 200;
const DAY = 86400;

export class AdminInputError extends Error {}
function fail(message) {
  throw new AdminInputError(message);
}

/**
 * The largest uint64, the widest number type the contracts take. A larger
 * value would be encoded wrapped around, so the wallet would sign a different
 * amount from the one shown (audit M-C).
 */
export const U64_MAX = 18446744073709551615n;

function requireUint64(n, label) {
  if (n > U64_MAX) fail(label + " is too large: the contracts take at most " + U64_MAX + " (in base units).");
  return n;
}

/**
 * The first number in `sent` (an operation's arguments) that the encoded
 * operation, decoded back as `decoded`, does not carry exactly: a value that
 * wrapped around or was cut to fit its field (audit M-C). null when all match.
 */
export function numberMismatch(sent, decoded, at) {
  const here = at || "arguments";
  if (Array.isArray(sent)) {
    for (let i = 0; i < sent.length; i++) {
      const m = numberMismatch(sent[i], Array.isArray(decoded) ? decoded[i] : undefined, here + "[" + i + "]");
      if (m) return m;
    }
    return null;
  }
  if (sent && typeof sent === "object") {
    for (const k of Object.keys(sent)) {
      const m = numberMismatch(sent[k], decoded && typeof decoded === "object" ? decoded[k] : undefined, at ? here + "." + k : k);
      if (m) return m;
    }
    return null;
  }
  const isNum = typeof sent === "bigint" || typeof sent === "number" || (typeof sent === "string" && /^-?[0-9]+$/.test(sent));
  if (!isNum) return null;
  let got;
  try {
    got = BigInt(decoded === undefined || decoded === null ? 0 : decoded);
  } catch {
    return { field: here, sent: String(sent), got: String(decoded) };
  }
  return BigInt(sent) === got ? null : { field: here, sent: String(sent), got: got.toString() };
}

export function requireAddress(value, label) {
  const v = String(value || "").trim();
  if (!ADDRESS_RE.test(v)) fail(label + " must be a Koinos address (starts with 1).");
  return v;
}

function whole(value, label, min, max) {
  let n;
  try {
    n = asWhole(String(value == null ? "" : value).trim().replace(/,/g, ""), label);
  } catch {
    fail(label + " must be a whole number.");
  }
  if (min != null && n < BigInt(min)) fail(label + " must be at least " + min + ".");
  if (max != null && n > BigInt(max)) fail(label + " must be at most " + max + ".");
  return requireUint64(n, label);
}

function note(text, label) {
  const t = String(text || "").trim();
  if (t.length > MAX_NOTE) fail((label || "The note") + " can be at most 200 characters.");
  return t;
}

/** "1.5" of a token with `decimals` decimals, in base units (a string). */
export function toBaseUnits(text, decimals, label) {
  const t = String(text == null ? "" : text).trim();
  const m = /^([0-9]{1,15})(?:\.([0-9]+))?$/.exec(t);
  if (!m) fail((label || "The amount") + " must be a number like 2 or 0.5.");
  const frac = m[2] || "";
  if (frac.length > decimals) fail((label || "The amount") + " has more than " + decimals + " decimals.");
  const n = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return requireUint64(n, label || "The amount").toString();
}

export function fromBaseUnits(base, decimals) {
  return formatUnits(base || "0", decimals);
}

function call(contract, method, args, summary) {
  return { contract, method, args, summary };
}

// ---------------------------------------------------------------- pause

export function planPause(contract, paused) {
  if (!["ink", "shop", "stories"].includes(contract)) fail("Pick Ink, Shop or Stories.");
  return call(contract, "set_paused", { paused: !!paused }, (paused ? "PAUSE " : "Unpause ") + contract);
}

// ---------------------------------------------------------------- promo

/**
 * A shared promo link: every wallet may claim `inkPerClaim` once, for `days`
 * days from now, until `budget` Ink is given out (and at most `dailyCap` a
 * day; 0 = no daily cap).
 */
export function planPromo({ inkPerClaim, days, budget, dailyCap, nowSec, linkSigner }) {
  const amount = whole(inkPerClaim, "Ink per claim", 1, 1000000);
  const d = whole(days, "Days the link works", 1, 365);
  const total = whole(budget, "Total Ink budget", 1, null);
  if (total < amount) fail("The total budget must cover at least one claim (" + amount + " Ink).");
  const cap = dailyCap == null || String(dailyCap).trim() === "" ? 0n : whole(dailyCap, "Daily cap", 0, null);
  if (cap !== 0n && cap < amount) fail("The daily cap must be 0 (no cap) or at least one claim (" + amount + " Ink).");
  const start = BigInt(Math.floor(Number(nowSec)));
  const end = start + d * BigInt(DAY);
  const args = {
    link_signer: requireAddress(linkSigner, "The link key"),
    amount: amount.toString(),
    budget_total: total.toString(),
    daily_cap: cap.toString(),
    starts_at: start.toString(),
    ends_at: end.toString(),
    single_use: false,
    enabled: true,
  };
  return call("shop", "create_campaign", args,
    "New promo link: " + amount + " Ink per wallet (once each), for " + d + " day" + (d === 1n ? "" : "s") +
      ", up to " + total + " Ink in total" + (cap ? ", at most " + cap + " Ink a day" : ""));
}

/** The share link for a shared campaign. It holds the link key: show it once. */
export function promoLink(siteBase, campaignId, wif) {
  const base = String(siteBase || "");
  if (!/^https?:\/\/[^\s#?]+$/.test(base)) fail("The site address must be http(s) with no # or ?.");
  return base.replace(/\/?$/, "/") + "#/promo/" + campaignId + "?k=" + encodeURIComponent(wif);
}

export function planCampaignEnabled(campaignId, enabled) {
  const id = whole(campaignId, "Campaign id", 1, null);
  return call("shop", "set_campaign_enabled", { campaign_id: id.toString(), enabled: !!enabled },
    (enabled ? "Turn ON" : "Turn OFF") + " promo campaign " + id);
}

export function planCampaignLimits({ campaignId, budget, dailyCap, endsAt }) {
  const id = whole(campaignId, "Campaign id", 1, null);
  return call("shop", "set_campaign_limits", {
    campaign_id: id.toString(),
    budget_total: whole(budget, "Total Ink budget", 1, null).toString(),
    daily_cap: whole(dailyCap || "0", "Daily cap", 0, null).toString(),
    ends_at: whole(endsAt, "End time", 1, null).toString(),
  }, "Change promo campaign " + id + "'s budget, daily cap or end");
}

export function planPromoSwitch(on) {
  return call("shop", "set_promo_enabled", { enabled: !!on }, "Promos " + (on ? "ON" : "OFF") + " for everyone");
}

// ---------------------------------------------------------------- shop

export function planPrice(itemId, token, amountText, decimals, symbol) {
  const item = SHOP_ITEMS.find((i) => i.id === Number(itemId));
  if (!item) fail("Unknown item.");
  const amount = toBaseUnits(amountText, decimals, item.name + " price");
  return call("shop", "set_price", { item: item.id, token: requireAddress(token, "Token"), amount },
    item.name + " price: " + (amount === "0" ? "removed (not for sale)" : fromBaseUnits(amount, decimals) + " " + (symbol || "")));
}

export const INK_AMOUNT_FIELDS = [
  { key: "writer_month", cfg: "writer_ink", name: "Writer month" },
  { key: "pack_s", cfg: "pack_s_ink", name: "Small pack" },
  { key: "pack_m", cfg: "pack_m_ink", name: "Medium pack" },
  { key: "pack_l", cfg: "pack_l_ink", name: "Large pack" },
  { key: "starter_book", cfg: "starter_book", name: "Starter Ink, book" },
  { key: "starter_short", cfg: "starter_short", name: "Starter Ink, short story" },
  { key: "starter_poem", cfg: "starter_poem", name: "Starter Ink, poem" },
];

export function planInkAmounts(values) {
  const args = {};
  for (const f of INK_AMOUNT_FIELDS) args[f.key] = whole(values[f.key], f.name, 0, 100000000).toString();
  return call("shop", "set_ink_amounts", args, "Ink amounts: " + INK_AMOUNT_FIELDS.map((f) => f.name + " " + args[f.key]).join(", "));
}

export function planFee(bps) {
  const n = whole(bps, "Founder fee (basis points)", 0, 500);
  return call("shop", "set_fee_bps", { fee_bps: Number(n) }, "Founder fee: " + (Number(n) / 100) + "%");
}

/**
 * Turn a payment token on or off. Turning one on needs its pin from config.js
 * PAYMENT_TOKENS (`pin`) and its code hash read from the chain (`codeHash`):
 * the code must be the pinned code, and the symbol and decimals the pinned
 * ones (audit H-3). `others` are the Shop's other tokens, { address, symbol }:
 * no two may share a symbol (audit I-2).
 */
export function planAsset({ token, enabled, decimals, symbol, pin, codeHash, others }) {
  const t = requireAddress(token, "Token");
  if (!enabled) return call("shop", "set_asset", { token: t, enabled: false, decimals: 0, symbol: "" }, "Turn OFF payment token " + t);
  const d = whole(decimals, "Decimals", 0, 18);
  const s = String(symbol || "").trim();
  if (!/^[A-Za-z0-9]{1,16}$/.test(s)) fail("The symbol must be 1 to 16 letters or digits.");
  if (!pin) fail("This token is not pinned in web/src/config.js PAYMENT_TOKENS (and deploy/lib.js TOKEN_PINS). Review its code and pin it, with its code hash, first.");
  if (!codeHash) fail("There is no token contract at " + t + ", or the node would not give its code hash.");
  if (codeHash !== pin.codeHash) fail("The code at " + t + " is not the pinned code (its issuer changed it). Review the new code and update the pin first.");
  if (s !== pin.symbol || Number(d) !== pin.decimals) fail("This token is pinned as " + pin.symbol + " with " + pin.decimals + " decimals.");
  const clash = (others || []).find((o) => o.address !== t && String(o.symbol || "").toLowerCase() === s.toLowerCase());
  if (clash) fail("The Shop already has a token called " + clash.symbol + " (" + clash.address + "). Use another symbol.");
  return call("shop", "set_asset", { token: t, enabled: true, decimals: Number(d), symbol: s },
    "Turn ON payment token " + s + " (" + t + ", " + d + " decimals). After the Shop's first sale, a newly enabled token waits 7 days.");
}

/**
 * A price from an Ink rate: `ink` Ink at `rate` Ink per 1 token, in the
 * token's base units, rounded up (the buyer never gets Ink for less than
 * the rate). Returns a string.
 */
export function ratePrice(ink, rate, decimals) {
  const m = /^([0-9]{1,12})(?:\.([0-9]{1,8}))?$/.exec(String(rate == null ? "" : rate).trim());
  if (!m) fail("The rate must be the Ink one token buys, like 100 or 2.5.");
  const k = (m[2] || "").length;
  const r = BigInt(m[1] + (m[2] || ""));
  if (r === 0n) fail("The rate must be more than 0.");
  const scale = 10n ** BigInt(decimals) * 10n ** BigInt(k);
  const n = BigInt(ink || 0);
  return requireUint64((n * scale + r - 1n) / r, "The price from this rate").toString();
}

/** The items priced from the Ink they bring, and where the Shop keeps that Ink. */
export const RATE_ITEMS = [
  { id: 2, cfg: "writer_ink" },
  { id: 3, cfg: "pack_s_ink" },
  { id: 4, cfg: "pack_m_ink" },
  { id: 5, cfg: "pack_l_ink" },
];

/**
 * Add a payment token: turn it on, then set its prices, in one transaction.
 * `prices` maps item id to a price in whole tokens ("" = not for sale).
 */
export function planAddToken({ token, symbol, decimals, prices, pin, codeHash, others }) {
  const plans = [planAsset({ token, enabled: true, decimals, symbol, pin, codeHash, others })];
  const d = Number(decimals);
  for (const item of SHOP_ITEMS) {
    const v = prices && prices[item.id] != null ? String(prices[item.id]).trim() : "";
    if (v === "") continue;
    plans.push(planPrice(item.id, token, v, d, symbol));
  }
  if (plans.length === 1) fail("Give at least one price, or an Ink rate for the Writer month and packs.");
  return plans;
}

// ---------------------------------------------------------------- moderation

export function planHide({ actor, storyId, seq, hidden, reason, noteText }) {
  const id = whole(storyId, "Story id", 1, null);
  const s = whole(seq, "Part number", 1, null);
  const r = hidden ? Number(whole(reason, "Reason", 1, 5)) : 0;
  return call("stories", "set_segment_hidden", {
    actor: requireAddress(actor, "Your admin address"), story_id: id.toString(), seq: s.toString(),
    hidden: !!hidden, reason: r, note: note(noteText),
  }, (hidden ? "HIDE" : "Unhide") + " story " + id + " part " + s);
}

/**
 * Who a takedown may strike: the writer, or a wallet that changed the part.
 * `seg` is get_segment, `changers` get_changers' values.
 */
export function strikeChoices(seg, changers) {
  const writer = (seg && seg.author) || "";
  const out = [];
  for (const who of [writer, (seg && seg.last_edited_by) || "", ...(changers || [])]) {
    if (who && !out.includes(who)) out.push(who);
  }
  const changed = out.length > 1 || !!(seg && seg.edited_by_others) || Number((seg && seg.paid_changes) || 0) > 0;
  return { writer, candidates: out, changed };
}

/**
 * A permanent takedown, bound to the text the admin just read (text_hash and
 * version_count): if the part changes first, the contract refuses it.
 * strikeMode: "wallet" (strike `strike`) or "none".
 */
export function planTakedown({ seg, storyId, seq, reason, noteText, strikeMode, strike, changers }) {
  if (!seg || !seg.author) fail("There is no such part.");
  if (seg.taken_down) fail("That part was already taken down.");
  if (typeof seg.text_hash !== "string" || !seg.text_hash) fail("Could not read the part's text fingerprint. Reload it.");
  const id = whole(storyId, "Story id", 1, null);
  const s = whole(seq, "Part number", 1, null);
  const r = Number(whole(reason, "Reason", 1, 5));
  const n = note(noteText, "The note (e.g. the notice reference)");
  if (!n) fail("Add a note, for example the copyright notice reference.");
  const choices = strikeChoices(seg, changers);
  const args = {
    story_id: id.toString(), seq: s.toString(), reason: r, note: n,
    reviewed_hash: seg.text_hash, reviewed_versions: Number(seg.version_count || 0),
  };
  let who = "no one";
  if (strikeMode === "none") {
    args.no_strike = true;
  } else {
    const target = requireAddress(strike, "The wallet to strike");
    if (!choices.candidates.includes(target)) fail("Only the writer or a wallet that changed this part can get the strike.");
    args.strike = target;
    who = target === choices.writer ? "the writer " + target : target;
  }
  return call("stories", "takedown_segment", args,
    "TAKE DOWN story " + id + " part " + s + " for good (no Ink refund); strike " + who);
}

export function planBlock({ account, blocked, noteText }) {
  const a = requireAddress(account, "Wallet");
  return call("stories", "set_blocked", { account: a, blocked: !!blocked, note: note(noteText) },
    (blocked ? "BLOCK " : "Unblock ") + a);
}

export function planSourceNote({ actor, storyId, seq, noteText }) {
  const id = whole(storyId, "Story id", 1, null);
  const s = whole(seq, "Part number", 1, null);
  return call("stories", "set_source_note", { actor: requireAddress(actor, "Your admin address"), story_id: id.toString(), seq: s.toString(), note: note(noteText) },
    "Source note on story " + id + " part " + s + (note(noteText) ? "" : " (cleared)"));
}

export function planClearSummary({ actor, storyId }) {
  const id = whole(storyId, "Story id", 1, null);
  return call("stories", "set_story_summary", { account: requireAddress(actor, "Your admin address"), story_id: id.toString(), summary: "" },
    "Clear story " + id + "'s summary");
}

export function planTakeOver(storyId) {
  const id = whole(storyId, "Story id", 1, null);
  return call("stories", "admin_take_over", { story_id: id.toString() }, "Take over story " + id + "'s final edit");
}

// ---------------------------------------------------------------- stories settings

export function planLimits(v) {
  const args = {
    contribution_cap: Number(whole(v.contribution_cap, "Per-part cap", 100, 6000)),
    trial_limit: Number(whole(v.trial_limit, "Promo trial limit", 0, 5000)),
    open_limit: Number(whole(v.open_limit, "Open projects per wallet", 1, 10)),
    archive_days: Number(whole(v.archive_days, "Archive after (days)", 30, 365)),
    inactivity_days: Number(whole(v.inactivity_days, "Admin may finalize after (days)", 30, 365)),
    full_price_projects: Number(whole(v.full_price_projects, "Projects at the normal price", 1, 10)),
    max_price_multiplier: Number(whole(v.max_price_multiplier, "Price ceiling (times)", 1, 1024)),
  };
  return call("stories", "set_limits", args, "Stories limits: " + JSON.stringify(args));
}

export function planMinContribution(n) {
  const v = Number(whole(n, "Shortest new text", 1, 200));
  return call("stories", "set_min_contribution", { min_contribution: v }, "Shortest new text: " + v + " characters");
}

export function planModeration({ moderator, threshold, strikes }) {
  const m = String(moderator || "").trim();
  const mod = m === "" || m.toLowerCase() === "off" ? "" : requireAddress(m, "Moderator");
  const args = {
    moderator: mod,
    report_threshold: Number(whole(threshold, "Reports that hide a part", 1, 20)),
    strike_limit: Number(whole(strikes, "Takedowns before a block", 1, 20)),
  };
  return call("stories", "set_moderation", args,
    "Moderator " + (mod || "OFF") + "; " + args.report_threshold + " reports hide a part; " + args.strike_limit + " takedowns block a wallet");
}

/** `hashB64` is the base64url sha256 of the exact Terms text. */
export function planTerms({ version, hashB64, uri, current }) {
  const v = Number(whole(version, "Version", 1, 4294967295));
  if (current != null && v <= Number(current)) fail("The new version must be higher than the current one (" + current + ").");
  const u = String(uri || "").trim();
  if (!/^[\x21-\x7e]{1,200}$/.test(u)) fail("The link must be 1 to 200 plain characters.");
  if (typeof hashB64 !== "string" || !hashB64) fail("Paste the Terms text so its fingerprint can be computed.");
  return call("stories", "set_terms", { version: v, terms_hash: hashB64, terms_uri: u }, "Publish Terms of Use version " + v + " (" + u + ")");
}

export function planCategory(name) {
  const n = String(name || "").trim();
  if (n.length < 1 || n.length > 32) fail("A category name is 1 to 32 characters.");
  return call("stories", "add_category", { name: n }, "Add category “" + n + "”");
}

export function planCategoryActive(id, active) {
  const c = Number(whole(id, "Category id", 1, 255));
  return call("stories", "set_category_active", { category_id: c, active: !!active }, (active ? "Show" : "Hide") + " category " + c);
}

// ---------------------------------------------------------------- admin handover

export function planSetAdmin(contract, newAdmin) {
  if (!["ink", "shop", "stories"].includes(contract)) fail("Pick Ink, Shop or Stories.");
  const a = requireAddress(newAdmin, "New admin");
  return call(contract, "set_admin", { new_admin: a }, contract + ": PROPOSE " + a + " as admin (it must accept)");
}

export function planAcceptAdmin(contract) {
  if (!["ink", "shop", "stories"].includes(contract)) fail("Pick Ink, Shop or Stories.");
  return call(contract, "accept_admin", {}, contract + ": accept the admin role (signed by the proposed admin)");
}

// ---------------------------------------------------------------- sponsor

/** Default sponsor caps in mana (audit M-A): about 1 mana a transaction. */
export const SPONSOR_DEFAULT_CAPS = { perTx: "1", perAccount: "20", perDay: "300" };

/**
 * The deploy-tool command that changes the sponsor's settings (audit L-17).
 * The sponsor key stays offline: the page never asks a wallet to sign
 * set_config, it only shows this command, checked the way the contract
 * checks the settings. The tool adds the list of sponsored calls itself.
 * Returns { command, summary }.
 */
export function sponsorCommand({ sponsor, enabled, ink, shop, stories, tokens, perTx, perAccount, perDay, mainnet }) {
  const s = requireAddress(sponsor, "Sponsor");
  const ids = [requireAddress(ink, "Ink"), requireAddress(shop, "Shop"), requireAddress(stories, "Stories")];
  const list = String(tokens || "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => requireAddress(t, "Token"));
  if (list.length > 4) fail("At most 4 payment tokens.");
  const mana = (v, label) => toBaseUnits(v, 8, label);
  const a = mana(perTx, "Mana per transaction");
  const b = mana(perAccount, "Mana per wallet per day");
  const c = mana(perDay, "Mana for everyone per day");
  if (BigInt(a) > BigInt(b) || BigInt(b) > BigInt(c)) fail("Caps must be per transaction <= per wallet per day <= everyone per day.");
  if (BigInt(c) > 100000000000n) fail("The daily cap can be at most 1,000 mana.");
  if (enabled && BigInt(a) === 0n) fail("Switched on needs a per-transaction cap above 0.");
  const command = ["node deploy/deploy.js sponsor-config", "--sponsor " + s, "--ink " + ids[0], "--shop " + ids[1], "--stories " + ids[2],
    list.length ? "--tokens " + list.join(",") : "", "--per-tx " + fromBaseUnits(a, 8), "--per-account " + fromBaseUnits(b, 8),
    "--per-day " + fromBaseUnits(c, 8), enabled ? "" : "--disable", mainnet ? "--network mainnet --i-understand-this-is-mainnet" : ""].filter(Boolean).join(" ");
  return { command, summary: "Mana sponsor " + (enabled ? "ON" : "OFF") + ": " + fromBaseUnits(a, 8) + " / " + fromBaseUnits(b, 8) + " / " +
    fromBaseUnits(c, 8) + " mana (per transaction / per wallet per day / everyone per day)" };
}

// ---------------------------------------------------------------- any method

/** Any write method, with its arguments as JSON (for anything without its own form). */
export function planAny(abis, contract, method, json) {
  const abi = abis[contract];
  if (!abi) fail("Unknown contract.");
  const m = abi.methods[method];
  if (!m || m.read_only) fail(contract + " has no write method " + method + ".");
  let args;
  try {
    args = json && String(json).trim() ? JSON.parse(json) : {};
  } catch {
    fail("The arguments are not valid JSON.");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("The arguments must be a JSON object.");
  checkJsonNumbers(args, "arguments");
  return call(contract, method, args, contract + "." + method + " " + JSON.stringify(args));
}

/**
 * Numbers typed as JSON (audit M-C): a JSON number beyond 2^53 has already
 * lost digits when it is parsed, so big ones must be written as strings, and
 * no number may be above a uint64.
 */
function checkJsonNumbers(value, at) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkJsonNumbers(v, at + "[" + i + "]"));
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) checkJsonNumbers(value[k], at + "." + k);
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(at + " is not a whole number JavaScript can hold exactly: write large numbers in quotes, like \"20000000000000000000\".");
    if (value < 0) fail(at + " must be 0 or more.");
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    requireUint64(BigInt(value), at);
  }
}

// ---------------------------------------------------------------- multisig files

/**
 * A prepared transaction file the deploy tool's `cosign` and `submit` take.
 * `tx` is { id, header, operations } after Transaction.prepareTransaction;
 * `planned` the plan objects, with `contract_id` added.
 */
export function preparedFile({ networkKey, chainId, tx, planned, preparedAt, needs }) {
  const file = {
    format: PREPARED_FORMAT,
    network: networkKey,
    chain_id: chainId,
    command: "admin-page",
    prepared_at: preparedAt || new Date().toISOString(),
    operations: planned.map((p) => ({ contract: p.contract, contract_id: p.contract_id, method: p.method, args: p.args })),
    transaction: { id: tx.id, header: tx.header, operations: tx.operations, signatures: [] },
  };
  // When the payer is a multisig: its public signer list, so cosign refuses
  // any other key and submit counts the signatures (as the deploy tool does).
  if (needs) file.needs = { account: needs.account, signers: needs.signers.slice(), threshold: Number(needs.threshold) };
  return file;
}
