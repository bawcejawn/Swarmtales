// Unit tests for deploy/lib.js. Run: node --test deploy/__tests__
// No network, no real keys. The key below is generated fresh each run.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const lib = require("../lib");

const ADDR_A = "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz";
const ADDR_B = "1C72FDL8NV3MHG7urVgXyvLBjMoC2WPJc6";

test("testnet is the default network", () => {
  const net = lib.resolveNetwork({});
  assert.strictEqual(net.key, "testnet");
  assert.strictEqual(net.mainnet, false);
  assert.strictEqual(net.rpc, "https://testnet.koinosfoundation.org");
});

test("mainnet is refused without the long flag", () => {
  assert.throws(() => lib.resolveNetwork({ network: "mainnet" }), /Refusing to use mainnet/);
  const net = lib.resolveNetwork({ network: "mainnet", "i-understand-this-is-mainnet": true });
  assert.strictEqual(net.mainnet, true);
});

test("the mainnet flag alone does not switch networks", () => {
  const net = lib.resolveNetwork({ "i-understand-this-is-mainnet": true });
  assert.strictEqual(net.key, "testnet");
});

test("unknown network and plain http are refused", () => {
  assert.throws(() => lib.resolveNetwork({ network: "harbinger" }), /Unknown network/);
  assert.throws(() => lib.resolveNetwork({ rpc: "http://example.com" }), /https/);
});

test("chain id mismatch stops the run", () => {
  const net = lib.resolveNetwork({});
  assert.doesNotThrow(() => lib.checkChainId(net, net.chainId));
  assert.throws(() => lib.checkChainId(net, lib.NETWORKS.mainnet.chainId), /Chain id mismatch/);
});

test("keys on the command line are refused", () => {
  for (const flag of ["--key", "--wif", "--private-key", "--seed", "--secret", "--password", "--KEY"]) {
    assert.throws(() => lib.parseArgs(["upload", "ink", flag, "abc"]), /Do not pass a key/);
  }
});

test("parseArgs reads positionals and flags", () => {
  const a = lib.parseArgs(["upload", "ink", "--expect", ADDR_A, "--network=testnet", "--dry"]);
  assert.strictEqual(a.command, "upload");
  assert.strictEqual(a.target, "ink");
  assert.strictEqual(a.flags.expect, ADDR_A);
  assert.strictEqual(a.flags.network, "testnet");
  assert.strictEqual(a.flags.dry, true);
});

test("address validation", () => {
  assert.ok(lib.isAddress(ADDR_A));
  assert.ok(!lib.isAddress("0x1234"));
  assert.ok(!lib.isAddress("1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFC0")); // 0 is not base58
  assert.throws(() => lib.requireAddress("", "expect"), /Missing expect/);
});

test("secret classification never echoes the secret", () => {
  const hex = crypto.randomBytes(32).toString("hex");
  assert.deepStrictEqual(lib.classifySecret("  " + hex + "\n"), { kind: "hex", value: hex });
  const fakeWif = "K" + "1".repeat(51);
  assert.strictEqual(lib.classifySecret(fakeWif).kind, "wif");
  const seed = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
  try {
    lib.classifySecret(seed);
    assert.fail("should throw");
  } catch (e) {
    assert.match(e.message, /seed phrase/);
    assert.ok(!e.message.includes("alpha"));
  }
  try {
    lib.classifySecret("notakey123");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(!e.message.includes("notakey123"));
  }
  assert.throws(() => lib.classifySecret(ADDR_A), /public address/);
  assert.throws(() => lib.classifySecret(""), /No key/);
});

test("signer address must match the expected address", () => {
  assert.doesNotThrow(() => lib.checkSignerAddress(ADDR_A, ADDR_A, "the Ink wallet"));
  assert.throws(() => lib.checkSignerAddress(ADDR_B, ADDR_A, "the Ink wallet"), /Wrong key/);
});

test("key from koilib derives the address we check against", () => {
  let koilib;
  try {
    koilib = require("koilib");
  } catch (e) {
    return; // koilib not installed: skip
  }
  const hex = crypto.randomBytes(32).toString("hex");
  const signer = new koilib.Signer({ privateKey: hex });
  const wif = signer.getPrivateKey("wif");
  const s = lib.classifySecret(wif);
  assert.strictEqual(s.kind, "wif");
  assert.strictEqual(koilib.Signer.fromWif(s.value).getAddress(), signer.getAddress());
  assert.throws(() => lib.checkSignerAddress(signer.getAddress(), ADDR_A, "x"), /Wrong key/);
});

test("mana formatting and rc limit", () => {
  assert.strictEqual(lib.formatMana("5000000000"), "50.0000");
  assert.strictEqual(lib.formatMana("12345678"), "0.1234");
  assert.strictEqual(lib.rcLimitFor("100000000", "5000000000"), "126000000");
  assert.strictEqual(lib.rcLimitFor("100000000", "110000000"), "110000000");
});

test("only SEND confirms", () => {
  assert.ok(lib.isConfirmation("SEND"));
  assert.ok(lib.isConfirmation(" SEND \n"));
  for (const a of ["send", "yes", "y", "", "SEND IT"]) assert.ok(!lib.isConfirmation(a));
});

test("Shop mint mask is PURCHASE+MEMBERSHIP+STARTER+PROMO and not REFUND", () => {
  const bit = (n) => 1 << n;
  assert.strictEqual(lib.SHOP_MINT_MASK, bit(1) + bit(2) + bit(3) + bit(4));
  assert.strictEqual(lib.SHOP_MINT_MASK & bit(5), 0);
});

test("test prices cover every item with a positive amount", () => {
  assert.deepStrictEqual(Object.keys(lib.TEST_PRICES).sort(), Object.keys(lib.SHOP_ITEMS).sort());
  for (const v of Object.values(lib.TEST_PRICES)) assert.ok(BigInt(v) > 0n);
});

test("generated .abi converts to koilib format", () => {
  const abi = lib.toKoilibAbi({
    methods: {
      set_admin: { argument: "ink.set_admin_arguments", return: "ink.empty_object", "entry-point": "0x313c25b4", "read-only": false },
      name: { argument: "ink.name_arguments", return: "ink.str", "entry-point": "0x82a3537f", "read-only": true },
    },
    types: "AAAA",
  });
  assert.strictEqual(abi.methods.set_admin.entry_point, 0x313c25b4);
  assert.strictEqual(abi.methods.name.read_only, true);
  assert.strictEqual(abi.types, "AAAA");
  assert.throws(() => lib.toKoilibAbi({ methods: {}, types: {} }), /expected format/);
});

test("deploy files never write the key anywhere", () => {
  const fs = require("fs");
  const path = require("path");
  for (const f of ["deploy.js", "lib.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(!/writeFile|appendFile|createWriteStream/.test(src), f + " must not write files");
  }
});

test("negative checks: contract rejections pass, infrastructure errors do not", () => {
  assert.strictEqual(lib.classifyRejection("INK: mint must come from an approved contract"), "PASS");
  assert.strictEqual(lib.classifyRejection("SHOP: admin authority required"), "PASS");
  assert.strictEqual(lib.classifyRejection("payer does not have the rc to cover transaction rc limit"), "INCONCLUSIVE");
  assert.strictEqual(lib.classifyRejection("contract does not exist"), "INCONCLUSIVE");
  assert.strictEqual(lib.classifyRejection("invalid nonce"), "INCONCLUSIVE");
  assert.strictEqual(lib.classifyRejection("request to https://x failed, reason: fetch failed"), "INCONCLUSIVE");
});

test("test promo fits the Shop's own rules", () => {
  const p = lib.TEST_PROMO;
  assert.ok(BigInt(p.amount) > 0n);
  assert.ok(BigInt(p.budget_total) >= BigInt(p.amount));
  assert.ok(BigInt(p.daily_cap) >= BigInt(p.amount));
});

// ---------- Stories helpers ----------

test("Stories may only mint refunds (mask 32, reason 5)", () => {
  assert.strictEqual(lib.STORIES_MINT_MASK, 32);
  assert.strictEqual(lib.STORIES_MINT_MASK, 1 << 5);
  assert.strictEqual(lib.STORIES_MINT_MASK & lib.SHOP_MINT_MASK, 0);
});

test("eleven story categories, no duplicates, each 1 to 32 characters", () => {
  assert.strictEqual(lib.STORY_CATEGORIES.length, 11);
  assert.strictEqual(new Set(lib.STORY_CATEGORIES).size, 11);
  for (const name of lib.STORY_CATEGORIES) {
    assert.ok(name.length >= 1 && name.length <= 32, name);
  }
});

test("inkCost follows the UTF-16 rule", () => {
  assert.strictEqual(lib.inkCost("a"), 1);
  assert.strictEqual(lib.inkCost("\u00E9"), 1);
  assert.strictEqual(lib.inkCost("e\u0301"), 2);
  assert.strictEqual(lib.inkCost("\uD83D\uDE00"), 2);
  assert.strictEqual(lib.inkCost("\u2764\uFE0F"), 2);
  assert.strictEqual(lib.inkCost("\u2B50"), 1);
  assert.strictEqual(lib.inkCost("\uD83D\uDC4D\uD83C\uDFFD"), 4);
  assert.strictEqual(lib.inkCost("\uD83C\uDDFA\uD83C\uDDF8"), 4);
  assert.strictEqual(lib.inkCost("\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67"), 8);
});

test("measurement text costs exactly the requested Ink and is valid story text", () => {
  for (const size of lib.MEASURE_SIZES) {
    for (const emoji of [false, true]) {
      const t = lib.measurementText(size, emoji);
      assert.strictEqual(lib.inkCost(t), size);
      assert.ok(!/\n/.test(t));
      assert.ok(!t.startsWith(" ") && !t.endsWith(" "));
      if (emoji) assert.ok(t.includes("\uD83D\uDE00"));
    }
  }
  assert.throws(() => lib.measurementText(0, false), lib.UserError);
});

test("shop.set_addresses arguments keep the on-chain treasury and founder", () => {
  const onChain = {
    treasury: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
    founder: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
    ink: "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x",
  };
  const stories = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww";
  const args = lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories });
  assert.deepStrictEqual(args, { treasury: onChain.treasury, founder: onChain.founder, ink: onChain.ink, stories });
  // Same Stories again is fine (re-running wire-stories).
  lib.shopAddressesForStories(Object.assign({ stories }, onChain), { ink: onChain.ink, stories });
});

test("test-write flags parse, including size, emoji and text", () => {
  const a = lib.parseArgs([
    "test-write",
    "--user", ADDR_A,
    "--ink", "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x",
    "--stories", "1JHakWJRXpAExjEuBik1posc8PXYYpugeN",
    "--story", "1",
    "--size", "100",
    "--emoji",
  ]);
  assert.strictEqual(a.command, "test-write");
  assert.strictEqual(a.flags.user, ADDR_A);
  assert.strictEqual(a.flags.ink, "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x");
  assert.strictEqual(a.flags.stories, "1JHakWJRXpAExjEuBik1posc8PXYYpugeN");
  assert.strictEqual(a.flags.story, "1");
  assert.strictEqual(a.flags.size, "100");
  assert.strictEqual(a.flags.emoji, true);
  const custom = lib.parseArgs(["test-write", "--text", "The second line of the test story."]);
  assert.strictEqual(custom.flags.text, "The second line of the test story.");
  assert.strictEqual(custom.flags.size, undefined);
});

test("story id and opener checks match the measure rule", () => {
  assert.strictEqual(lib.requireStoryId("1"), "1");
  assert.strictEqual(lib.requireStoryId(12), "12");
  assert.throws(() => lib.requireStoryId(undefined), /--story/);
  assert.throws(() => lib.requireStoryId("0"), /--story/);
  assert.throws(() => lib.requireStoryId("01"), /--story/);
  assert.doesNotThrow(() => lib.assertStoryOpener("1", ADDR_A, ADDR_A));
  assert.throws(() => lib.assertStoryOpener("1", ADDR_B, ADDR_A), /opened by/);
  assert.throws(() => lib.assertStoryOpener("1", "", ADDR_A), /nobody/);
});

const LIVE_WRITE = { cap: 4000, maxChars: "10000", usedChars: "42", balance: "10000" };

test("test-write defaults to 100 plain units inside the cap and the space left", () => {
  const plan = lib.planTestWrite({}, LIVE_WRITE);
  assert.strictEqual(plan.cost, "100");
  assert.strictEqual(plan.requested, "100");
  assert.strictEqual(plan.capped, false);
  assert.strictEqual(plan.custom, false);
  assert.strictEqual(plan.emoji, false);
  assert.strictEqual(plan.text, lib.measurementText(100, false));
  assert.strictEqual(plan.spaceLeft, "9958");
  assert.strictEqual(lib.DEFAULT_TEST_WRITE_SIZE, 100);
});

test("test-write caps generated size to the contribution cap and the space left", () => {
  const byCap = lib.planTestWrite({ size: "9000" }, LIVE_WRITE);
  assert.strictEqual(byCap.cost, "4000");
  assert.strictEqual(byCap.capped, true);
  assert.strictEqual(byCap.text, lib.measurementText(4000, false));

  const bySpace = lib.planTestWrite({ size: 500, emoji: true }, { cap: 4000, maxChars: "10000", usedChars: "9950", balance: "10000" });
  assert.strictEqual(bySpace.cost, "50");
  assert.strictEqual(bySpace.spaceLeft, "50");
  assert.strictEqual(bySpace.capped, true);
  assert.strictEqual(bySpace.emoji, true);
  assert.strictEqual(bySpace.text, lib.measurementText(50, true));
  assert.ok(bySpace.text.includes("\uD83D\uDE00"));
});

test("test-write refuses a low Ink balance and a story with no room", () => {
  assert.throws(
    () => lib.planTestWrite({ size: "100" }, { cap: 4000, maxChars: "10000", usedChars: "0", balance: "99" }),
    /Ink balance is 99 and this text costs 100/
  );
  assert.throws(
    () => lib.planTestWrite({ size: "500" }, { cap: 4000, maxChars: "10000", usedChars: "9950", balance: "40" }),
    /lowered from 500 to 50/
  );
  assert.throws(
    () => lib.planTestWrite({}, { cap: 4000, maxChars: "10000", usedChars: "10000", balance: "10000" }),
    /no space left/
  );
  assert.throws(() => lib.planTestWrite({}, { cap: 0, maxChars: "10000", usedChars: "0", balance: "100" }), /cap is 0/);
});

test("test-write custom text is sent whole or refused", () => {
  const text = "The second line of the test story.";
  const plan = lib.planTestWrite({ text }, LIVE_WRITE);
  assert.strictEqual(plan.custom, true);
  assert.strictEqual(plan.text, text);
  assert.strictEqual(plan.cost, String(text.length));
  assert.strictEqual(plan.capped, false);
  assert.throws(() => lib.planTestWrite({ text, size: "100" }, LIVE_WRITE), /either --text or --size/);
  assert.throws(() => lib.planTestWrite({ text, emoji: true }, LIVE_WRITE), /--emoji/);
  assert.throws(() => lib.planTestWrite({ text: "" }, LIVE_WRITE), /empty/);
  const tooLong = "a".repeat(4001);
  assert.throws(() => lib.planTestWrite({ text: tooLong }, LIVE_WRITE), /per-submission cap of 4000/);
  assert.throws(
    () => lib.planTestWrite({ text: "a".repeat(60) }, { cap: 4000, maxChars: "10000", usedChars: "9950", balance: "10000" }),
    /has 50 left/
  );
  assert.throws(
    () => lib.planTestWrite({ text: "hello" }, { cap: 4000, maxChars: "10000", usedChars: "0", balance: "4" }),
    /Ink balance is 4 and this text costs 5/
  );
});

test("test-write refuses a missing chain read before any text is chosen", () => {
  assert.throws(() => lib.planTestWrite({}, { maxChars: "10000", balance: "1" }), /per-submission cap/);
  assert.throws(() => lib.planTestWrite({}, { cap: 4000, balance: "1" }), /story's size/);
  assert.throws(() => lib.planTestWrite({}, { cap: 4000, maxChars: "10000" }), /Ink balance/);
  assert.throws(() => lib.planTestWrite({ size: "nope" }, LIVE_WRITE), /--size/);
});

test("deploy help documents test-write as testnet only", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
  assert.match(src, /test-write --user <addr> --ink <addr> --stories <addr> --story <id>/);
  assert.match(src, /test-write is for testnet only/);
  assert.match(src, /case "test-write"/);
});

test("test-write stops before any network call when arguments or the network are wrong", () => {
  const { spawnSync } = require("child_process");
  const path = require("path");
  const script = path.join(__dirname, "..", "deploy.js");
  const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const missing = run(["test-write"]);
  assert.notStrictEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing user/);
  const mainnet = run([
    "test-write",
    "--user", ADDR_A,
    "--ink", "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x",
    "--stories", "1JHakWJRXpAExjEuBik1posc8PXYYpugeN",
    "--story", "1",
    "--network", "mainnet",
    "--i-understand-this-is-mainnet",
  ]);
  assert.notStrictEqual(mainnet.status, 0);
  assert.match(mainnet.stderr, /test-write is for testnet only/);
  assert.doesNotMatch(mainnet.stdout + mainnet.stderr, /Chain id|Node:/);
});

test("shop.set_addresses arguments refuse anything that does not match the chain", () => {
  const onChain = {
    treasury: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
    founder: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
    ink: "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x",
  };
  const stories = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww";
  const other = "1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth";
  assert.throws(() => lib.shopAddressesForStories(onChain, { ink: other, stories }), lib.UserError);
  assert.throws(() => lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories, treasury: other }), lib.UserError);
  assert.throws(() => lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories, founder: other }), lib.UserError);
  assert.throws(() => lib.shopAddressesForStories(Object.assign({ stories: other }, onChain), { ink: onChain.ink, stories }), lib.UserError);
  assert.throws(() => lib.shopAddressesForStories({}, { ink: onChain.ink, stories }), lib.UserError);
});

test("promo and invite link messages match the contract byte layout", () => {
  // Fixed 25-byte address stand-ins.
  const shop = new Uint8Array(25).fill(1);
  const stories = new Uint8Array(25).fill(2);
  const account = new Uint8Array(25).fill(3);

  const promo = lib.promoMessage(shop, "3", account);
  assert.strictEqual(promo.length, 19 + 25 + 8 + 25);
  assert.strictEqual(Buffer.from(promo.slice(0, 19)).toString(), "swarmtales/promo/v1");
  // campaign id 3 as 8 big-endian bytes.
  assert.deepStrictEqual([...promo.slice(44, 52)], [0, 0, 0, 0, 0, 0, 0, 3]);

  const invite = lib.inviteMessage(stories, "12", "4", account);
  assert.strictEqual(invite.length, 20 + 25 + 8 + 8 + 25);
  assert.strictEqual(Buffer.from(invite.slice(0, 20)).toString(), "swarmtales/invite/v1");
  assert.deepStrictEqual([...invite.slice(45, 53)], [0, 0, 0, 0, 0, 0, 0, 12]);
  assert.deepStrictEqual([...invite.slice(53, 61)], [0, 0, 0, 0, 0, 0, 0, 4]);

  // sha256 returns 32 bytes.
  assert.strictEqual(lib.sha256(promo).length, 32);
});

test("moderation reasons map to the contract's numbers", () => {
  assert.strictEqual(lib.requireReason("copyright"), 1);
  assert.strictEqual(lib.requireReason("Duplicate"), 2);
  assert.strictEqual(lib.requireReason("other"), 5);
  assert.throws(() => lib.requireReason("rude"), /--reason must be one of/);
  assert.throws(() => lib.requireReason(undefined), /--reason must be one of/);
});
