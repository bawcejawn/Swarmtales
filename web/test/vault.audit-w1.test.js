// Audit 2026-10 W1-04 (a Vault endpoint can't show "Done" for an unrelated
// transaction) and W1-05 (the session secret stays out of URLs).
import assert from "node:assert/strict";
import test from "node:test";
import { vaultRequestStatus, vaultStatus, vaultTransactionMismatch } from "../src/lib/vaultApi.js";

if (!globalThis.sessionStorage) {
  const m = new Map();
  globalThis.sessionStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const { verifyVaultTransaction } = await import("../src/wallet.js");

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const statusBody = { ok: true, connected: true, address: "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf", expiresAt: 1 };

test("W1-05: status calls send the secret in a POST body, never in the URL, when Vault accepts it", async () => {
  const creds = { sessionId: "sess", secret: "s3cret" };
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return json(200, url.includes("request-status") ? { ok: true, status: "pending" } : statusBody);
  };
  await vaultStatus(creds, fetchImpl);
  await vaultRequestStatus(creds, "req1", fetchImpl);
  assert.equal(creds.transport, "post");
  for (const s of seen) {
    assert.equal(s.init.method, "POST");
    assert.ok(!s.url.includes("s3cret") && !s.url.includes("?"), s.url);
    assert.equal(JSON.parse(s.init.body).secret, "s3cret");
  }
  assert.equal(JSON.parse(seen[1].init.body).requestId, "req1");
});

test("W1-05: if Vault only takes GET, the page falls back once and remembers it", async () => {
  const creds = { sessionId: "sess", secret: "s3cret" };
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.method);
    if (init.method === "POST") return json(405, { ok: false, error: "method not allowed" });
    return json(200, statusBody);
  };
  await vaultStatus(creds, fetchImpl);
  await vaultStatus(creds, fetchImpl);
  assert.deepEqual(seen, ["POST", "GET", "GET"]);
  assert.equal(creds.transport, "get");
});

test("W1-05: an expired session is still reported as expired (no silent fallback loop)", async () => {
  const creds = { sessionId: "sess", secret: "s3cret", transport: "post" };
  await assert.rejects(vaultStatus(creds, async () => json(404, { ok: false, error: "no session" })), (e) => e.status === 404);
});

const ops = [
  { call_contract: { contract_id: "1Shop", entry_point: 11, args: "AAEC" } },
  { call_contract: { contract_id: "1Stories", entry_point: 22, args: "AwQ=" } },
];
const tx = (over = {}) => ({
  id: "0x1220ab",
  header: { chain_id: "CHAIN" },
  operations: ops.map((o) => ({ call_contract: { ...o.call_contract, args: o.call_contract.args.replace(/=+$/, "") } })),
  ...over,
});

test("W1-04: only the exact transaction asked for counts", () => {
  assert.equal(vaultTransactionMismatch(tx(), ops, { txid: "0x1220AB", chainId: "CHAIN" }), "");
  assert.match(vaultTransactionMismatch(tx({ id: "0x1220cd" }), ops, { txid: "0x1220ab", chainId: "CHAIN" }), /id/);
  assert.match(vaultTransactionMismatch(tx({ header: { chain_id: "OTHER" } }), ops, { txid: "0x1220ab", chainId: "CHAIN" }), /chain/);
  assert.match(vaultTransactionMismatch(tx({ operations: tx().operations.slice(0, 1) }), ops, { txid: "0x1220ab", chainId: "CHAIN" }), /calls/);
  const swapped = tx();
  swapped.operations[1] = { call_contract: { contract_id: "1Stories", entry_point: 22, args: "BBBB" } };
  assert.match(vaultTransactionMismatch(swapped, ops, { txid: "0x1220ab", chainId: "CHAIN" }), /different details/);
  const other = tx();
  other.operations[0] = { call_contract: { contract_id: "1Thief", entry_point: 11, args: "AAEC" } };
  assert.match(vaultTransactionMismatch(other, ops, { txid: "0x1220ab", chainId: "CHAIN" }), /different contract/);
  assert.match(vaultTransactionMismatch(null, ops, { txid: "x", chainId: "CHAIN" }), /no such/);
});

test("W1-04: the Vault wallet reports success only after the node shows the matching transaction", async () => {
  let calls = 0;
  const lookup = async () => (++calls < 3 ? null : { transaction: tx() });
  const got = await verifyVaultTransaction("0x1220ab", ops, "CHAIN", { lookup, sleep: async () => {}, waitMs: 60000 });
  assert.equal(got.id, "0x1220ab");
  await assert.rejects(
    verifyVaultTransaction("0x1220ab", ops, "CHAIN", { lookup: async () => ({ transaction: tx({ id: "0x1220ab", operations: [] }) }), sleep: async () => {} }),
    /not what this page asked for/
  );
  let t = 0;
  await assert.rejects(
    verifyVaultTransaction("0x1220ab", ops, "CHAIN", { lookup: async () => null, sleep: async () => { t += 5000; }, now: () => t, waitMs: 10000 }),
    /doesn't show it yet/
  );
});

test("L-22: a network error, a refused request, a 400 or a non-JSON answer never falls back to GET", async () => {
  const cases = [
    ["network error", async () => { throw new TypeError("Failed to fetch"); }],
    ["400", async () => json(400, { ok: false, error: "bad request" })],
    ["500", async () => json(500, { ok: false, error: "oops" })],
    ["not JSON", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } })],
  ];
  for (const [label, post] of cases) {
    const creds = { sessionId: "sess", secret: "s3cret" };
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ method: init.method, url });
      return init.method === "POST" ? post() : json(200, statusBody);
    };
    await assert.rejects(vaultStatus(creds, fetchImpl), label);
    assert.deepEqual(seen.map((s) => s.method), ["POST"], label + ": no GET");
    assert.ok(!seen.some((s) => s.url.includes("s3cret")), label);
    assert.notEqual(creds.transport, "get", label);
  }
  // An explicit "not this way" still does, once.
  for (const status of [404, 405, 415, 501]) {
    const creds = { sessionId: "sess", secret: "s3cret" };
    await vaultStatus(creds, async (url, init) => (init.method === "POST" ? json(status, { ok: false }) : json(200, statusBody)));
    assert.equal(creds.transport, "get", String(status));
  }
});

test("I-17: a Vault status naming something that isn't a Koinos address is refused, and the wait has its own limit", async () => {
  const { VAULT_MAX_WAIT_MS, vaultWaitDeadline } = await import("../src/lib/vaultApi.js");
  for (const address of ["javascript:alert(1)", "0xabc", "1abc", 42]) {
    const creds = { sessionId: "sess", secret: "s3cret" };
    await assert.rejects(vaultStatus(creds, async () => json(200, { ...statusBody, address })), /not a Koinos address/, String(address));
  }
  const ok = await vaultStatus({ sessionId: "s", secret: "x" }, async () => json(200, { ...statusBody, address: "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf" }));
  assert.equal(ok.address, "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");
  assert.equal((await vaultStatus({ sessionId: "s", secret: "x" }, async () => json(200, { ok: true, connected: false, expiresAt: 1 }))).address, null);
  // Vault's expiry is used when it is sooner; a far-future one is capped.
  assert.equal(vaultWaitDeadline(1000 + 60000, 1000), 61000);
  assert.equal(vaultWaitDeadline(1e15, 1000), 1000 + VAULT_MAX_WAIT_MS);
  assert.equal(VAULT_MAX_WAIT_MS, 15 * 60 * 1000);
});
