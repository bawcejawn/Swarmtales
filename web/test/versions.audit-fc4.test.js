// Fourth October fix check: the history panel follows get_versions' cursor
// (AB-070), and the change panel's paid removal refunds as the contract (AB-068).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { VERSIONS_PER_READ, readAllVersions } from "../src/lib/versions.js";

const versionsOf = (n) => Array.from({ length: n }, (_, i) => ({ version: String(i + 1), text: "v" + (i + 1) }));

test("reads every version, following next when a page stops early for long text", async () => {
  const all = versionsOf(8);
  const calls = [];
  const got = await readAllVersions(async (from, count) => {
    calls.push([from, count]);
    return { values: all.slice(from - 1, from + 2), next: from + 3 <= 8 ? from + 3 : 0 };
  }, "8");
  assert.deepEqual(got.map((v) => Number(v.version)), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(calls, [[1, VERSIONS_PER_READ], [4, VERSIONS_PER_READ], [7, VERSIONS_PER_READ]]);
});

test("follows next past a version number the page skipped", async () => {
  const v = (n) => ({ version: String(n), text: "v" + n });
  const pages = { 1: { values: [v(1), v(2)], next: 4 }, 3: { values: [] }, 4: { values: [v(4)], next: 0 } };
  const got = await readAllVersions(async (from) => pages[from], 4);
  assert.deepEqual(got.map((x) => x.text), ["v1", "v2", "v4"]);
});

test("goes on right after the last version when there is no next, and stops when a page adds nothing", async () => {
  const all = versionsOf(7);
  let calls = 0;
  const got = await readAllVersions(async () => { calls++; return { values: all }; }, 7);
  assert.equal(got.length, 7);
  assert.equal(calls, 1, "a Stories version that returns every version at once needs one read");
});

test("a failed read is tried again for one version", async () => {
  const all = versionsOf(2);
  const counts = [];
  const got = await readAllVersions(async (from, count) => {
    counts.push(count);
    if (count > 1) throw new Error("compute bandwidth limit exceeded");
    return { values: all.slice(from - 1, from), next: from < 2 ? from + 1 : 0 };
  }, 2);
  assert.deepEqual(got.map((v) => v.text), ["v1", "v2"]);
  assert.deepEqual(counts, [5, 1, 5, 1]);
});

test("returns them oldest first whatever the page order", async () => {
  const all = versionsOf(3);
  const got = await readAllVersions(async () => ({ values: [all[2], all[0], all[1]] }), 3);
  assert.deepEqual(got.map((v) => v.text), ["v1", "v2", "v3"]);
});

test("the change panel's paid removal refunds what removalRefunds says (AB-068)", () => {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(src, /r\.refund = removalRefunds\(seg\) \? Number\(seg\.charged \|\| 0\) : 0;/);
});
