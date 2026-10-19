import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedChain, configProblems, contracts, isAddress, network } from "../src/config.js";

test("the shipped config is the Foundation testnet and every address parses", () => {
  assert.equal(network.id, "testnet");
  assert.equal(network.chainId, "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==");
  assert.deepEqual(configProblems(), []);
  assert.equal(isAddress(contracts.stories), true);
  assert.equal(isAddress("not-an-address"), false);
});

test("a mismatched chain id stops before anything is signed", () => {
  assert.throws(() => assertExpectedChain("nope"), /Nothing will be signed/);
  assert.doesNotThrow(() => assertExpectedChain(network.chainId));
});

test("mainnet refuses to keep a testnet address", () => {
  const was = network.mainnet;
  network.mainnet = true;
  try {
    const problems = configProblems();
    assert.ok(problems.some((line) => line.includes("still the testnet address")));
  } finally {
    network.mainnet = was;
  }
});
