// Audit Bot attack test for AB-004 (SwarmTales fix check, commit b002091).
// Attack: make the node lie or stay silent after a send. The page may say
// "Done" only when this transaction's own receipt, inside a block that
// holds it, did not revert. Every other answer must be "reverted" or
// "unknown". Mocks only: no node is contacted.
// Asserts the SAFE behaviour: FAILED on 3335a2a (no receipt check), PASSES once fixed.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { TX_CONFIRMED, TX_REVERTED, TX_UNKNOWN, confirmTransaction } from "../src/lib/confirm.js";

const ID = "0x1220aa";
const BLOCK = "0x1220bb";

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function deps(lookup, receipts, extra = {}) {
  const c = clock();
  return { lookupTransaction: lookup, getBlockReceipts: receipts, waitMs: 9000, pollMs: 3000, ...c, ...extra };
}
const inBlock = async () => ({ containing_blocks: [BLOCK] });
const items = (list) => async () => [{ block_id: BLOCK, receipt: { transaction_receipts: list } }];

test("AB-004: a block that holds the transaction but no receipt for it is not success", async () => {
  const out = await confirmTransaction(ID, deps(inBlock, items([{ id: "0x1220cc", reverted: false }])));
  assert.equal(out.state, TX_UNKNOWN, "AB-004: success shown without this transaction's receipt");
});

test("AB-004: a reverted receipt is reported as reverted, with its logs", async () => {
  const out = await confirmTransaction(ID, deps(inBlock, items([{ id: ID.toUpperCase(), reverted: true, logs: ["SHOP: the price is 9"] }])));
  assert.equal(out.state, TX_REVERTED);
  assert.deepEqual(out.logs, ["SHOP: the price is 9"]);
});

test("AB-004: the old lookup shape with a top-level receipt is ignored, not trusted", async () => {
  const lookup = async () => ({ containing_blocks: [BLOCK], receipt: { reverted: false } });
  const out = await confirmTransaction(ID, deps(lookup, async () => []));
  assert.equal(out.state, TX_UNKNOWN, "AB-004: a receipt the node attached to the lookup row was trusted");
});

test("AB-004: timeouts, thrown errors, junk replies and a missing id are all unknown", async () => {
  assert.equal((await confirmTransaction(ID, deps(async () => null, async () => []))).state, TX_UNKNOWN);
  assert.equal((await confirmTransaction(ID, deps(async () => { throw new Error("down"); }, async () => []))).state, TX_UNKNOWN);
  assert.equal((await confirmTransaction(ID, deps(inBlock, async () => { throw new Error("down"); }))).state, TX_UNKNOWN);
  assert.equal((await confirmTransaction(ID, deps(inBlock, async () => ({ not: "an array" })))).state, TX_UNKNOWN);
  assert.equal((await confirmTransaction(ID, deps(async () => ({ containing_blocks: "x" }), items([{ id: ID }])))).state, TX_UNKNOWN);
  assert.equal((await confirmTransaction("", deps(inBlock, items([{ id: "" }])))).state, TX_UNKNOWN);
});

test("AB-004: the wait ends: a node that never answers cannot hang the page", async () => {
  let polls = 0;
  const out = await confirmTransaction(ID, deps(async () => { polls++; return null; }, async () => []));
  assert.equal(out.state, TX_UNKNOWN);
  assert.ok(polls <= 5, "polled " + polls + " times");
});

test("AB-004: a good receipt is confirmed", async () => {
  const out = await confirmTransaction(ID, deps(inBlock, items([{ id: ID, reverted: false, logs: [] }])));
  assert.equal(out.state, TX_CONFIRMED);
});
