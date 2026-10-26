// The admin page's plans: each checks its inputs the way the contract does,
// and a prepared multisig file from the page passes the deploy tool's own
// cosign check (deploy/lib.js verifyPrepared).
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { Contract, Signer, Transaction } from "koilib";
import { abis } from "../src/generated/abis.js";
import {
  AdminInputError, DEFAULT_PREPARED_RC, SHOP_ITEMS, planAny, planAsset, planBlock, planFee, planHide, planInkAmounts, planLimits,
  planModeration, encodeNonce, planPause, planPrice, planPromo, planSponsor, planTakedown, planTerms, preparedFile, promoLink, strikeChoices, toBaseUnits,
} from "../src/lib/admin.js";
import { NETWORKS } from "../src/config.js";

const require = createRequire(import.meta.url);
const deployLib = require("../../deploy/lib.js");

const A = "1LrT3gTG9Rpf5zHf9DENaEgXEuhTdKxFtP";
const B = "1C8hrrjXYykrDmPBioex7YRv7cEt1mBcEi";
const C = "1Nw9fsuYPjQXX8pnz9sqg1cSyYyJPWoYat";
const TOKEN = "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju";
const throwsInput = (fn, re) => assert.throws(fn, (e) => e instanceof AdminInputError && re.test(e.message));

test("admin: token amounts convert to base units exactly", () => {
  assert.equal(toBaseUnits("2", 8), "200000000");
  assert.equal(toBaseUnits("0.5", 8), "50000000");
  assert.equal(toBaseUnits("1.25", 6), "1250000");
  assert.equal(toBaseUnits("0", 8), "0");
  throwsInput(() => toBaseUnits("1.123456789", 8), /more than 8 decimals/);
  throwsInput(() => toBaseUnits("-1", 8), /number like/);
  throwsInput(() => toBaseUnits("abc", 8), /number like/);
});

test("admin: a promo link with Ink per claim and days it works", () => {
  const now = 1761450000;
  const p = planPromo({ inkPerClaim: "500", days: "7", budget: "50000", dailyCap: "0", nowSec: now, linkSigner: A });
  assert.equal(p.contract, "shop");
  assert.equal(p.method, "create_campaign");
  assert.deepEqual(p.args, {
    link_signer: A, amount: "500", budget_total: "50000", daily_cap: "0",
    starts_at: String(now), ends_at: String(now + 7 * 86400), single_use: false, enabled: true,
  });
  assert.match(p.summary, /500 Ink per wallet .* for 7 days/);
  throwsInput(() => planPromo({ inkPerClaim: "0", days: "7", budget: "50", nowSec: now, linkSigner: A }), /at least 1/);
  throwsInput(() => planPromo({ inkPerClaim: "500", days: "0", budget: "5000", nowSec: now, linkSigner: A }), /at least 1/);
  throwsInput(() => planPromo({ inkPerClaim: "500", days: "366", budget: "5000", nowSec: now, linkSigner: A }), /at most 365/);
  throwsInput(() => planPromo({ inkPerClaim: "500", days: "7", budget: "100", nowSec: now, linkSigner: A }), /cover at least one claim/);
  throwsInput(() => planPromo({ inkPerClaim: "500", days: "7", budget: "5000", dailyCap: "100", nowSec: now, linkSigner: A }), /daily cap/);
  assert.equal(promoLink("https://example.org/st", 4, "5Kabc"), "https://example.org/st/#/promo/4?k=5Kabc");
});

test("admin: prices, the poem item, Ink amounts, fee and tokens", () => {
  assert.ok(SHOP_ITEMS.some((i) => i.id === 10 && /poem/i.test(i.name)));
  assert.ok(!SHOP_ITEMS.some((i) => i.id === 8 || i.id === 9), "retired items");
  const p = planPrice(10, TOKEN, "0.3", 8, "tKOIN");
  assert.deepEqual(p.args, { item: 10, token: TOKEN, amount: "30000000" });
  assert.match(planPrice(2, TOKEN, "0", 8, "tKOIN").summary, /not for sale/);
  throwsInput(() => planPrice(8, TOKEN, "1", 8), /Unknown item/);
  const ink = planInkAmounts({ writer_month: "15000", pack_s: "5000", pack_m: "15000", pack_l: "45000", starter_book: "20000", starter_short: "10000", starter_poem: "2000" });
  assert.equal(ink.args.starter_poem, "2000");
  throwsInput(() => planInkAmounts({ writer_month: "x" }), /whole number/);
  assert.deepEqual(planFee("100").args, { fee_bps: 100 });
  throwsInput(() => planFee("501"), /at most 500/);
  assert.deepEqual(planAsset({ token: TOKEN, enabled: true, decimals: "8", symbol: "tKOIN" }).args, { token: TOKEN, enabled: true, decimals: 8, symbol: "tKOIN" });
  assert.equal(planAsset({ token: TOKEN, enabled: false }).args.enabled, false);
  throwsInput(() => planAsset({ token: TOKEN, enabled: true, decimals: "8", symbol: "t KOIN" }), /symbol/);
});

test("admin: pause, hide, block and settings stay inside the contract's bounds", () => {
  assert.deepEqual(planPause("stories", true).args, { paused: true });
  throwsInput(() => planPause("sponsor", true), /Ink, Shop or Stories/);
  assert.deepEqual(planHide({ actor: A, storyId: "3", seq: "2", hidden: true, reason: "1", noteText: "matched a book" }).args,
    { actor: A, story_id: "3", seq: "2", hidden: true, reason: 1, note: "matched a book" });
  throwsInput(() => planHide({ actor: A, storyId: "3", seq: "2", hidden: true, reason: "1", noteText: "x".repeat(201) }), /200 characters/);
  assert.equal(planBlock({ account: B, blocked: true }).args.blocked, true);
  const limits = { contribution_cap: "6000", trial_limit: "1000", open_limit: "10", archive_days: "60", inactivity_days: "30", full_price_projects: "3", max_price_multiplier: "4" };
  assert.equal(planLimits(limits).args.contribution_cap, 6000);
  throwsInput(() => planLimits({ ...limits, contribution_cap: "6001" }), /at most 6000/);
  throwsInput(() => planLimits({ ...limits, archive_days: "29" }), /at least 30/);
  assert.equal(planModeration({ moderator: "off", threshold: "3", strikes: "5" }).args.moderator, "");
  throwsInput(() => planModeration({ moderator: A, threshold: "0", strikes: "5" }), /at least 1/);
  throwsInput(() => planTerms({ version: "2", hashB64: "abc", uri: "https://x", current: 2 }), /higher than the current one/);
});

test("admin: a takedown is bound to the text read, and strikes only the writer or a changer", () => {
  const seg = { author: A, text_hash: "EiB-hash", version_count: 2, last_edited_by: B, edited_by_others: true, paid_changes: 1 };
  const choices = strikeChoices(seg, [C]);
  assert.deepEqual(choices.candidates, [A, B, C]);
  assert.equal(choices.changed, true);
  const t = planTakedown({ seg, storyId: "5", seq: "3", reason: "1", noteText: "DMCA #12", strikeMode: "wallet", strike: B, changers: [C] });
  assert.deepEqual(t.args, { story_id: "5", seq: "3", reason: 1, note: "DMCA #12", reviewed_hash: "EiB-hash", reviewed_versions: 2, strike: B });
  assert.equal(planTakedown({ seg, storyId: "5", seq: "3", reason: "1", noteText: "n", strikeMode: "none", changers: [C] }).args.no_strike, true);
  throwsInput(() => planTakedown({ seg, storyId: "5", seq: "3", reason: "1", noteText: "n", strikeMode: "wallet", strike: "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52", changers: [C] }), /Only the writer or a wallet that changed/);
  throwsInput(() => planTakedown({ seg, storyId: "5", seq: "3", reason: "1", noteText: "", strikeMode: "none" }), /Add a note/);
  throwsInput(() => planTakedown({ seg: { ...seg, taken_down: true }, storyId: "5", seq: "3", reason: "1", noteText: "n", strikeMode: "none" }), /already taken down/);
});

test("admin: sponsor settings use mana units and the contract's cap rules", () => {
  const s = planSponsor({ enabled: true, ink: A, shop: B, stories: C, tokens: TOKEN, perTx: "4", perAccount: "20", perDay: "300" });
  assert.equal(s.contract, "sponsor");
  assert.deepEqual(s.args.config.tokens, [TOKEN]);
  assert.equal(s.args.config.max_mana_per_tx, "400000000");
  throwsInput(() => planSponsor({ enabled: true, ink: A, shop: B, stories: C, tokens: "", perTx: "30", perAccount: "20", perDay: "300" }), /Caps must be/);
  throwsInput(() => planSponsor({ enabled: true, ink: A, shop: B, stories: C, tokens: "", perTx: "1", perAccount: "2", perDay: "1001" }), /1,000 mana/);
});

test("admin: any other write method, with JSON arguments", () => {
  assert.deepEqual(planAny(abis, "stories", "set_paused", '{"paused":true}').args, { paused: true });
  throwsInput(() => planAny(abis, "stories", "get_config", "{}"), /no write method/);
  throwsInput(() => planAny(abis, "stories", "set_paused", "{nope"), /not valid JSON/);
});

test("admin: a prepared file from the page passes the deploy tool's cosign check", async () => {
  const net = { ...NETWORKS.testnet };
  const STORIES = "1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR";
  const SHOP = "13i2g8x9CxKXhuo3EiPbUE6P5G5QDRgqwQ";
  const plans = [planPause("stories", true), planPrice(10, TOKEN, "0.3", 8, "tKOIN")];
  plans[0].contract_id = STORIES;
  plans[1].contract_id = SHOP;
  const ops = [];
  for (const p of plans) ops.push(await new Contract({ id: p.contract_id, abi: abis[p.contract] }).encodeOperation({ name: p.method, args: p.args }));
  const tx = { header: { chain_id: net.chainId, rc_limit: DEFAULT_PREPARED_RC, nonce: "OAU=", payer: A }, operations: ops };
  await Transaction.prepareTransaction(tx);
  const file = preparedFile({ networkKey: "testnet", chainId: net.chainId, tx, planned: plans });
  const deployNet = deployLib.resolveNetwork({});
  const checked = await deployLib.verifyPrepared(JSON.parse(JSON.stringify(file)), deployNet, {
    koilib: { Transaction, Contract },
    abiFor: (name) => abis[name],
    flags: {},
  });
  assert.deepEqual(checked.ops.map((o) => o.contract + "." + o.method), ["stories.set_paused", "shop.set_price"]);
  // A changed argument is refused, as for a file from the tool.
  const bad = JSON.parse(JSON.stringify(file));
  bad.operations[1].args.amount = "1";
  await assert.rejects(deployLib.verifyPrepared(bad, deployNet, { koilib: { Transaction, Contract }, abiFor: (name) => abis[name], flags: {} }), /arguments are not the ones it describes/);
  assert.ok(Signer); // koilib loads in node for the page's link keys
});

test("admin: the nonce is encoded the way the chain and cosign read it", () => {
  for (const n of [1, 5, 127, 128, 300, 16384, 123456789]) {
    assert.equal(deployLib.nonceNumber(encodeNonce(n)), String(n), "nonce " + n);
  }
  assert.equal(encodeNonce(5), "OAU=");
});
