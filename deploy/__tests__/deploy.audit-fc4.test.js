// Fourth October fix check (AB-069 to AB-072, AB-074, AB-075): version paging,
// the takedown and hide tools.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../lib");

const DEPLOY_JS = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
const ADMIN = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";
const MOD = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
const BOB = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";

function functionSource(name) {
  const start = DEPLOY_JS.indexOf("async function " + name + "(");
  assert.ok(start >= 0, name + " not found in deploy.js");
  return DEPLOY_JS.slice(start, DEPLOY_JS.indexOf("\nasync function ", start + 10));
}

function versionsOf(n) {
  return Array.from({ length: n }, (_, i) => ({ version: i + 1, kind: i ? 4 : 1, by: BOB, text: "v" + (i + 1) }));
}

test("readVersions follows the contract's next when a page stops early for long text (AB-070)", async () => {
  const all = versionsOf(9);
  const calls = [];
  // Two versions per page, as the contract returns for long text.
  const got = await lib.readVersions(async (from, count) => {
    calls.push(from);
    const values = all.slice(from - 1, from + 1);
    const next = from + 2 <= 9 ? from + 2 : 0;
    return { values, next };
  }, 9);
  assert.deepStrictEqual(got.map((v) => v.version), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepStrictEqual(calls, [1, 3, 5, 7, 9]);
});

test("readVersions follows next past a version number the page skipped", async () => {
  const v = (n) => ({ version: n, kind: 4, by: BOB, text: "v" + n });
  const pages = { 1: { values: [v(1), v(2)], next: 4 }, 3: { values: [] }, 4: { values: [v(4)], next: 0 } };
  const got = await lib.readVersions(async (from) => pages[from], 4);
  assert.deepStrictEqual(got.map((x) => x.version), [1, 2, 4]);
});

test("readVersions goes on right after the last version when there is no next", async () => {
  const all = versionsOf(7);
  const calls = [];
  const got = await lib.readVersions(async (from) => {
    calls.push(from);
    return all.slice(from - 1, from + 2); // 3 at a time, no cursor
  }, 7);
  assert.strictEqual(got.length, 7);
  assert.deepStrictEqual(calls, [1, 4, 7]);
});

test("readVersions retries a failed read for one version (AB-070)", async () => {
  const all = versionsOf(3);
  const calls = [];
  const got = await lib.readVersions(async (from, count) => {
    calls.push([from, count]);
    if (count > 1) throw new Error("compute bandwidth limit exceeded");
    return { values: all.slice(from - 1, from), next: from < 3 ? from + 1 : 0 };
  }, 3);
  assert.deepStrictEqual(got.map((v) => v.version), [1, 2, 3]);
  assert.deepStrictEqual(calls, [[1, 5], [1, 1], [2, 5], [2, 1], [3, 5], [3, 1]]);
});

test("readVersions throws when even one version can't be read", async () => {
  await assert.rejects(lib.readVersions(async () => { throw new Error("node down"); }, 2), /node down/);
});

test("readVersions returns versions in order whatever order a page has (M0991)", async () => {
  const all = versionsOf(4);
  const got = await lib.readVersions(async () => [all[3], all[1], all[0], all[2]], 4);
  assert.deepStrictEqual(got.map((v) => v.version), [1, 2, 3, 4]);
});

test("versionPage asks get_versions for the part and returns its result (M1009, M1018)", async () => {
  const asked = [];
  const storiesC = {
    functions: {
      get_versions: async (args) => {
        asked.push(args);
        return { result: { values: versionsOf(2), next: 0 } };
      },
    },
  };
  assert.deepStrictEqual(await lib.versionPage(storiesC, "4", 7)(1, 5), { values: versionsOf(2), next: 0 }, "the whole result, next included");
  asked.length = 0;
  const got = await lib.readVersions(lib.versionPage(storiesC, "4", 7), 2);
  assert.deepStrictEqual(got.map((v) => v.version), [1, 2]);
  assert.deepStrictEqual(asked, [{ story_id: "4", seq: "7", from: 1, count: 5 }]);
  const empty = { functions: { get_versions: async () => ({}) } };
  assert.deepStrictEqual(await lib.readVersions(lib.versionPage(empty, "4", 7), 2), []);
});

test("takedown reads the history with versionPage", () => {
  assert.match(functionSource("cmdTakedown"), /lib\.readVersions\(lib\.versionPage\(storiesC, storyId, seq\)/);
});

test("takedown stops for a strike choice when a part's history can't be read (AB-069)", () => {
  const body = functionSource("cmdTakedown");
  const guard = body.indexOf("if (historyError && !strike && !noStrike && Number(seg.version_count || 0) > 0)");
  assert.ok(guard > 0, "the guard is there");
  assert.ok(guard < body.indexOf("getSigner("), "before any key is asked for");
});

test("hide: a missing part is refused with a clear message (M1188)", () => {
  assert.throws(() => lib.hidePlan(null, true, ADMIN, ADMIN), /There is no such part/);
  assert.throws(() => lib.hidePlan({ status: 1 }, true, ADMIN, ADMIN), /There is no such part/);
});

test("hide: the moderator key takes over a writer-reports hide, nothing else (AB-071)", () => {
  const reports = { author: BOB, status: 1, hidden: true, hidden_by: 1 };
  assert.match(lib.hidePlan(reports, true, MOD, ADMIN), /^HIDE AS THE CHECKER/);
  assert.throws(() => lib.hidePlan({ ...reports, hidden_by: 2 }, true, MOD, ADMIN), /Only the admin key can take over/);
  assert.match(lib.hidePlan(reports, true, ADMIN, ADMIN), /^HIDE AS THE ADMIN/);
});

test("hide: a hidden part that names nobody as its hider is refused for every key (fresh contracts always set hidden_by)", () => {
  const odd = { author: BOB, status: 1, hidden: true, hidden_by: 0 };
  for (const actor of [MOD, ADMIN]) {
    assert.throws(() => lib.hidePlan(odd, false, actor, ADMIN), /says nobody hid it/);
    assert.throws(() => lib.hidePlan(odd, true, actor, ADMIN), /says nobody hid it/);
  }
  assert.match(lib.hidePlan({ ...odd, hidden_by: 2 }, false, MOD, ADMIN), /^UNHIDE/);
});

test("hide: deploy.js hands hidePlan the contract's admin address, not the config (M1111)", () => {
  const body = functionSource("cmdHide");
  assert.match(body, /lib\.hidePlan\(seg, hidden, actor, \(cfg && cfg\.admin\) \|\| ""\)/);
});
