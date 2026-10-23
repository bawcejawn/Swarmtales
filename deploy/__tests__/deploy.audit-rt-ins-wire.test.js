// Red-team (Insider) attack tests, SwarmTales fix check @ 00eec36.
// Tool under test: `deploy.js wire` (the Shop admin's command), the set-once
// check the audit-2 notes describe (rule 5: "deploy.js wire / wire-stories
// refuse changes (requireSetOnce)").
// cmdWire reads Shop's config with
//     readOnly(provider, "shop", shop, "get_config").catch(() => ({}))
// so ANY read failure (node error, timeout, wrong ABI) becomes "nothing is
// set yet":
//   1. lib.requireSetOnce("Shop's Ink address", undefined, ink) passes, so the
//      tool's set-once check silently does nothing (only the contract stops it);
//   2. worse, `stories = (shopCfg && shopCfg.stories) || ""` and the tool sends
//      shop.set_addresses with stories "" (the contract accepts an empty Stories
//      address). Re-running wire to rotate the treasury on a flaky node then
//      CLEARS Shop's Stories link in the same signed transaction: every
//      open_story / close fee (requireStoriesCaller: "Stories contract is not
//      set") fails until someone notices and runs wire-stories again.
// The same pattern was fixed for the mainnet upload guard (rule 8: "mainnet
// upload stops on meta-lookup error"), not here.
// Asserts the SAFE behaviour: FAILS on the current code.
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../lib");

const DEPLOY_JS = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
const INK = "13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm";

function functionSource(name, next) {
  const start = DEPLOY_JS.indexOf("async function " + name + "(");
  assert.ok(start >= 0, name + " not found in deploy.js");
  const end = next ? DEPLOY_JS.indexOf("async function " + next + "(", start) : -1;
  return DEPLOY_JS.slice(start, end > start ? end : undefined);
}

test("RT-INS wire (why it matters): requireSetOnce passes when the on-chain value could not be read", () => {
  assert.doesNotThrow(() => lib.requireSetOnce("Shop's Ink address", undefined, INK));
  assert.doesNotThrow(() => lib.requireSetOnce("Shop's Ink address", "", INK));
});

test("RT-INS wire: a failed Shop config read stops wire instead of counting as 'nothing set'", () => {
  const wire = functionSource("cmdWire", "cmdTestAsset");
  assert.match(wire, /get_config/, "precondition: cmdWire reads Shop's config before sending");
  const swallowed = /"get_config"\s*\)\s*\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\(?\s*\{\s*\}\s*\)?\s*\)/.test(wire);
  assert.ok(!swallowed,
    "RT-INS wire: any error reading Shop's get_config becomes {}, so the set-once check is skipped and " +
      "shop.set_addresses is sent with stories \"\", clearing Shop's Stories link (open/close fees stop working)");
});

test("RT-INS wire: wire never sends an empty Stories address over one that may be set", () => {
  const wire = functionSource("cmdWire", "cmdTestAsset");
  const blankFallback = /stories\s*=\s*\(\s*shopCfg\s*&&\s*shopCfg\.stories\s*\)\s*\|\|\s*""/.test(wire);
  const guarded = /if\s*\(\s*!\s*stories\s*\)[\s\S]{0,200}(fail|throw)/.test(wire) || !blankFallback;
  assert.ok(guarded || !/\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\(?\s*\{\s*\}/.test(wire),
    "RT-INS wire: when the read fails, `stories` falls back to \"\" and is sent to shop.set_addresses");
});
