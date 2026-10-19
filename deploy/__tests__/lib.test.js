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
  assert.ok(p.code.length > 0 && p.code.length <= 64);
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
