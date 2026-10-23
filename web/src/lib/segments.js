/**
 * Reading every part of a story (audit M-5).
 *
 * get_segments returns at most 10 parts, and fewer once their text passes
 * about 64 KB; its `next` says where the next page starts (0: no more).
 * A node also has its own read limit, so the page asks for only a few parts
 * per call (SEGMENTS_PER_READ) and goes on from `next`. If a call fails (for
 * example a page of very long multibyte parts is over the node's limit), the
 * part at that place is read on its own with get_segment, and paging resumes
 * right after it.
 *
 * Parts carry no sequence number of their own: part N is the Nth value read.
 */
export const SEGMENTS_PER_READ = 3;

/**
 * readPage(start, limit) -> { values, next } (one get_segments read)
 * readOne(seq)           -> the segment (one get_segment read)
 * count                  -> the story's segment_count, read with the story
 * Returns the parts in sequence order (index 0 is part 1).
 */
export async function readAllSegments({ readPage, readOne, count, perRead = SEGMENTS_PER_READ }) {
  const total = Number(count || 0);
  const out = [];
  let start = 1;
  while (start <= total) {
    let page = null;
    try {
      page = await readPage(start, Math.min(perRead, total - start + 1));
    } catch {
      page = null;
    }
    const values = page && Array.isArray(page.values) ? page.values : [];
    if (!values.length) {
      // The batched read failed or came back empty: read this one part alone.
      // If that fails too, the error reaches the page (nothing is guessed).
      const one = await readOne(start);
      out.push(one || {});
      start += 1;
      continue;
    }
    // Never more than asked or than the story holds.
    const take = values.slice(0, total - start + 1);
    out.push(...take);
    const positional = start + take.length;
    const next = Number((page && page.next) || 0);
    // `next` is where the contract says to go on. It can only be the part
    // right after this page; anything else (or 0 from a contract that
    // doesn't fill it) falls back to the position, bounded by `count`.
    start = next === positional ? next : positional;
  }
  return out;
}
