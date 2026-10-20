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
