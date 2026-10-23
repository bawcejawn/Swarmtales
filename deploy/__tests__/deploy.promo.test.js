// Rule 5 (October 2026): mainnet promo admin commands in deploy.js.
// promo-new makes a shared campaign with a fresh link key (amount 100 by
// default, start/end dates, budget), prints the share link once and keeps the
// key out of logs; promo-on / promo-off are the global switch; promo-end turns
// one campaign off. Every one of them goes through the dry run and SEND.
// Run: node --test deploy/__tests__
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const lib = require("../lib");

const NOW = Math.floor(Date.UTC(2026, 9, 21, 12, 0, 0) / 1000);
const SRC = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");

function body(name) {
  const start = SRC.indexOf("async function " + name + "(");
  assert.ok(start > 0, name + " not found");
  const end = SRC.indexOf("\nasync function ", start + 10);
  return SRC.slice(start, end);
}

test("promo-new: 100 Ink per wallet by default, budget and end required, start defaults to now", () => {
  const p = lib.planPromoCampaign({ budget: "5000", end: "2026-12-31" }, NOW);
  assert.deepStrictEqual(p, {
    amount: "100", budget_total: "5000", daily_cap: "0",
    starts_at: String(NOW), ends_at: String(Date.UTC(2026, 11, 31) / 1000),
    single_use: false, enabled: true,
  });
  const q = lib.planPromoCampaign({ amount: "250", budget: "1000", "daily-cap": "500", start: "2026-11-01T18:00", end: "2026-11-30" }, NOW);
  assert.strictEqual(q.amount, "250");
  assert.strictEqual(q.daily_cap, "500");
  assert.strictEqual(q.starts_at, String(Date.UTC(2026, 10, 1, 18, 0) / 1000));
});

test("promo-new: refuses missing or impossible settings before anything is signed", () => {
  assert.throws(() => lib.planPromoCampaign({ end: "2026-12-31" }, NOW), /--budget is required/);
  assert.throws(() => lib.planPromoCampaign({ budget: "5000" }, NOW), /--end is required/);
  assert.throws(() => lib.planPromoCampaign({ budget: "50", end: "2026-12-31" }, NOW), /cover at least one claim/);
  assert.throws(() => lib.planPromoCampaign({ budget: "5000", amount: "0", end: "2026-12-31" }, NOW), /at least 1 Ink/);
  assert.throws(() => lib.planPromoCampaign({ budget: "5000", "daily-cap": "10", end: "2026-12-31" }, NOW), /daily-cap/);
  assert.throws(() => lib.planPromoCampaign({ budget: "5000", start: "2026-12-31", end: "2026-12-01" }, NOW), /after --start/);
  assert.throws(() => lib.planPromoCampaign({ budget: "5000", end: "2026-01-01" }, NOW), /in the past/);
  for (const bad of ["2026-02-30", "31/12/2026", "tomorrow", "2026-12-31T25:00", ""]) {
    assert.throws(() => lib.parsePromoDate(bad, "end", NOW), undefined, "accepted " + JSON.stringify(bad));
  }
  assert.strictEqual(lib.parsePromoDate("now", "start", NOW), NOW);
});

test("promo-new: the share link points at the site's promo page and carries the key after #", () => {
  const wif = "5KYZdUEo39z3FPrtuX2QbbwGnNP5zTd7yyr2SC1j299sBCnWjss";
  assert.strictEqual(lib.promoShareLink(undefined, "7", wif), "https://bawcejawn.github.io/Swarmtales/#/promo/7?k=" + wif);
  assert.strictEqual(lib.promoShareLink("https://swarmtales.example", "7", wif), "https://swarmtales.example/#/promo/7?k=" + wif);
  for (const bad of ["http://swarmtales.example", "https://x.example/#/a", "javascript:alert(1)", "https://x.example/?a=1"]) {
    assert.throws(() => lib.promoShareLink(bad, "7", wif), /--site/, "accepted " + bad);
  }
});

test("promo-new: the link key stays out of logs, the summary and argv", () => {
  const b = body("cmdPromoNew");
  // Only runs in a terminal, so the one printed link can't land in a log file.
  assert.match(b, /process\.stdout\.isTTY/);
  // The private key appears only in the share link, printed after the transaction is sent.
  const uses = b.split('getPrivateKey("wif")').length - 1;
  assert.strictEqual(uses, 1, "the private key is used more than once");
  assert.ok(b.indexOf('getPrivateKey("wif")') > b.indexOf("dryRunThenSend("), "the key is printed before the transaction is confirmed");
  // A fresh key every time; the chain only gets its public address.
  assert.match(b, /lib\.newLinkKeyHex\(\)/);
  assert.match(b, /link_signer: linkKey\.getAddress\(\)/);
  assert.throws(() => lib.parseArgs(["promo-new", "--key", "5K..."]), /Do not pass a key/);
});

test("promo commands ask for confirmation (dry run, then SEND) and reach the Shop ABI", async () => {
  for (const name of ["cmdPromoNew", "cmdPromoSwitch", "cmdPromoEnd"]) {
    const b = body(name);
    assert.match(b, /await connect\(f\)/, name + " skips the network checks (mainnet needs --i-understand-this-is-mainnet)");
    assert.match(b, /dryRunThenSend\(/, name + " sends without the dry run and SEND");
  }
  for (const cmd of ["promo-new", "promo-on", "promo-off", "promo-end"]) assert.match(SRC, new RegExp('case "' + cmd + '":'));
  assert.throws(() => lib.requireCampaignId(undefined), /campaign id/);
  assert.throws(() => lib.requireCampaignId("0"), /campaign id/);
  assert.throws(() => lib.requireCampaignId("x"), /campaign id/);
  assert.strictEqual(lib.requireCampaignId("3"), "3");
  // The operations encode against the built Shop ABI.
  const { Contract } = require("koilib");
  const abi = lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "shop", "abi", "shop.abi"), "utf8")));
  const c = new Contract({ id: "1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS", abi });
  const plan = lib.planPromoCampaign({ budget: "5000", end: "2026-12-31" }, NOW);
  const op = await c.encodeOperation({ name: "create_campaign", args: { ...plan, link_signer: "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz" } });
  const back = (await c.decodeOperation(op)).args;
  assert.strictEqual(back.amount, "100");
  assert.strictEqual(back.enabled, true);
  const end = await c.encodeOperation({ name: "set_campaign_enabled", args: { campaign_id: "3", enabled: false } });
  assert.strictEqual((await c.decodeOperation(end)).args.campaign_id, "3");
  const on = await c.encodeOperation({ name: "set_promo_enabled", args: { enabled: true } });
  assert.strictEqual((await c.decodeOperation(on)).args.enabled, true);
});

// AB-034: the admin or moderator clears a story summary through the same checked path.
test("clear-summary sends an empty set_story_summary as the admin or moderator, after the dry run", async () => {
  const start = SRC.indexOf("async function cmdClearSummary(");
  const b = SRC.slice(start, SRC.indexOf("\nasync function ", start + 10));
  assert.match(b, /await connect\(f\)/);
  assert.match(b, /dryRunThenSend\(/);
  assert.match(b, /summary: ""/);
  assert.match(SRC, /case "clear-summary":/);
  const { Contract } = require("koilib");
  const abi = lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "stories", "abi", "stories.abi"), "utf8")));
  const c = new Contract({ id: "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt", abi });
  const op = await c.encodeOperation({ name: "set_story_summary", args: { account: "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz", story_id: "4", summary: "" } });
  assert.strictEqual((await c.decodeOperation(op)).args.story_id, "4");
});
