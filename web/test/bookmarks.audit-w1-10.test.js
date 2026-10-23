// Audit 2026-10 W1-10: a bookmark click never asks the wallet to sign. It is
// saved in the browser and marked as "not in the wallet yet"; the wallet copy
// is written only when the reader asks (one batched confirmation).
import assert from "node:assert/strict";
import test from "node:test";
import { load, markChangedAt, markInWallet, pendingWallet, setMark } from "../src/lib/bookmarks.js";

function memoryStore() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("W1-10: reader bookmarks wait for the wallet; wallet copies don't", () => {
  const s = memoryStore();
  setMark("C", 1, { seq: 3, chapter: 1, percent: 20 }, s, 1000);
  setMark("C", 2, { seq: 9, chapter: 2, percent: 70 }, s, 2000, { fromWallet: true });
  assert.deepEqual(pendingWallet("C", s), [{ id: "1", seq: 3, chapter: 1, percent: 20, at: 1000 }]);
});

test("W1-10: removing a bookmark is also waiting for the wallet (seq 0 clears it there)", () => {
  const s = memoryStore();
  setMark("C", 5, { seq: 2, chapter: 1, percent: 10 }, s, 1000, { fromWallet: true });
  setMark("C", 5, null, s, 3000);
  assert.deepEqual(pendingWallet("C", s), [{ id: "5", seq: 0, chapter: 0, percent: 0, at: 0 }]);
  assert.equal(markChangedAt(load("C", 5, s)), 3000);
  markInWallet("C", pendingWallet("C", s), s);
  assert.deepEqual(pendingWallet("C", s), []);
});

test("W1-10: a bookmark changed again while the wallet write was pending stays pending", () => {
  const s = memoryStore();
  setMark("C", 7, { seq: 1, chapter: 1, percent: 5 }, s, 1000);
  const sent = pendingWallet("C", s);
  setMark("C", 7, { seq: 4, chapter: 2, percent: 50 }, s, 2000);
  markInWallet("C", sent, s);
  assert.equal(pendingWallet("C", s)[0].seq, 4);
  markInWallet("C", pendingWallet("C", s), s);
  assert.deepEqual(pendingWallet("C", s), []);
  assert.equal(load("C", 7, s).mark.seq, 4);
});
