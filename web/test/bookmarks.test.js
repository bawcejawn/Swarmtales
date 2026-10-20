import assert from "node:assert/strict";
import test from "node:test";
import { forget, list, load, saveLast, setMark } from "../src/lib/bookmarks.js";

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

test("reading progress and bookmarks are kept per story", () => {
  const s = memoryStore();
  saveLast("C", 4, { seq: 7, chapter: 2, percent: 41.6, title: "Tale" }, s, 1000);
  assert.deepEqual(load("C", 4, s).last, { seq: 7, chapter: 2, percent: 42, at: 1000 });
  assert.equal(load("C", 4, s).title, "Tale");
  setMark("C", 4, { seq: 5, chapter: 1, percent: 30 }, s, 2000);
  assert.equal(load("C", 4, s).mark.seq, 5);
  assert.equal(load("C", 4, s).last.seq, 7);
  saveLast("C", 9, { seq: 1, chapter: 1, percent: 5 }, s, 3000);
  saveLast("OTHER", 1, { seq: 1, chapter: 1, percent: 5 }, s, 4000);
  assert.deepEqual(list("C", s).map((r) => r.id), ["9", "4"]);
  setMark("C", 4, null, s);
  assert.equal(load("C", 4, s).mark, undefined);
  forget("C", 9, s);
  assert.deepEqual(list("C", s).map((r) => r.id), ["4"]);
});

test("broken or missing storage never breaks reading", () => {
  assert.deepEqual(load("C", 1, null), {});
  assert.deepEqual(list("C", null), []);
  const bad = memoryStore();
  bad.setItem("st-read:C:1", "{not json");
  assert.deepEqual(load("C", 1, bad), {});
});
