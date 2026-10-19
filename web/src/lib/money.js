/** Whole-number helpers for mana (8 decimals) and token base units. */

export const MANA_BASE = 100000000n;
/** KOIN Vault's self-paid ceiling: 100 mana, in raw resource units. */
export const VAULT_MANA_CEILING = 100n * MANA_BASE;
/** A comfortable Kondor warning line. Measured writes sit under 1 mana. */
export const LOW_MANA_WARN = MANA_BASE;

export function asWhole(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(label + " must be a whole number of 0 or more.");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error(label + " must be a whole number of 0 or more.");
    return BigInt(value);
  }
  const s = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(s)) throw new Error(label + " must be a whole number of 0 or more.");
  return BigInt(s);
}

function trimFrac(frac) {
  const trimmed = frac.replace(/0+$/, "");
  return trimmed.length ? trimmed : "";
}

/**
 * Show a base-unit amount with `decimals` places.
 * 100000000 with 8 decimals is "1". 50000000 is "0.5".
 */
export function formatUnits(amount, decimals) {
  const n = asWhole(amount, "amount");
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 18) throw new Error("decimals must be 0 to 18.");
  if (d === 0) return n.toString();
  const scale = 10n ** BigInt(d);
  const whole = n / scale;
  const frac = trimFrac((n % scale).toString().padStart(d, "0"));
  return frac ? whole.toString() + "." + frac : whole.toString();
}

/** Mana / resource credits. 100000000 is 1 mana. */
export function formatMana(rc) {
  return formatUnits(rc, 8);
}

/**
 * Extra sentence for Kondor when the account is under 1 mana.
 * Empty when mana is fine. The page still opens Kondor either way.
 */
export function kondorManaNote(rc) {
  let have;
  try {
    have = asWhole(rc == null || rc === "" ? "0" : rc, "mana");
  } catch {
    return "This page could not read mana. If Kondor refuses the signature, tick Use free mana in its window.";
  }
  if (have < LOW_MANA_WARN) {
    return "This account has under 1 mana. The page will still open Kondor. Tick Use free mana in its window, or the signature can be refused.";
  }
  return "";
}

export function formatUtc(seconds) {
  let n;
  try {
    n = asWhole(seconds, "time");
  } catch {
    return "";
  }
  if (n === 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) return "";
  const d = new Date(Number(n) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (x) => String(x).padStart(2, "0");
  return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", " +
    p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC";
}

export function shortAddress(address) {
  const s = String(address || "");
  if (s.length < 12) return s;
  return s.slice(0, 6) + "…" + s.slice(-4);
}

/** head_block_time is milliseconds. */
export function headTimeSeconds(head) {
  const raw = head && (head.head_block_time || head.head_block_time_ms);
  if (raw == null || raw === "") return 0n;
  const n = asWhole(raw, "head time");
  if (n > 1000000000000n) return n / 1000n;
  return n;
}
