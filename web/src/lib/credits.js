/**
 * Who wrote how much of a story, from the parts on chain. A finished book
 * counts what survived the final edit (`surviving`); a story still being
 * written counts the characters each part has now.
 */

/** Whole-number percents that add up to exactly 100 (largest remainder). */
export function sharePercents(amounts) {
  const values = amounts.map((a) => Math.max(0, Number(a) || 0));
  const total = values.reduce((n, v) => n + v, 0);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((n, v) => n + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k][1]] += 1;
  return out;
}

/**
 * blocks: the parts in reading order ({ segment }). Returns
 * [{ address, chars, share }] sorted by chars, most first.
 */
export function storyCredits(story, blocks) {
  const finished = Number(story && story.status) === 4;
  const totals = new Map();
  for (const b of blocks || []) {
    const s = b.segment || {};
    if (Number(s.status) === 2 || s.hidden || !s.author) continue;
    // In a finished book a part that didn't survive the final edit counts 0.
    const chars = finished ? Number(s.surviving || 0) : Number(s.current_cost || s.charged || 0);
    totals.set(s.author, (totals.get(s.author) || 0) + chars);
  }
  const rows = Array.from(totals.entries()).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shares = sharePercents(rows.map((r) => r[1]));
  return rows.map(([address, chars], i) => ({ address, chars, share: shares[i] }));
}
