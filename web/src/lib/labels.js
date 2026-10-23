export const STORY_STATUS = {
  0: "Empty",
  1: "Open",
  2: "Locked",
  3: "Final edit",
  4: "Finalized",
  5: "Archived",
};

export const VISIBILITY = {
  0: "Unset",
  1: "Public",
  3: "Private",
};

export const KIND = {
  0: "Unset",
  1: "Book",
  2: "Short story",
};

export const TIER = {
  0: "No membership",
  1: "Reader",
  2: "Writer",
};

export function label(table, value) {
  const n = Number(value || 0);
  return table[n] || "Unknown (" + n + ")";
}
