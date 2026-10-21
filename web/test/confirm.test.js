import assert from "node:assert/strict";
import test from "node:test";
import { TX_CONFIRMED, TX_REVERTED, TX_UNKNOWN, confirmTransaction } from "../src/lib/confirm.js";

// AB-004: the page may only say "Done" for a transaction whose own receipt,
// from a block that contains it, shows it did not revert.

const TX = "0x1220aa";
const BLOCK = "0x1220bb";

// A fake node. `rows` is what getTransactionsById returns on each poll (the
// real shape: { transaction, containing_blocks }, never a receipt).
// `receipts` is what the block receipt holds once it can be read.
function fakeNode({ rows = [], receipts = null, receiptsFail = false } = {}) {
  let clock = 0;
  let poll = 0;
  return {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    lookupTransaction: async () => rows[Math.min(poll++, rows.length - 1)] || null,
    getBlockReceipts: async (blockIds) => {
      if (receiptsFail) throw new Error("block_store unavailable");
      assert.deepEqual(blockIds, [BLOCK]);
      return receipts === null ? [] : [{ block_id: BLOCK, receipt: { transaction_receipts: receipts } }];
    },
  };
}

const included = { transaction: { id: TX }, containing_blocks: [BLOCK] };
const notYet = { transaction: { id: TX }, containing_blocks: [] };

test("a transaction that reverted inside its block is reported as reverted, with its logs", async () => {
  const node = fakeNode({ rows: [included], receipts: [{ id: TX, reverted: true, logs: ["SHOP: price changed"] }] });
  const out = await confirmTransaction(TX, node);
  assert.equal(out.state, TX_REVERTED);
  assert.deepEqual(out.logs, ["SHOP: price changed"]);
});

test("a transaction that never shows up in a block within the wait is unknown, not done", async () => {
  const node = fakeNode({ rows: [null] });
  const out = await confirmTransaction(TX, { ...node, waitMs: 9000, pollMs: 3000 });
  assert.equal(out.state, TX_UNKNOWN);
});

test("a transaction seen in the mempool but not yet in a block is unknown", async () => {
  const node = fakeNode({ rows: [notYet] });
  const out = await confirmTransaction(TX, { ...node, waitMs: 9000, pollMs: 3000 });
  assert.equal(out.state, TX_UNKNOWN);
});

test("an included transaction whose receipt cannot be read is unknown, not done", async () => {
  const node = fakeNode({ rows: [included], receiptsFail: true });
  const out = await confirmTransaction(TX, { ...node, waitMs: 9000, pollMs: 3000 });
  assert.equal(out.state, TX_UNKNOWN);
});

test("no transaction id from the wallet means nothing can be confirmed", async () => {
  const node = fakeNode({ rows: [included], receipts: [{ id: TX, reverted: false }] });
  const out = await confirmTransaction("", node);
  assert.equal(out.state, TX_UNKNOWN);
});

test("an included transaction whose receipt shows success is confirmed", async () => {
  const node = fakeNode({ rows: [notYet, included], receipts: [{ id: TX, reverted: false, logs: [] }] });
  const out = await confirmTransaction(TX, node);
  assert.equal(out.state, TX_CONFIRMED);
});

test("only this transaction's receipt counts: another one reverting in the same block does not", async () => {
  const node = fakeNode({
    rows: [included],
    receipts: [{ id: "0x1220cc", reverted: true }, { id: TX.toUpperCase().replace("0X", "0x"), reverted: false }],
  });
  const out = await confirmTransaction(TX, node);
  assert.equal(out.state, TX_CONFIRMED);
});
