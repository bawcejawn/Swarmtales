/**
 * Price of changing someone else's part, exactly as the Stories contract
 * computes it: the letters added plus the letters removed (at least 10),
 * times 2, doubling with every change to the same part. A "letter" is one
 * UTF-16 unit, so most emoji count 2, as everywhere on SwarmTales.
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

/** Times-multiplier for the next change: 2, then 4, 8, ... */
export function changeMultiplier(versionCount) {
  const v = Number(versionCount || 0);
  const changes = v === 0 ? 0 : v - 1;
  return 2 ** (changes + 1);
}

/** { removed, added, units, multiplier, price, refund } for a change. */
export function changePrice(oldText, newText, versionCount, charged) {
  const { removed, added } = diffSpan(oldText, newText);
  const units = Math.max(MIN_CHANGE_UNITS, removed + added);
  const multiplier = changeMultiplier(versionCount);
  const removing = String(newText ?? "").length === 0;
  const paid = Number(charged || 0);
  return {
    removed,
    added,
    units,
    multiplier,
    price: units * multiplier,
    refund: removing ? paid : Math.min(removed, paid),
  };
}
