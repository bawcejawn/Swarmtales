/**
 * Reading order of a story's parts.
 *
 * Each part has a sequence number (the order it was written) and
 * insert_after: 0 means "at the end", otherwise "right after part N".
 * When several parts were added after the same part, the newest one comes
 * first (it was placed directly under that part, above the earlier ones).
 * A part can itself be followed by parts added after it; a multi-part
 * addition chains each piece after the previous one. This is the same rule
 * the PDF and NFT builders must use.
 *
 * Input: [{ seq, insertAfter }]. Output: the same objects, in reading order.
 * Every part appears exactly once, even if its insert_after points nowhere.
 */
export function readingOrder(parts) {
  const bySeq = new Map(parts.map((p) => [Number(p.seq), p]));
  const children = new Map();
  const roots = [];
  for (const p of [...parts].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    const after = Number(p.insertAfter || 0);
    if (after && bySeq.has(after) && after < Number(p.seq)) {
      if (!children.has(after)) children.set(after, []);
      children.get(after).push(p);
    } else {
      roots.push(p);
    }
  }
  const out = [];
  const seen = new Set();
  const visit = (p) => {
    // Iterative, so a very long chain of insertions can't overflow the stack.
    const stack = [p];
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node.seq)) continue;
      seen.add(node.seq);
      out.push(node);
      const kids = children.get(Number(node.seq)) || [];
      // Newest first: push the oldest first so the newest is popped first.
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  };
  for (const r of roots) visit(r);
  return out;
}
