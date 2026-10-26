/**
 * The mana sponsor (sponsor/ in the repository): a wallet whose contract
 * pays the mana for SwarmTales transactions, so users don't need KOIN for
 * mana. These helpers are pure; app code reads the chain and passes values in.
 *
 * The page only asks the sponsor when the contract would say yes, and falls
 * back to the user's own mana when it says no (switched off, a cap reached,
 * its mana busy). The contract checks everything again; this is only to
 * avoid asking when the answer is known.
 */

/** KCS-4 approve entry point (the only token call the sponsor pays for). */
export const APPROVE_ENTRY = 0x74e21680;
/** Below this much mana left to give (0.1 mana), don't ask the sponsor. */
export const SPONSOR_MIN_RC = 10000000n;
const MS_PER_DAY = 86400000;

function big(v) {
  try {
    return BigInt(v || 0);
  } catch {
    return 0n;
  }
}

/**
 * True when every operation is one the sponsor pays for: a call to Ink, Shop
 * or Stories, or approve on a listed payment token. (The contract also
 * checks the approve's spender and owner; the page only ever approves the
 * Shop for the user's own tokens.)
 */
export function sponsorableOperations(operations, ids, tokens) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 10) return false;
  const own = [ids.ink, ids.shop, ids.stories];
  for (const op of operations) {
    const call = op && op.call_contract;
    if (!call || op.upload_contract || op.set_system_call || op.set_system_contract) return false;
    if (own.includes(call.contract_id)) continue;
    if ((tokens || []).includes(call.contract_id) && Number(call.entry_point) === APPROVE_ENTRY) continue;
    return false;
  }
  return true;
}

/**
 * The mana limit to put on a sponsored transaction, or 0n when the sponsor
 * shouldn't be asked. `cfg` is sponsor.get_config, `mine` this account's
 * get_usage, `total` get_total_usage, `headMs` the head block time, and
 * `sponsorFree` the sponsor's mana not held by pending transactions.
 * It mirrors the contract: the configured addresses must be this page's.
 */
export function sponsorRcLimit({ cfg, mine, total, headMs, sponsorFree, ids }) {
  if (!cfg || cfg.enabled !== true) return 0n;
  if (cfg.ink !== ids.ink || cfg.shop !== ids.shop || cfg.stories !== ids.stories) return 0n;
  const day = BigInt(Math.floor(Number(headMs || 0) / MS_PER_DAY));
  const perTx = big(cfg.max_mana_per_tx);
  const perAccount = big(cfg.max_mana_per_account_day);
  const perDay = big(cfg.max_mana_per_day);
  const mineUsed = mine && big(mine.day) === day ? big(mine.used) : 0n;
  const allUsed = total && big(total.day) === day ? big(total.used) : 0n;
  let limit = perTx;
  const accountLeft = perAccount > mineUsed ? perAccount - mineUsed : 0n;
  const dayLeft = perDay > allUsed ? perDay - allUsed : 0n;
  if (accountLeft < limit) limit = accountLeft;
  if (dayLeft < limit) limit = dayLeft;
  const free = big(sponsorFree);
  if (free < limit) limit = free;
  return limit >= SPONSOR_MIN_RC ? limit : 0n;
}

/**
 * The mana limit to ask the sponsor for, from the size of the calls. The
 * sponsor's daily caps count this limit (not what was used), so it should be
 * close to real use: about 0.8 mana for any action plus 0.00015 mana per
 * byte of arguments. Measured on testnet: a bookmark or a purchase uses under
 * 0.2 mana; the largest part (6,000 CJK characters, 18 KB) uses 1.81.
 * Kondor measures and lowers the limit itself where it can.
 */
export const SPONSOR_BASE_RC = 80000000n;
export const SPONSOR_RC_PER_BYTE = 15000n;

export function sponsorRcEstimate(operations) {
  let bytes = 0;
  for (const op of operations || []) {
    const args = op && op.call_contract && op.call_contract.args;
    if (typeof args === "string") bytes += Math.floor((args.replace(/=+$/, "").length * 3) / 4);
    else if (args && typeof args.length === "number") bytes += args.length;
  }
  return SPONSOR_BASE_RC + BigInt(bytes) * SPONSOR_RC_PER_BYTE;
}

/**
 * True when an error means the sponsor said no (or couldn't pay right now),
 * so the same action should be tried again with the user's own mana. A
 * refusal by the user or by SwarmTales' own contracts is NOT one of these.
 */
export function isSponsorRefusal(error) {
  const text = String((error && error.message) || error || "");
  return /SPONSOR:|pending account resources|has not authorized transaction|authorize.*payer|payer.*authoriz/i.test(text);
}
