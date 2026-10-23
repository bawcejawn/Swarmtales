/**
 * Numbers and words for display, and the SHA-256 helper.
 */

export function num(value) {
  if (typeof value === "bigint") return value.toLocaleString("en-US");
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
}

export function plural(n, one, many) {
  return num(n) + " " + (Number(n) === 1 ? one : many || one + "s");
}

export function clip(text, limit) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut) + "…";
}

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** "One", "Twenty-Three"... (numbers above 99 stay as digits). */
export function chapterWord(n) {
  if (n <= 20) return NUMBER_WORDS[n] || String(n);
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + NUMBER_WORDS[n % 10] : "");
  return String(n);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
