import { test } from "node:test";
import assert from "node:assert/strict";
import { readAllVersions } from "../src/lib/versions.js";

// A node that answers next equal to where the page started must not stop the
// reader early: it goes on right after the last version returned.
test("readAllVersions moves on when next equals from", async () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ version: i + 1, text: "v" + (i + 1) }));
  const got = await readAllVersions(async (from, count) => ({ values: all.slice(from - 1, from - 1 + count), next: String(from) }), 7);
  assert.deepEqual(got.map((v) => v.version), [1, 2, 3, 4, 5, 6, 7]);
});
