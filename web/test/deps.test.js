import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// AB-018: no installed package at a version with a known advisory. Read from
// the lockfile, so CI fails if an install brings an old copy back.
const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

function installed(name) {
  return Object.entries(lock.packages)
    .filter(([path]) => path === "node_modules/" + name || path.endsWith("/node_modules/" + name))
    .map(([path, info]) => ({ path, version: info.version }));
}

function atLeast(version, min) {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

test("every protobufjs is 7.6.3 or later (it ships in the site bundle through koilib)", () => {
  const copies = installed("protobufjs");
  assert.ok(copies.length > 0);
  for (const c of copies) assert.ok(atLeast(c.version, "7.6.3"), c.path + " is " + c.version);
});

test("vite is 6.4.4 or later", () => {
  for (const c of installed("vite")) assert.ok(atLeast(c.version, "6.4.4"), c.path + " is " + c.version);
});

test("no copy of the npm CLI is installed as a dependency", () => {
  assert.deepEqual(installed("npm").map((c) => c.path), []);
});
