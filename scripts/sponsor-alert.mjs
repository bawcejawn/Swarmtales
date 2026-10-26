#!/usr/bin/env node
/**
 * Mana sponsor alert (audit M-A, L-14). Run by .github/workflows/sponsor-alert.yml
 * every hour; a failed run is GitHub's free email to the repository owner.
 *
 * It reads, from the network and sponsor the website uses (web/src/config.js):
 *   - get_config and get_total_usage of the sponsor contract;
 *   - the sponsor wallet's mana.
 * and fails when today's sponsored mana has reached ALERT_PERCENT of the daily
 * cap (someone may be filling it), or when the sponsor's mana is below
 * MIN_CAP_MULTIPLE times the daily cap (keep its KOIN well above the cap).
 * While the site is on testnet, it prints these without failing.
 *
 * Node built-ins only: no packages, no keys, read-only calls.
 * Run: node scripts/sponsor-alert.mjs
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANA_PAYER, ACTIVE, NETWORKS } from "../web/src/config.js";

export const ALERT_PERCENT = 80;
export const MIN_CAP_MULTIPLE = 5n;
const MS_PER_DAY = 86400000;

function entryPoint(name) {
  return crypto.createHash("sha256").update(name).digest().readUInt32BE(0);
}

/** The varint fields of a protobuf message, { fieldNumber: BigInt } (others skipped). */
export function varintFields(bytes) {
  const out = {};
  let i = 0;
  const varint = () => {
    let n = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= bytes.length) throw new Error("truncated protobuf");
      const b = bytes[i++];
      n |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return n;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const key = Number(varint());
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) out[field] = varint();
    else if (wire === 2) {
      const length = Number(varint()); // read it before adding: "i += varint()" would add to the old i
      i += length;
    }
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error("unexpected protobuf wire type " + wire);
  }
  return out;
}

/**
 * The alerts for one reading, [] when all is well. `cfg` and `usage` are
 * varintFields of get_config (1 enabled, 8 max_mana_per_day) and
 * get_total_usage (1 day, 2 used); `rc` the sponsor's mana; `nowMs` the time.
 */
export function assess({ cfg, usage, rc, nowMs, percent = ALERT_PERCENT }) {
  const alerts = [];
  if (!cfg[1]) return alerts; // switched off: nothing is being spent
  const cap = cfg[8] || 0n;
  const today = BigInt(Math.floor(nowMs / MS_PER_DAY));
  const used = usage[1] === today ? usage[2] || 0n : 0n;
  if (cap > 0n && used * 100n >= cap * BigInt(percent)) {
    alerts.push("Today's sponsored mana is at " + (used * 100n / cap) + "% of the daily cap (" + used + " of " + cap +
      " base units). Someone may be filling it; new users without KOIN can't act once it is full (audit M-A).");
  }
  if (cap > 0n && rc < cap * MIN_CAP_MULTIPLE) {
    alerts.push("The sponsor has " + rc + " mana base units, less than " + MIN_CAP_MULTIPLE + " times the daily cap (" + cap +
      "). Add KOIN to the sponsor wallet (audit L-14).");
  }
  return alerts;
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  if (body.error) throw new Error(method + ": " + JSON.stringify(body.error));
  return body.result || {};
}

async function readContract(url, contract, name) {
  const r = await rpc(url, "chain.read_contract", { contract_id: contract, entry_point: entryPoint(name), args: "" });
  return varintFields(Buffer.from(r.result || "", "base64url"));
}

async function main() {
  const payer = MANA_PAYER[ACTIVE] || {};
  const net = NETWORKS[ACTIVE];
  if (!payer.address || payer.kind !== "sponsor") {
    console.log("No SwarmTales sponsor is set for " + ACTIVE + " in web/src/config.js. Nothing to check.");
    return;
  }
  const [cfg, usage, rc] = await Promise.all([
    readContract(net.rpc, payer.address, "get_config"),
    readContract(net.rpc, payer.address, "get_total_usage"),
    rpc(net.rpc, "chain.get_account_rc", { account: payer.address }).then((r) => BigInt(r.rc || 0)),
  ]);
  console.log(ACTIVE + " sponsor " + payer.address + ": " + (cfg[1] ? "on" : "off") + ", daily cap " + (cfg[8] || 0n) +
    ", used today " + (usage[2] || 0n) + " (day " + (usage[1] || 0n) + "), mana " + rc + ".");
  const alerts = assess({ cfg, usage, rc, nowMs: Date.now() });
  for (const a of alerts) console.log((net.mainnet ? "ALERT: " : "NOTE (testnet, not failing): ") + a);
  // Only a mainnet alert fails the run (and so emails the owner).
  if (alerts.length && net.mainnet) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("Could not read the sponsor: " + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  });
}
