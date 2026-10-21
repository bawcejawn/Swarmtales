import assert from "node:assert/strict";
import test from "node:test";
import { createTestWallet } from "../src/testWallet.js";

test("the test wallet does not exist on mainnet", () => {
  assert.equal(createTestWallet({ mainnet: true }), null);
  assert.equal(createTestWallet(null), null);
});

test("the test wallet exists on the testnet", () => {
  const w = createTestWallet({ mainnet: false });
  assert.equal(w.id, "testwallet");
  assert.equal(w.getAddress(), null);
});

// ---------- AB-014 ----------

import { forgetTestWalletOnMainnet } from "../src/testWallet.js";
import { isFramed } from "../src/lib/frame.js";

function fakeStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

test("a mainnet build deletes a test-wallet key left from the testnet", () => {
  const key = "swarmtales.testwallet.v1";
  const onMainnet = fakeStorage({ [key]: "ab".repeat(32), other: "kept" });
  forgetTestWalletOnMainnet({ mainnet: true }, onMainnet);
  assert.equal(onMainnet.has(key), false);
  assert.equal(onMainnet.has("other"), true);
  const onTestnet = fakeStorage({ [key]: "ab".repeat(32) });
  forgetTestWalletOnMainnet({ mainnet: false }, onTestnet);
  assert.equal(onTestnet.has(key), true);
  // Storage that throws (private mode, blocked site data) is not an error.
  forgetTestWalletOnMainnet({ mainnet: true }, { removeItem: () => { throw new Error("blocked"); } });
});

test("the page knows when another site has framed it", () => {
  const self = {};
  assert.equal(isFramed({ self, top: self }), false);
  assert.equal(isFramed({ self, top: {} }), true);
  const crossOrigin = { self };
  Object.defineProperty(crossOrigin, "top", { get() { throw new Error("cross-origin"); } });
  assert.equal(isFramed(crossOrigin), true);
});
