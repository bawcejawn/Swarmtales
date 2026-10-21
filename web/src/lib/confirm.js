/**
 * What happened to a sent transaction (audit AB-004).
 *
 * The node's transaction lookup only says which blocks hold a transaction;
 * it never carries a receipt, and KOIN Vault returns no receipt at all. The
 * only proof of success is the transaction's own receipt inside the receipt
 * of a block that contains it. Without that, the answer is "unknown": the
 * page must not say "Done" or show anything that depends on it.
 */

export const TX_CONFIRMED = "confirmed";
export const TX_REVERTED = "reverted";
export const TX_UNKNOWN = "unknown";

/** This transaction's receipt among a block_store reply's items, or null. */
export function receiptFor(blockItems, transactionId) {
  const want = String(transactionId).toLowerCase();
  for (const item of Array.isArray(blockItems) ? blockItems : []) {
    const list = item && item.receipt && item.receipt.transaction_receipts;
    if (!Array.isArray(list)) continue;
    const found = list.find((r) => r && String(r.id).toLowerCase() === want);
    if (found) return found;
  }
  return null;
}

/**
 * Poll until the transaction is in a block and its receipt can be read, or
 * the wait runs out. Returns { state, logs }.
 *   lookupTransaction(id)      -> { containing_blocks } | null
 *   getBlockReceipts(blockIds) -> block_store items with receipts
 */
export async function confirmTransaction(transactionId, deps) {
  const { lookupTransaction, getBlockReceipts, waitMs = 90000, pollMs = 3000, now = Date.now, sleep } = deps;
  if (!transactionId) return { state: TX_UNKNOWN, logs: [] };
  const until = now() + waitMs;
  for (;;) {
    const row = await lookupTransaction(transactionId).catch(() => null);
    const blocks = row && Array.isArray(row.containing_blocks) ? row.containing_blocks : [];
    if (blocks.length) {
      const items = await getBlockReceipts(blocks).catch(() => null);
      const receipt = receiptFor(items, transactionId);
      if (receipt) {
        const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
        return { state: receipt.reverted ? TX_REVERTED : TX_CONFIRMED, logs };
      }
    }
    if (now() >= until) return { state: TX_UNKNOWN, logs: [] };
    await sleep(pollMs);
  }
}
