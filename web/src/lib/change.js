/**
 * Prices for changing a part, exactly as the Stories contract computes them.
 *
 * Someone else's part (revise_part): the letters added plus the letters
 * removed (at least 10), times 2, doubling with every paid change to the same
 * part. The changer always pays, never the story's pool.
 *
 * Your own part (edit_segment): rewording is free; letters beyond the part's
 * current length cost 1 Ink each (you pay, never the pool); shortening refunds
 * only Ink you (or the pool) paid for the part and haven't had back, also
 * after someone else changed it.
 *
 * A "letter" is one UTF-16 unit, so most emoji count 2, as everywhere on
 * SwarmTales.
 */
export const MIN_CHANGE_UNITS = 10;

function isLow(c) {
  return c >= 0xdc00 && c <= 0xdfff;
}

/** What changed between two texts: one span between the common start and end. */
export function diffSpan(oldText, newText) {
  const a = String(oldText ?? "");
  const b = String(newText ?? "");
  let pre = 0;
  const maxPre = Math.min(a.length, b.length);
  while (pre < maxPre && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  if (pre > 0 && ((pre < a.length && isLow(a.charCodeAt(pre))) || (pre < b.length && isLow(b.charCodeAt(pre))))) pre--;
  let suf = 0;
  const maxSuf = Math.min(a.length, b.length) - pre;
  while (suf < maxSuf && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)) suf++;
  if (suf > 0 && (isLow(a.charCodeAt(a.length - suf)) || isLow(b.charCodeAt(b.length - suf)))) suf--;
  return { pre, suf, removed: a.length - pre - suf, added: b.length - pre - suf };
}

/** Times-multiplier for the next paid change: 2, then 4, 8, ... (segment.paid_changes so far). */
export function changeMultiplier(paidChanges) {
  return 2 ** (Number(paidChanges || 0) + 1);
}

/**
 * The exact price as a BigInt, like the contract's u64: above 2^53 a JS
 * number would print a rounded value and every change would be refused (AB-055).
 */
export function changePriceExact(units, paidChanges) {
  return BigInt(units) * (1n << BigInt(Number(paidChanges || 0) + 1));
}

/**
 * Ink a cut gives back to whoever paid: what was paid for the part (charged)
 * beyond the new length. Letters someone else added are never in charged, so
 * nobody gets back more than they paid (AB-035, AB-044). Removing the part
 * gives back everything paid. paidChanges is kept for older callers.
 */
export function cutRefund(newText, paidChanges, charged) {
  const paid = Number(charged || 0);
  if (String(newText ?? "").length === 0) return paid;
  return Math.max(0, paid - String(newText).length);
}

/** How a refund splits between the writer and a story's pool (pool-paid parts: own_paid first). */
export function refundSplit(segment, refund) {
  const seg = segment || {};
  const toWriter = seg.fund_paid ? Math.min(refund, Number(seg.own_paid || 0)) : refund;
  return { toWriter, toPool: refund - toWriter };
}

/**
 * { removed, added, units, multiplier, price, refund } for a change to someone
 * else's part. price is a BigInt (send String(price) as expected_ink).
 */
export function changePrice(oldText, newText, paidChanges, charged) {
  const { removed, added } = diffSpan(oldText, newText);
  const units = Math.max(MIN_CHANGE_UNITS, removed + added);
  const multiplier = changeMultiplier(paidChanges);
  return {
    removed,
    added,
    units,
    multiplier,
    price: changePriceExact(units, paidChanges),
    refund: cutRefund(newText, paidChanges, charged),
  };
}

/**
 * The writer's own edit: { cost, refund, toWriter, toPool }. `cost` is what the
 * writer pays for letters beyond the current length. In a part the story's pool
 * paid for, a refund first returns what the writer paid themselves (own_paid),
 * then the rest goes back to the pool.
 */
export function editPrice(segment, newText) {
  const seg = segment || {};
  const length = String(newText ?? "").length;
  const current = Number(seg.current_cost || 0);
  const cost = Math.max(0, length - current);
  const refund = cost > 0 ? 0 : cutRefund(newText, seg.paid_changes, seg.charged);
  return { cost, refund, ...refundSplit(seg, refund) };
}

/**
 * Whether the editor box holds a real change. The box starts with the stored
 * text, and what is sent is normalized and trimmed, so compare like with like:
 * a stored part with a leading or trailing space or line break must not look
 * changed (and priced) before anyone types (AB-042).
 */
export function editorChanged(storedText, boxValue, normalize) {
  const clean = (t) => normalize(String(t ?? "")).trim();
  return clean(boxValue) !== clean(storedText);
}
