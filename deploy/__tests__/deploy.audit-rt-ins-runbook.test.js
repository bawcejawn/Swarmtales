// Red-team (Insider) attack tests, SwarmTales fix check @ e5255c6.
// Runbook and tool promises for the people holding the keys (stolen or
// leaked key, mainnet re-upload). Each test asserts the SAFE / promised
// behaviour and FAILS while the promise does not hold.
//
// 1. docs/KEY_CUSTODY.md section 6: "Contract key leaked: ... Pause the contract
//    (admin)" and step 2 of the mainnet re-upload: "Pause the contract with its
//    admin first". deploy.js, the only admin tool the docs give, has no pause
//    command for Ink, Shop or Stories (no set_paused anywhere in it).
// 2. KEY_CUSTODY.md section 6 step 3: "The script stops ... without both mainnet
//    flags". cmdUpload only applies that guard when the contract_meta_store
//    lookup succeeds: `.catch(() => ({}))` turns ANY lookup failure (node
//    error, API not exposed, timeout) into "no contract here", so the upload
//    of new code over a live mainnet contract goes ahead without --upgrade and
//    without --i-understand-this-replaces-mainnet-code, and is described as a
//    fresh upload, not an UPGRADE, in the dry run.
// 3. docs/ADMIN_POWERS.md "if a power is not on this page, no key has it"; the
//    moderator section says it "can hide and unhide parts and add a public
//    note ... cannot remove text", but since AB-034 the moderator key (in CI)
//    can also empty any story's summary, even while paused.
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../lib");

const DEPLOY_JS = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
const DOCS = path.join(__dirname, "..", "..", "docs");

function functionSource(name, next) {
  const start = DEPLOY_JS.indexOf("async function " + name + "(");
  assert.ok(start >= 0, name + " not found in deploy.js");
  const end = next ? DEPLOY_JS.indexOf("async function " + next + "(", start) : -1;
  return DEPLOY_JS.slice(start, end > start ? end : undefined);
}

test("RT-INS runbook: the leaked-key runbook's 'pause the contract' step has a command", () => {
  const custody = fs.readFileSync(path.join(DOCS, "KEY_CUSTODY.md"), "utf8");
  assert.match(custody, /Pause the contract/, "precondition: KEY_CUSTODY.md tells the admin to pause");
  const hasPause = /case\s+"(pause|set-paused|unpause)"/.test(DEPLOY_JS) && /name:\s*"set_paused"/.test(DEPLOY_JS);
  assert.ok(hasPause,
    "RT-INS runbook: KEY_CUSTODY section 6 says to pause the contract first (leaked contract key, mainnet re-upload), " +
      "but deploy.js has no pause command; in an emergency the admin has no documented way to do it");
});

test("RT-INS runbook: a failed contract lookup does not skip the mainnet upgrade guard", () => {
  const upload = functionSource("cmdUpload", "cmdSetAdmin");
  assert.match(upload, /get_contract_meta/, "precondition: cmdUpload looks up the contract before uploading");
  const swallowed = /get_contract_meta[\s\S]{0,160}\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\(\s*\{\s*\}\s*\)\s*\)/.test(upload);
  assert.ok(!swallowed,
    "RT-INS runbook: any error from contract_meta_store.get_contract_meta is treated as 'no contract', so " +
      "checkUpgrade() returns early and new code replaces a live mainnet contract without --upgrade or " +
      lib.MAINNET_UPGRADE_FLAG + " (KEY_CUSTODY section 6 says the script stops without them)");
});

test("RT-INS runbook: checkUpgrade itself only guards when told the contract exists", () => {
  // Documents why test 2 matters: with exists=false (what a failed lookup becomes) the
  // mainnet flags are never checked.
  const flags = { network: "mainnet" };
  assert.strictEqual(lib.checkUpgrade(false, flags, true, "1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ"), false);
  assert.throws(() => lib.checkUpgrade(true, flags, true, "1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ"),
    /already has a contract/, "with a known contract the guard stops a mainnet upload without --upgrade");
});

test("RT-INS runbook: ADMIN_POWERS.md lists the moderator's summary-clearing power in the moderator section", () => {
  const powers = fs.readFileSync(path.join(DOCS, "ADMIN_POWERS.md"), "utf8");
  const start = powers.indexOf("## The moderator");
  assert.ok(start >= 0, "precondition: ADMIN_POWERS.md has a moderator section");
  const rest = powers.slice(start + 3);
  const end = rest.indexOf("\n## ");
  const section = end >= 0 ? rest.slice(0, end) : rest;
  assert.ok(/summar/i.test(section) && !/cannot remove text/i.test(section),
    "RT-INS runbook: the moderator section says the CI moderator key 'cannot remove text', but since AB-034 it " +
      "empties any story's summary (set_story_summary with empty text), even while Stories is paused");
});
