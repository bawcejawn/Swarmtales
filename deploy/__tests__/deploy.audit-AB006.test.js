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

test("AB-006 / O1-13: mainnet uploads only the release build pinned in release-hashes.json", () => {
  const pinned = { ink: SHA, shop: "", stories: "" };
  assert.throws(() => lib.checkWasmHash(WASM, "shop", pinned, true), /No release hash is pinned/);
  assert.throws(() => lib.checkWasmHash(Buffer.from("debug build bytes"), "ink", pinned, true), /NOT the reviewed release build/);
  assert.strictEqual(lib.checkWasmHash(WASM, "ink", pinned, true), true);
  // A malformed pinned hash never loads.
  for (const bad of [" " + SHA, SHA + "00", SHA.slice(0, 63), "0x" + SHA.slice(2), SHA.toUpperCase(), null, 123, {}]) {
    assert.throws(() => lib.parseReleaseHashes(JSON.stringify({ ink: bad, shop: "", stories: "" })), /64 lowercase hex/, "accepted " + JSON.stringify(bad));
  }
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

// AB-041: the lost-admin runbook (KEY_CUSTODY.md section 6) needs a code
// re-upload on mainnet. upload may replace existing code only with --upgrade,
// and on mainnet also with a second explicit flag; a new address needs neither.
test("AB-041: replacing existing code needs --upgrade, and on mainnet a second explicit flag", () => {
  const A = "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz";
  assert.strictEqual(lib.checkUpgrade(false, {}, true, A), false);
  assert.throws(() => lib.checkUpgrade(true, {}, false, A), /--upgrade/);
  assert.strictEqual(lib.checkUpgrade(true, { upgrade: true }, false, A), true);
  assert.throws(() => lib.checkUpgrade(true, {}, true, A), /--upgrade/);
  assert.throws(() => lib.checkUpgrade(true, { upgrade: true }, true, A), /i-understand-this-replaces-mainnet-code/);
  assert.throws(() => lib.checkUpgrade(true, { upgrade: true, "i-understand-this-replaces-mainnet-code": "yes" }, true, A), /i-understand-this-replaces-mainnet-code/);
  assert.strictEqual(lib.checkUpgrade(true, { upgrade: true, "i-understand-this-replaces-mainnet-code": true }, true, A), true);
});
