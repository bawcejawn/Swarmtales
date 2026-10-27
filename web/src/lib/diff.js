/**
 * A word-level difference between two versions of a part, for the history
 * view: [{ op: "same" | "add" | "del", text }]. Words and the spaces after
 * them are compared as units, so the joined "same" + "add" pieces give the
 * new text and "same" + "del" give the old one.
 */

// Above this many cells the comparison would be slow in a phone browser:
// the change is then shown as "everything replaced".
const MAX_CELLS = 1000000;

export function tokens(text) {
  return String(text || "").match(/\S+\s*|\s+/g) || [];
}

export function wordDiff(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  // Common start and end are kept as they are; only the middle is compared.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out = [];
  const push = (op, text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  push("same", a.slice(0, start).join(""));
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    push("del", midA.join(""));
    push("add", midB.join(""));
  } else {
    // Longest common subsequence table, then walk it.
    const n = midA.length;
    const m = midB.length;
    const table = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * (m + 1) + j] = midA[i] === midB[j]
          ? table[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { push("same", midA[i]); i++; j++; }
      else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) { push("del", midA[i]); i++; }
      else { push("add", midB[j]); j++; }
    }
    while (i < n) push("del", midA[i++]);
    while (j < m) push("add", midB[j++]);
  }
  push("same", a.slice(endA).join(""));
  return out;
}

/** Words added and removed, for a one-line summary. */
export function diffCounts(pieces) {
  const words = (t) => (String(t).match(/\S+/g) || []).length;
  let added = 0;
  let removed = 0;
  for (const p of pieces) {
    if (p.op === "add") added += words(p.text);
    else if (p.op === "del") removed += words(p.text);
  }
  return { added, removed };
}
