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

test("I-14: the mainnet profile is the koinos.armana.io node with the mainnet chain id (as the checker and deploy tool expect)", async () => {
  const { NETWORKS } = await import("../src/config.js");
  assert.equal(NETWORKS.mainnet.rpc, "https://koinos.armana.io");
  assert.equal(NETWORKS.mainnet.chainId, "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==");
  assert.equal(NETWORKS.mainnet.mainnet, true);
});
