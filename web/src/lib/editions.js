/**
 * Editions (Wave 3): the rules the book page shows before anyone signs.
 * The Editions contract checks all of them again.
 */

export const KIND = { FIRST: 1, CONTRIBUTOR: 2, COLLECTOR: 3 };

/**
 * Which free edition this wallet may claim of a finished book:
 * { kind: "first" | "contributor" | null, reason }.
 * credits: [{ address, chars }] where chars is the surviving text.
 */
export function writerEdition(story, me, credits) {
  if (!me) return { kind: null, reason: "" };
  if (Number(story && story.status) !== 4) return { kind: null, reason: "Editions are made only of finished books." };
  if (story.opener === me) return { kind: "first", reason: "" };
  const mine = (credits || []).find((c) => c.address === me);
  const chars = mine ? Number(mine.chars) || 0 : 0;
  if (!chars) return { kind: null, reason: "" };
  const min = Math.max(1, Number(story.contributor_edition_min || 0));
  if (chars < min) {
    return { kind: null, reason: "Your text in the finished book is " + chars.toLocaleString("en-US") + " characters; a Contributor Edition needs " + min.toLocaleString("en-US") + "." };
  }
  return { kind: "contributor", reason: "" };
}

/** How a price splits: { toTreasury, toWriters } (BigInt), as the contract does it. */
export function splitSale(price, bps) {
  const p = BigInt(price || 0);
  const b = BigInt(bps || 0);
  const toTreasury = (p / 10000n) * b + ((p % 10000n) * b) / 10000n;
  return { toTreasury, toWriters: p - toTreasury };
}

/** The label of an edition kind. */
export function kindLabel(kind) {
  switch (Number(kind)) {
    case KIND.FIRST: return "First Edition";
    case KIND.CONTRIBUTOR: return "Contributor Edition";
    case KIND.COLLECTOR: return "Collector's Edition";
    default: return "Edition";
  }
}

/** A token number as the 8-byte big-endian id KCS-5 wallets use, in hex. */
export function tokenIdHex(n) {
  return "0x" + BigInt(n).toString(16).padStart(16, "0");
}
