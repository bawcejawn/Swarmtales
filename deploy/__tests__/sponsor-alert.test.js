// The hourly mana-sponsor alert (scripts/sponsor-alert.mjs, audit M-A and
// L-14): its protobuf reading and when it raises an alert. No network.
// Run: node --test deploy/__tests__/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "..", "scripts", "sponsor-alert.mjs")).href);
const DAY = 86400000;

test("sponsor alert: reads the varint fields of a real get_config reply", async () => {
  const { varintFields } = await load();
  // The testnet sponsor's get_config, read 25 Oct 2026: on, three addresses,
  // one token, caps 4 / 20 / 300 mana.
  const raw = Buffer.from("CAESGQDAQe1nVl_RCmYOJSmch9V5iOhqlCltQScaGQAdsrQ7nA_fjKy4wc89gcrImdomUP0s3OsiGQCVMlLESKH6P7hJvUBUdukKWC7SNtUwuYAqGQCf5R_VnIyTEJgQgwl9Al4dTXU4Dy6fmfwwgIjevgE4gKjWuQdAgNiO4W8=", "base64url");
  const f = varintFields(raw);
  assert.deepStrictEqual([f[1], f[6], f[7], f[8]], [1n, 400000000n, 2000000000n, 30000000000n]);
  assert.deepStrictEqual(varintFields(Buffer.alloc(0)), {});
  assert.throws(() => varintFields(Buffer.from([0x08])), /truncated/);
});

test("sponsor alert: fires at 80% of the daily cap, and when the sponsor holds under 5 times the cap", async () => {
  const { assess } = await load();
  const now = 20000 * DAY + 5;
  const cfg = { 1: 1n, 8: 1000n };
  const rich = 100000n;
  assert.deepStrictEqual(assess({ cfg, usage: { 1: 20000n, 2: 799n }, rc: rich, nowMs: now }), []);
  assert.match(assess({ cfg, usage: { 1: 20000n, 2: 800n }, rc: rich, nowMs: now })[0], /80% of the daily cap/);
  // Yesterday's usage doesn't count today.
  assert.deepStrictEqual(assess({ cfg, usage: { 1: 19999n, 2: 1000n }, rc: rich, nowMs: now }), []);
  assert.match(assess({ cfg, usage: {}, rc: 4999n, nowMs: now })[0], /less than 5 times the daily cap/);
  // Switched off: nothing is spent, nothing to say.
  assert.deepStrictEqual(assess({ cfg: { 8: 1000n }, usage: { 1: 20000n, 2: 1000n }, rc: 0n, nowMs: now }), []);
});
