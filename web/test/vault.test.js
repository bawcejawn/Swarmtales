import assert from "node:assert/strict";
import test from "node:test";
import { VAULT_MANA_CEILING } from "../src/lib/money.js";
import {
  VAULT_MANA_EXPLANATION,
  assertVaultUri,
  createVaultSession,
  fetchVaultConfig,
  scrubSecret,
  toRelayOperations,
  vaultManaDecision,
  vaultPairingDecision,
  vaultRequest,
} from "../src/lib/vaultApi.js";

const mainnetPage = { mainnet: true, id: "mainnet" };
const testnetPage = { mainnet: false, id: "testnet" };
const vaultMainnet = {
  ok: true,
  network: "mainnet",
  testnet: false,
  features: { openDappConnections: true },
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("pairing is allowed only on HTTPS, on mainnet, when Vault itself is mainnet", () => {
  assert.equal(vaultPairingDecision(mainnetPage, vaultMainnet, "https:").ok, true);
  assert.match(vaultPairingDecision(mainnetPage, vaultMainnet, "http:").reason, /HTTPS/);
  assert.match(vaultPairingDecision(testnetPage, vaultMainnet, "https:").reason, /testnet/);
  assert.match(
    vaultPairingDecision(mainnetPage, { ...vaultMainnet, testnet: true, network: "testnet" }, "https:").reason,
    /does not recognise/
  );
  assert.match(
    vaultPairingDecision(mainnetPage, { ...vaultMainnet, features: { openDappConnections: false } }, "https:").reason,
    /not accepting/
  );
});

test("Vault is blocked under 100 mana and the explanation names the payer limit", () => {
  const low = vaultManaDecision(VAULT_MANA_CEILING - 1n, VAULT_MANA_CEILING);
  assert.equal(low.blocked, true);
  assert.equal(low.message, VAULT_MANA_EXPLANATION);
  assert.match(low.message, /100 mana/);
  assert.match(low.message, /cannot choose a different payer/);
  assert.equal(vaultManaDecision(VAULT_MANA_CEILING, VAULT_MANA_CEILING).blocked, false);
  assert.equal(vaultManaDecision("0", VAULT_MANA_CEILING).blocked, true);
  assert.equal(vaultManaDecision("nope", VAULT_MANA_CEILING).blocked, true);
});

test("a pairing link must be the Vault origin at the site root", () => {
  const uri = "https://koinvault.app/?session=abc&secret=def";
  assert.equal(assertVaultUri(uri), uri);
  assert.throws(() => assertVaultUri("https://evil.example/?session=abc"), /unexpected link/);
  assert.throws(() => assertVaultUri("https://koinvault.app/api/dapp/create"), /unexpected link/);
  assert.throws(() => assertVaultUri("http://koinvault.app/"), /unexpected link/);
});

test("secrets are scrubbed and a create response is checked", async () => {
  const secret = "super-secret-value";
  assert.equal(scrubSecret("failed " + secret, { secret, sessionId: "sess" }), "failed [redacted]");
  const created = await createVaultSession("SwarmTales", async (url, init) => {
    assert.equal(url, "https://koinvault.app/api/dapp/create");
    assert.equal(init.method, "POST");
    assert.equal(JSON.parse(init.body).name, "SwarmTales");
    return jsonResponse(200, {
      ok: true,
      sessionId: "sess",
      secret,
      expiresAt: 1_700_000_000_000,
      uri: "https://koinvault.app/?session=sess",
    });
  });
  assert.equal(created.secret, secret);
  assert.equal(created.uri, "https://koinvault.app/?session=sess");
});

test("a Vault error that echoes the secret is redacted", async () => {
  const secret = "echo-me";
  await assert.rejects(
    () => vaultRequest(
      { sessionId: "sess", secret },
      [{ call_contract: { contract_id: "1", entry_point: 1, args: "YQ" } }],
      async () => jsonResponse(409, { ok: false, error: "need mana " + secret })
    ),
    (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /need mana \[redacted\]/);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});

test("config and operation limits", async () => {
  const config = await fetchVaultConfig(async (url) => {
    assert.equal(url, "https://koinvault.app/api/config");
    return jsonResponse(200, vaultMainnet);
  });
  assert.equal(config.network, "mainnet");
  assert.throws(() => toRelayOperations([]), /at least one/);
  assert.throws(
    () => toRelayOperations(Array.from({ length: 7 }, () => ({ call_contract: { contract_id: "1", entry_point: 1, args: "YQ" } }))),
    /at most 6/
  );
  const ops = toRelayOperations([{ call_contract: { contract_id: "1", entry_point: 2, args: "YQ" }, extra: true }]);
  assert.deepEqual(ops, [{ call_contract: { contract_id: "1", entry_point: 2, args: "YQ" } }]);
});
