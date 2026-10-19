import assert from "node:assert/strict";
import test from "node:test";
import { Contract } from "koilib";
import { abis } from "../src/generated/abis.js";
import { entryPoint } from "../scripts/build-abi.mjs";

const ENTRY = {
  burn: 2241834181,
  mint: 3698268091,
  pay_open_fee: 547545118,
  balance_of: 1550980247,
  approve: 1960973952,
  contribute: 2326215862,
  quote_cost: 3152780057,
  open_story: 2937681671,
  buy_membership: 1504993625,
  claim_promo: 1549481165,
};

test("entry points are the first four bytes of SHA-256 of the method name", () => {
  for (const [name, value] of Object.entries(ENTRY)) {
    assert.equal(entryPoint(name), value, name);
  }
  assert.equal(abis.ink.methods.balance_of.entry_point, ENTRY.balance_of);
  assert.equal(abis.ink.methods.burn.entry_point, ENTRY.burn);
  assert.equal(abis.shop.methods.pay_open_fee.entry_point, ENTRY.pay_open_fee);
  assert.equal(abis.shop.methods.buy_membership.entry_point, ENTRY.buy_membership);
  assert.equal(abis.shop.methods.claim_promo.entry_point, ENTRY.claim_promo);
  assert.equal(abis.stories.methods.contribute.entry_point, ENTRY.contribute);
  assert.equal(abis.stories.methods.quote_cost.entry_point, ENTRY.quote_cost);
  assert.equal(abis.stories.methods.open_story.entry_point, ENTRY.open_story);
  assert.equal(abis.stories.methods.quote_cost.read_only, true);
  assert.equal(abis.stories.methods.contribute.read_only, false);
});

test("an address and emoji text survive koilib encode and decode", async () => {
  const owner = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww";
  const ink = new Contract({
    id: "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x",
    abi: abis.ink,
  });
  const balance = await ink.encodeOperation({ name: "balance_of", args: { owner } });
  assert.equal(balance.call_contract.entry_point, ENTRY.balance_of);
  assert.equal(balance.call_contract.contract_id, "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x");
  const decodedBalance = await ink.decodeOperation(balance);
  assert.equal(decodedBalance.name, "balance_of");
  assert.equal(decodedBalance.args.owner, owner);

  const stories = new Contract({
    id: "1JHakWJRXpAExjEuBik1posc8PXYYpugeN",
    abi: abis.stories,
  });
  const text = "Hi 😀";
  const contribute = await stories.encodeOperation({
    name: "contribute",
    args: {
      author: owner,
      story_id: "1",
      text,
      starts_chapter: false,
      ai_assisted: false,
      expected_ink: "5",
    },
  });
  const decoded = await stories.decodeOperation(contribute);
  assert.equal(decoded.args.author, owner);
  assert.equal(decoded.args.story_id, "1");
  assert.equal(decoded.args.text, text);
  assert.equal(decoded.args.expected_ink, "5");
  assert.equal(text.length, 5);
});
