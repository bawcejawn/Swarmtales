import assert from "node:assert/strict";
import test from "node:test";
import { readingOrder } from "../src/lib/order.js";

const seqs = (list) => readingOrder(list).map((p) => p.seq);

test("without insertions, parts read in the order they were written", () => {
  assert.deepEqual(seqs([{ seq: 1 }, { seq: 2 }, { seq: 3 }]), [1, 2, 3]);
});

test("a part added after part 1 is read right after it", () => {
  assert.deepEqual(seqs([{ seq: 1 }, { seq: 2 }, { seq: 3, insertAfter: 1 }]), [1, 3, 2]);
});

test("the newest part added after the same part comes first, and parts can nest", () => {
  const list = [
    { seq: 1 }, { seq: 2 },
    { seq: 3, insertAfter: 1 },
    { seq: 4, insertAfter: 1 },
    { seq: 5, insertAfter: 3 },
    { seq: 6 },
  ];
  assert.deepEqual(seqs(list), [1, 4, 3, 5, 2, 6]);
});

test("a multi-part addition chains each piece after the previous one", () => {
  const list = [{ seq: 1 }, { seq: 2 }, { seq: 3, insertAfter: 1 }, { seq: 4, insertAfter: 3 }, { seq: 5, insertAfter: 4 }];
  assert.deepEqual(seqs(list), [1, 3, 4, 5, 2]);
});

test("a part pointing at a missing or later part falls back to the end, never lost", () => {
  assert.deepEqual(seqs([{ seq: 1 }, { seq: 2, insertAfter: 9 }, { seq: 3, insertAfter: 3 }]), [1, 2, 3]);
});

test("a long chain of insertions works", () => {
  const list = [{ seq: 1 }];
  for (let i = 2; i <= 5000; i++) list.push({ seq: i, insertAfter: i - 1 });
  assert.equal(readingOrder(list).length, 5000);
});
