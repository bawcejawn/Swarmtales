// Audit Bot red-team (Web attacker) test: can the testnet "test wallet" ever
// sign for mainnet, or leak its key?
// Attacks:
//  1. A hostile or misconfigured RPC answers with the MAINNET chain id: the
//     test wallet must not sign or submit anything (testWallet.js:198-199,
//     chain.js:31 assertExpectedChain).
//  2. On the testnet node, every transaction the test wallet signs carries the
//     TESTNET chain id (so the signature can't be replayed on mainnet), and the
//     private key never appears in any RPC request.
//  3. createTestWallet refuses mainnet-shaped networks.
//  4. (Not run here, accepted residual of AB-014; see the end of this file.)
//     Same-origin read: the key is plain 64-hex in localStorage
//     (testWallet.js:131-144). GitHub Pages serves every project of a user on
//     one origin (https://<user>.github.io), so any other page on that origin
//     can read it, and the same key controls the same address on mainnet.
// Mocks only: the koilib Provider's call() is replaced; no node is contacted.
// Asserts the SAFE behaviour. Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { Signer } from "koilib";
import { NETWORKS, contracts } from "../src/config.js";
import { getProvider, verifiedChain, verifyChain } from "../src/chain.js";
import { createTestWallet } from "../src/testWallet.js";

const KEY_STORE = "swarmtales.testwallet.v1";
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const calls = [];
let chainIdAnswer = NETWORKS.mainnet.chainId;
const provider = getProvider();
provider.onError = () => true; // never retry
provider.call = async (method, params) => {
  calls.push({ method, params: JSON.parse(JSON.stringify(params || {})) });
  if (method === "chain.get_chain_id") return { chain_id: chainIdAnswer };
  if (method === "chain.get_account_rc") return { rc: "100000000000" };
  if (method === "mempool.get_reserved_account_rc") return { rc: "0" };
  if (method === "chain.get_account_nonce") return { nonce: "KAA" }; // value_type { uint64_value: 0 }
  if (method === "chain.submit_transaction") return { receipt: { id: params.transaction.id, rc_used: "1000000", reverted: false } };
  throw new Error("unexpected RPC " + method);
};

const op = { call_contract: { contract_id: contracts.stories, entry_point: 1, args: "" } };

test("RT-WEB: when the node reports the mainnet chain id, the test wallet signs and submits nothing", async () => {
  chainIdAnswer = NETWORKS.mainnet.chainId;
  await assert.rejects(verifyChain(), /expected chain id/);
  assert.equal(verifiedChain(), "");
  const w = createTestWallet(NETWORKS.testnet);
  await w.connect();
  await assert.rejects(w.signAndSend([op]), /chain id has not been checked/);
  assert.equal(calls.filter((c) => c.method === "chain.submit_transaction").length, 0, "a transaction was submitted");
});

test("RT-WEB: on the testnet every signed transaction carries the testnet chain id, and the key is never sent", async () => {
  calls.length = 0;
  chainIdAnswer = NETWORKS.testnet.chainId;
  await verifyChain();
  const w = createTestWallet(NETWORKS.testnet);
  await w.connect();
  await w.signAndSend([op]);
  const submitted = calls.filter((c) => c.method === "chain.submit_transaction");
  assert.ok(submitted.length >= 1);
  for (const s of submitted) {
    assert.equal(s.params.transaction.header.chain_id, NETWORKS.testnet.chainId);
    assert.notEqual(s.params.transaction.header.chain_id, NETWORKS.mainnet.chainId);
  }
  const hex = store.get(KEY_STORE);
  const wif = new Signer({ privateKey: hex }).getPrivateKey("wif");
  const traffic = JSON.stringify(calls);
  assert.ok(!traffic.includes(hex) && !traffic.includes(wif), "the private key appeared in RPC traffic");
});

test("RT-WEB: createTestWallet refuses mainnet and missing networks", () => {
  assert.equal(createTestWallet(NETWORKS.mainnet), null);
  assert.equal(createTestWallet({ ...NETWORKS.testnet, mainnet: true }), null);
  assert.equal(createTestWallet(undefined), null);
});

// Attack 4 (a same-origin page reads the test wallet's key from localStorage)
// is the residual accepted for AB-014: the testnet test wallet keeps its key in
// plain localStorage, so this check can't pass without a different storage
// design. It was left out of the suite on purpose; the three tests above guard
// what the fix does promise (no mainnet signing, testnet chain id only, the key
// never sent).
