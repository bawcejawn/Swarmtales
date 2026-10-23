// Third October fix check (AB-059 to AB-062): the takedown and hide tools.
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

test("readVersions pages through every version, 5 at a time (AB-060)", async () => {
  const all = versionsOf(12);
  const calls = [];
  const got = await lib.readVersions(async (from, count) => {
    calls.push([from, count]);
    return all.slice(from - 1, from - 1 + count);
  }, "12");
  assert.deepStrictEqual(got.map((v) => v.version), all.map((v) => v.version));
  assert.deepStrictEqual(calls, [[1, 5], [6, 5], [11, 5]]);
});

test("readVersions also reads a Stories version that returns every version at once", async () => {
  const all = versionsOf(7);
  let calls = 0;
  const got = await lib.readVersions(async () => { calls++; return all; }, 7);
  assert.strictEqual(got.length, 7);
  // It goes on right after the last version returned (AB-070), so one read
  // covers all 7; it used to step by 5 and stop on a page that added nothing.
  assert.strictEqual(calls, 1, "one read returns them all");
});

test("readVersions reads nothing for a part that never changed", async () => {
  const got = await lib.readVersions(async () => assert.fail("no read needed"), 0);
  assert.deepStrictEqual(got, []);
});

test("takedown carries on when the history can't be read, and says so (AB-060)", () => {
  const body = functionSource("cmdTakedown");
  assert.match(body, /lib\.readVersions\(/, "the takedown reads the history a few versions at a time");
  assert.match(body, /catch \(e\)[\s\S]{0,80}historyError/, "a failed history read is caught");
  assert.match(body, /could not be read/, "the tool says the history could not be read");
  assert.ok(body.indexOf("historyError =") < body.indexOf("get_changers"), "it still reads get_changers afterwards");
});

test("hide: hiding an already-hidden part is the admin taking it over in one step (AB-062)", () => {
  const checker = { author: BOB, status: 1, hidden: true, hidden_by: 2 };
  assert.match(lib.hidePlan(checker, true, ADMIN, ADMIN), /HIDE AS THE ADMIN/);
  assert.throws(() => lib.hidePlan(checker, true, MOD, ADMIN), /Only the admin key can take over/);
  assert.throws(() => lib.hidePlan({ ...checker, hidden_by: 3 }, true, ADMIN, ADMIN), /already hid/);
  assert.match(lib.hidePlan({ ...checker, hidden_by: 1 }, true, ADMIN, ADMIN), /HIDE AS THE ADMIN \(now hidden by writer reports/);
  assert.strictEqual(lib.hidePlan({ author: BOB, status: 1, hidden: false }, true, MOD, ADMIN), "HIDE");
});

test("hide --unhide: only the admin key undoes an admin hide (AB-061)", () => {
  const adminHide = { author: BOB, status: 1, hidden: true, hidden_by: 3 };
  assert.throws(() => lib.hidePlan(adminHide, false, MOD, ADMIN), /only the admin key can unhide/);
  assert.match(lib.hidePlan(adminHide, false, ADMIN, ADMIN), /^UNHIDE/);
  assert.throws(() => lib.hidePlan({ author: BOB, status: 1, hidden: false }, false, ADMIN, ADMIN), /not hidden/);
});

test("hide reads the part before any key is asked for", () => {
  const body = functionSource("cmdHide");
  assert.ok(body.indexOf("lib.hidePlan(") >= 0 && body.indexOf("lib.hidePlan(") < body.indexOf("getSigner("),
    "the plan is checked before the key prompt");
});
