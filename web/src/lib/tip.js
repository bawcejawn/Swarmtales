/**
 * "Support the writers": one thank-you payment split among a story's
 * writers by how much of it each wrote. It is a plain token transfer from
 * the reader to each writer, in one transaction. SwarmTales takes nothing
 * and no contract holds the money.
 */

export const MAX_TIP_RECIPIENTS = 10;
const U64_MAX = 18446744073709551615n;

/** "2.5" with `decimals` decimals in base units (BigInt), or an error message string. */
export function parseTip(text, decimals) {
  const t = String(text == null ? "" : text).trim();
  const m = /^([0-9]{1,12})(?:\.([0-9]+))?$/.exec(t);
  if (!m) return "Enter an amount like 1 or 2.50.";
  const frac = m[2] || "";
  if (frac.length > decimals) return "That has more than " + decimals + " decimals.";
  const base = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (base <= 0n) return "Enter an amount above 0.";
  if (base > U64_MAX) return "That amount is too large.";
  return base;
}

/**
 * Split `total` (BigInt base units) among credits [{ address, chars }] by
 * characters, leaving out `exclude` (the payer). Only the top writers by
 * share are paid (at most MAX_TIP_RECIPIENTS); the rest of the amount is
 * shared among them. Exact: the values add up to `total`. Writers whose
 * share rounds to 0 are left out and their remainder goes to the others.
 * Returns [{ address, value: BigInt }] (largest first).
 */
export function splitTip(total, credits, exclude = "", max = MAX_TIP_RECIPIENTS) {
  const people = (credits || [])
    .filter((c) => c && c.address && c.address !== exclude && Number(c.chars) > 0)
    .sort((a, b) => Number(b.chars) - Number(a.chars))
    .slice(0, max);
  const amount = BigInt(total);
  if (!people.length || amount <= 0n) return [];
  for (let n = people.length; n > 0; n--) {
    const group = people.slice(0, n);
    const weights = group.map((c) => BigInt(Math.floor(Number(c.chars))));
    const sum = weights.reduce((a, b) => a + b, 0n);
    const values = weights.map((w) => (amount * w) / sum);
    let left = amount - values.reduce((a, b) => a + b, 0n);
    // Largest remainders get the leftover base units, one each.
    const order = weights.map((w, i) => [(amount * w) % sum, i]).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : a[1] - b[1]));
    for (let k = 0; left > 0n; k = (k + 1) % order.length, left--) values[order[k][1]] += 1n;
    if (values.every((v) => v > 0n)) return group.map((c, i) => ({ address: c.address, value: values[i] }));
  }
  return [];
}
