// Audit Bot attack test for AB-006 and AB-009 (SwarmTales fix check, b002091).
// Attack: feed the deploy library a stale or tampered wasm, a hash in odd
// shapes, and an untrusted node on mainnet. Each must stop before anything
// is signed. Pure functions only: no node, no key.
// Asserts the SAFE behaviour: FAILED on 3335a2a (no hash check), PASSES once fixed.
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const lib = require("../lib");

const WASM = Buffer.from("release build bytes");
const SHA = crypto.createHash("sha256").update(WASM).digest("hex");
const MAINNET = { network: "mainnet", "i-understand-this-is-mainnet": true };

test("AB-006: mainnet refuses an upload with no expected hash, a wrong one, or a malformed one", () => {
  assert.throws(() => lib.checkWasmHash(WASM, undefined, true));
  assert.throws(() => lib.checkWasmHash(Buffer.from("debug build bytes"), SHA, true), /does not match/);
  for (const bad of ["", " " + SHA, SHA + "00", SHA.slice(0, 63), "0x" + SHA.slice(2), null, 123, {}]) {
    assert.throws(() => lib.checkWasmHash(WASM, bad, true), undefined, "accepted " + JSON.stringify(bad));
  }
  assert.strictEqual(lib.checkWasmHash(WASM, SHA, true), SHA);
});

test("AB-009: mainnet trusts only listed nodes, whatever the spelling", () => {
  for (const rpc of ["https://evil.example.com", "https://api.koinos.io.evil.example.com", "https://api.koinos.io@evil.example.com", "http://api.koinos.io"]) {
    assert.throws(() => lib.resolveNetwork(Object.assign({ rpc }, MAINNET)), undefined, "accepted " + rpc);
  }
});

test("AB-009: on mainnet, wire-stories needs typed payout addresses", () => {
  const onChain = { treasury: "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz", founder: "1C72FDL8NV3MHG7urVgXyvLBjMoC2WPJc6", ink: "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz" };
  assert.throws(() => lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories: "1C72FDL8NV3MHG7urVgXyvLBjMoC2WPJc6", mainnet: true }), /--treasury/);
});
