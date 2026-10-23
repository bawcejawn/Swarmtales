// Audit 2026-10 M-5: the site reads a story 1-3 parts per get_segments call,
// pages by the contract's `next`, and falls back to get_segment one part at a
// time when a page can't be read (long multibyte parts over a node's limit).
import assert from "node:assert/strict";
import test from "node:test";
import { SEGMENTS_PER_READ, readAllSegments } from "../src/lib/segments.js";

const part = (n) => ({ text: "part " + n });

function fakeChain(count, { failAt = new Set(), short = false, nextZero = false } = {}) {
  const calls = [];
  const readPage = async (start, limit) => {
    calls.push(["page", start, limit]);
    if (failAt.has(start)) throw new Error("read limit exceeded");
    const n = short ? 1 : limit; // a byte budget can return fewer than asked
    const values = [];
    for (let s = start; s < start + n && s <= count; s++) values.push(part(s));
    const after = start + values.length;
    return { values, next: nextZero ? "0" : after <= count ? String(after) : "0" };
  };
  const readOne = async (seq) => {
    calls.push(["one", seq]);
    return part(seq);
  };
  return { calls, readPage, readOne };
}

test("M-5: never asks for more than 3 parts per call and reads every part in order", async () => {
  assert.ok(SEGMENTS_PER_READ >= 1 && SEGMENTS_PER_READ <= 3);
  const c = fakeChain(10);
  const parts = await readAllSegments({ ...c, count: 10 });
  assert.deepEqual(parts.map((p) => p.text), Array.from({ length: 10 }, (_, i) => "part " + (i + 1)));
  for (const call of c.calls) if (call[0] === "page") assert.ok(call[2] <= 3, "asked for " + call[2]);
});

test("M-5: follows next when a page stops early (byte budget)", async () => {
  const c = fakeChain(5, { short: true });
  const parts = await readAllSegments({ ...c, count: 5 });
  assert.equal(parts.length, 5);
  assert.deepEqual(c.calls.filter((x) => x[0] === "page").map((x) => x[1]), [1, 2, 3, 4, 5]);
});

test("M-5: a failed page falls back to get_segment for that part, then pages again", async () => {
  const c = fakeChain(7, { failAt: new Set([4]) });
  const parts = await readAllSegments({ ...c, count: 7 });
  assert.deepEqual(parts.map((p) => p.text), Array.from({ length: 7 }, (_, i) => "part " + (i + 1)));
  assert.ok(c.calls.some((x) => x[0] === "one" && x[1] === 4));
  assert.ok(c.calls.some((x) => x[0] === "page" && x[1] === 5), "paging resumed after the single read");
});

test("M-5: a part that can't be read at all is an error, not a silent gap", async () => {
  const c = fakeChain(3, { failAt: new Set([1]) });
  c.readOne = async () => { throw new Error("node down"); };
  await assert.rejects(readAllSegments({ ...c, count: 3 }), /node down/);
});

test("M-5: next = 0 from a page is bounded by segment_count, and never reads past it", async () => {
  const c = fakeChain(4, { nextZero: true });
  const parts = await readAllSegments({ ...c, count: 4 });
  assert.equal(parts.length, 4);
  assert.deepEqual(await readAllSegments({ ...fakeChain(0), count: 0 }), []);
});
