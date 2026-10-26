// Re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md): the admin page's fixes.
import assert from "node:assert/strict";
import test from "node:test";
import { Contract } from "koilib";
import { abis } from "../src/generated/abis.js";
import { AdminInputError, U64_MAX, numberMismatch, planAny, planPromo, ratePrice, sponsorCommand, toBaseUnits } from "../src/lib/admin.js";

const A = "1LrT3gTG9Rpf5zHf9DENaEgXEuhTdKxFtP";
const B = "1C8hrrjXYykrDmPBioex7YRv7cEt1mBcEi";
const C = "1Nw9fsuYPjQXX8pnz9sqg1cSyYyJPWoYat";
const TOKEN = "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju";
const TOO_BIG = "18446744073709551616";
const throwsInput = (fn, re) => assert.throws(fn, (e) => e instanceof AdminInputError && re.test(e.message));

test("M-C: base-unit amounts above 2^64-1 are refused by every helper, never wrapped", () => {
  assert.equal(U64_MAX, 18446744073709551615n);
  // An 18-decimal "20" is 2e19 base units: it used to be signed as about 1.55 tokens.
  throwsInput(() => toBaseUnits("20", 18, "Price"), /too large/);
  assert.equal(toBaseUnits("18.446744073709551615", 18), "18446744073709551615");
  throwsInput(() => ratePrice("100000000", "0.00000001", 18), /too large/);
  throwsInput(() => planPromo({ inkPerClaim: "1", days: "1", budget: TOO_BIG, dailyCap: "0", nowSec: 1761450000, linkSigner: A }), /too large/);
  throwsInput(() => sponsorCommand({ sponsor: TOKEN, enabled: true, ink: A, shop: B, stories: C, tokens: "", perTx: "1", perAccount: "1", perDay: "184467440737.09551616" }), /too large/);
});

test("M-C: the 'any method' form refuses numbers JSON can't hold exactly and values above 2^64-1", () => {
  throwsInput(() => planAny(abis, "shop", "set_price", '{"item":1,"token":"' + TOKEN + '","amount":20000000000000000000}'), /in quotes/);
  throwsInput(() => planAny(abis, "shop", "set_price", '{"item":1,"token":"' + TOKEN + '","amount":"' + TOO_BIG + '"}'), /too large/);
  throwsInput(() => planAny(abis, "shop", "set_price", '{"item":1,"token":"' + TOKEN + '","amount":-1}'), /0 or more/);
  const ok = planAny(abis, "shop", "set_price", '{"item":1,"token":"' + TOKEN + '","amount":"18446744073709551615"}');
  assert.equal(ok.args.amount, "18446744073709551615");
});

test("M-C: decoding the encoded operation back finds a number that did not survive (what the page checks before signing)", async () => {
  const shop = new Contract({ id: "1C72FDL8NV3MHG7urVgXyvLBjMoC2WPJc6", abi: abis.shop });
  const roundTrip = async (name, args) => numberMismatch(args, (await shop.decodeOperation(await shop.encodeOperation({ name, args }))).args || {});
  assert.deepEqual(await roundTrip("set_price", { item: 1, token: TOKEN, amount: TOO_BIG }), { field: "amount", sent: TOO_BIG, got: "0" });
  assert.deepEqual(await roundTrip("set_fee_bps", { fee_bps: 4294967296 }), { field: "fee_bps", sent: "4294967296", got: "0" });
  assert.equal(await roundTrip("set_price", { item: 1, token: TOKEN, amount: "18446744073709551615" }), null);
  assert.equal(await roundTrip("set_paused", { paused: false }), null);
});

test("L-17: the admin page never asks a wallet to sign the sponsor's settings; it shows the sponsor-config command", async () => {
  const { appSource, fnBody } = await import("./helpers/appSource.js");
  const section = fnBody(appSource().replace(/\r\n/g, "\n"), "sponsorSection");
  assert.doesNotMatch(section, /actionButton\(/, "no signing button");
  assert.doesNotMatch(section, /set_config/);
  assert.match(section, /sponsorCommand\(/);
  const S = "1De7ea6SyHRT7SsHNnwLzTBuqf5ixZ1ZyZ";
  const c = sponsorCommand({ sponsor: S, enabled: false, ink: A, shop: B, stories: C, tokens: "", perTx: "1", perAccount: "20", perDay: "300", mainnet: true });
  assert.match(c.command, /^node deploy\/deploy\.js sponsor-config --sponsor \S+ .* --disable --network mainnet --i-understand-this-is-mainnet$/);
});

test("M-A: the page's default sponsor caps are about 1 mana a transaction", async () => {
  const { SPONSOR_DEFAULT_CAPS } = await import("../src/lib/admin.js");
  assert.deepEqual(SPONSOR_DEFAULT_CAPS, { perTx: "1", perAccount: "20", perDay: "300" });
});

test("I-22: Kondor gets the sponsor's ABI for an operation that calls the sponsor", async () => {
  const { abisFor } = await import("../src/chain.js");
  const { contracts } = await import("../src/config.js");
  const op = { call_contract: { contract_id: contracts.sponsor, entry_point: abis.sponsor.methods.set_config.entry_point, args: "" } };
  assert.equal(abisFor([op])[contracts.sponsor], abis.sponsor);
});

test("M-D: the page's Turn off sends the token's recorded decimals and symbol, as the tool does", async () => {
  const { planAsset } = await import("../src/lib/admin.js");
  const off = planAsset({ token: TOKEN, enabled: false, decimals: 8, symbol: "tKOIN" });
  assert.deepEqual(off.args, { token: TOKEN, enabled: false, decimals: 8, symbol: "tKOIN" });
  const { appSource } = await import("./helpers/appSource.js");
  assert.match(appSource(), /planAsset\(\{ token: t\.address, enabled: false, decimals: t\.decimals, symbol: t\.symbol \}\)/);
});

test("L-21: the 'any other admin call' form offers only admin methods, and the controls only an admin or a multisig signer", async () => {
  const { ADMIN_METHODS, canAdminister, planAny } = await import("../src/lib/admin.js");
  for (const [c, list] of Object.entries(ADMIN_METHODS)) {
    for (const m of list) assert.ok(abis[c].methods[m] && !abis[c].methods[m].read_only, c + "." + m + " is a write method");
  }
  assert.equal(ADMIN_METHODS.sponsor, undefined, "the sponsor's settings go through the deploy tool (L-17)");
  for (const [c, m] of [["stories", "contribute"], ["stories", "report_segment"], ["shop", "buy_pack"], ["shop", "claim_promo"], ["stories", "set_reading_place"]]) {
    throwsInput(() => planAny(abis, c, m, "{}"), /is not an admin method/);
  }
  assert.equal(planAny(abis, "stories", "set_paused", '{"paused":true}').method, "set_paused");
  const MS_SIGNER = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
  assert.equal(canAdminister(null, [A], []), false);
  assert.equal(canAdminister(B, [A], []), false);
  assert.equal(canAdminister(A, [A, C], []), true);
  assert.equal(canAdminister(MS_SIGNER, [A], [[B, MS_SIGNER, C]]), true);
  const { appSource, fnBody } = await import("./helpers/appSource.js");
  const page = fnBody(appSource().replace(/\r\n/g, "\n"), "renderAdmin");
  assert.ok(page.indexOf("canAdminister(") > 0 && page.indexOf("canAdminister(") < page.indexOf("emergencySection(d)"), "nothing is rendered before the check");
});
