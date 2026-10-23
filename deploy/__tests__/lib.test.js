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
  const a = lib.parseArgs(["upload", "ink", "--expect", ADDR_A, "--network=testnet", "--upgrade"]);
  assert.strictEqual(a.command, "upload");
  assert.strictEqual(a.target, "ink");
  assert.strictEqual(a.flags.expect, ADDR_A);
  assert.strictEqual(a.flags.network, "testnet");
  assert.strictEqual(a.flags.upgrade, true);
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
  const libSrc = fs.readFileSync(path.join(__dirname, "..", "lib.js"), "utf8");
  assert.ok(!/writeFile|appendFile|createWriteStream|renameSync/.test(libSrc), "lib.js must not write files");
  // deploy.js writes exactly one kind of file: a prepared multisig transaction
  // (lib.preparedFile: header, operations, signatures), in one function.
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
  assert.ok(!/appendFile|createWriteStream/.test(src));
  assert.strictEqual(src.split("writeFileSync(").length - 1, 1, "one write site");
  const start = src.indexOf("function writeTxFile(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes("writeFileSync("), "the write is inside writeTxFile");
  const calls = src.split("writeTxFile(").slice(1).map((s) => s.split(")")[0]);
  assert.deepStrictEqual(calls.slice(1).sort(), ["file, data, true", "session.prepare, file, false"].sort());
  assert.match(src, /const file = lib\.preparedFile\(net, tx, described, session\.args\.command\);/);
  // What preparedFile keeps: nothing but the network, the description and the transaction.
  const f = lib.preparedFile({ key: "testnet", chainId: "x" }, { id: "0x", header: {}, operations: [] }, [], "pause");
  assert.deepStrictEqual(Object.keys(f).sort(), ["chain_id", "command", "format", "network", "operations", "prepared_at", "transaction"]);
  assert.deepStrictEqual(Object.keys(f.transaction).sort(), ["header", "id", "operations", "signatures"]);
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
  const { COMMANDS } = require("../deploy");
  assert.strictEqual(COMMANDS["test-write"].testnet, true);
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

// ---------- AB-006: the wasm is checked against a known sha256 ----------

const WASM = Buffer.from("pretend this is contract.wasm");
const WASM_SHA = crypto.createHash("sha256").update(WASM).digest("hex");

test("testnet uploads any build and says whether it is the pinned release", () => {
  assert.strictEqual(lib.checkWasmHash(WASM, "ink", { ink: "", shop: "", stories: "" }, false), null);
  assert.strictEqual(lib.checkWasmHash(WASM, "ink", { ink: WASM_SHA, shop: "", stories: "" }, false), true);
  assert.strictEqual(lib.checkWasmHash(Buffer.from("x"), "ink", { ink: WASM_SHA, shop: "", stories: "" }, false), false);
});

test("O1-13: mainnet compares with the pinned file, never a typed hash, and never prints a hash to paste", () => {
  const other = crypto.createHash("sha256").update("a different build").digest("hex");
  const pinned = { ink: other, shop: "", stories: "" };
  for (const [role, rel] of [["ink", pinned], ["shop", pinned]]) {
    try {
      lib.checkWasmHash(WASM, role, rel, true);
      assert.fail("accepted");
    } catch (e) {
      assert.ok(e instanceof lib.UserError);
      assert.ok(!/[0-9a-f]{64}/i.test(e.message), "the error shows a hash: " + e.message);
    }
  }
  assert.throws(() => lib.parseArgs(["upload", "ink", "--expect-sha256", WASM_SHA]), /release-hashes\.json/);
  // The file in the repository loads (placeholders are allowed until the release).
  const fs = require("fs");
  const path = require("path");
  const file = lib.parseReleaseHashes(fs.readFileSync(path.join(__dirname, "..", "release-hashes.json"), "utf8"));
  assert.deepStrictEqual(Object.keys(file).sort(), ["ink", "shop", "sponsor", "stories"]);
  assert.throws(() => lib.parseReleaseHashes('{"ink":"","shop":"","stories":"","extra":""}'), /unknown entry/);
  assert.throws(() => lib.parseReleaseHashes("{"), /not valid JSON/);
});

// ---------- AB-009: on mainnet, trust only the listed node ----------

const MAINNET = { network: "mainnet", "i-understand-this-is-mainnet": true };

test("mainnet refuses a --rpc override that is not a listed node", () => {
  assert.throws(() => lib.resolveNetwork(Object.assign({ rpc: "https://evil.example.com" }, MAINNET)), /--rpc/);
  assert.strictEqual(lib.resolveNetwork(Object.assign({ rpc: "https://api.koinos.io" }, MAINNET)).rpc, "https://api.koinos.io");
  // Testnet still takes any https node.
  assert.strictEqual(lib.resolveNetwork({ rpc: "https://my-node.example.com" }).rpc, "https://my-node.example.com");
});

test("on mainnet, wire-stories needs --treasury and --founder instead of trusting the node", () => {
  const onChain = {
    treasury: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
    founder: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
    ink: "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x",
  };
  const stories = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww";
  assert.throws(() => lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories, mainnet: true }), /--treasury and --founder/);
  assert.throws(() => lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories, treasury: onChain.treasury, mainnet: true }), /--treasury and --founder/);
  const args = lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories, treasury: onChain.treasury, founder: onChain.founder, mainnet: true });
  assert.strictEqual(args.treasury, onChain.treasury);
  // Testnet keeps reading them from the chain.
  assert.strictEqual(lib.shopAddressesForStories(onChain, { ink: onChain.ink, stories }).founder, onChain.founder);
});

// ---------- AB-013: link keys stay out of shell history; strong randomness ----------

test("a link key on the command line is refused: it would land in shell history", () => {
  assert.throws(() => lib.parseArgs(["claim-promo", "--link-key", "5KwdXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"]), /hidden prompt/);
  assert.throws(() => lib.parseArgs(["claim-promo", "--link-key=abc"]), /hidden prompt/);
  assert.throws(() => lib.parseArgs(["claim-promo", "--link-key"]), /hidden prompt/);
});

test("claim-promo and the other test commands refuse mainnet", () => {
  assert.throws(() => lib.requireTestnet({ mainnet: true }, "claim-promo"), /claim-promo is for testnet only/);
  lib.requireTestnet({ mainnet: false }, "claim-promo");
});

test("link keys are 32 bytes from crypto.randomBytes", () => {
  const real = crypto.randomBytes;
  crypto.randomBytes = (n) => Buffer.alloc(n, 7);
  try {
    assert.strictEqual(lib.newLinkKeyHex(), "07".repeat(32));
  } finally {
    crypto.randomBytes = real;
  }
  assert.match(lib.newLinkKeyHex(), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(lib.newLinkKeyHex(), lib.newLinkKeyHex());
});

test("takedown: a part nobody else changed needs no choice; a changed part does (AB-028, AB-029)", () => {
  const ADDR_C = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";
  // Never changed, or changed only by its writer's own free edit: automatic.
  let who = lib.takedownStrike({ author: ADDR_A }, [], "", false);
  assert.deepStrictEqual([who.writer, who.changed, who.needsChoice, who.changers], [ADDR_A, false, false, []]);
  who = lib.takedownStrike({ author: ADDR_A, last_edited_by: ADDR_A }, [], "", false);
  assert.strictEqual(who.needsChoice, false);
  // An editor removed the hidden part: no words changed, still automatic.
  who = lib.takedownStrike({ author: ADDR_A, last_edited_by: ADDR_B }, [], "", false);
  assert.strictEqual(who.needsChoice, false);
  // Two other wallets revised it: both are listed, and a choice is needed.
  const versions = [
    { version: 1, kind: 1, by: ADDR_A, text: "original", at: "1700000000" },
    { version: 2, kind: 2, by: ADDR_B, text: "planted", at: "1700000100" },
    { version: 3, kind: 2, by: ADDR_C, text: "planted!", at: "1700000200" },
  ];
  who = lib.takedownStrike({ author: ADDR_A, edited_by_others: true, version_count: 3, last_edited_by: ADDR_C }, versions, "", false);
  assert.deepStrictEqual([who.changed, who.needsChoice, who.changers], [true, true, [ADDR_B, ADDR_C]]);
  // The finalizer's edit keeps no version: last_edited_by shows who it was.
  who = lib.takedownStrike({ author: ADDR_A, edited_by_others: true, last_edited_by: ADDR_B }, [], "", false);
  assert.deepStrictEqual([who.needsChoice, who.changers], [true, [ADDR_B]]);
  // A paid change counts; the writer's own edits (also versions now, AB-033) do not.
  assert.strictEqual(lib.takedownStrike({ author: ADDR_A, paid_changes: 1 }, [], "", false).needsChoice, true);
  assert.strictEqual(lib.takedownStrike({ author: ADDR_A, version_count: 3 },
    [{ version: 1, kind: 1, by: ADDR_A }, { version: 2, kind: 4, by: ADDR_A }, { version: 3, kind: 4, by: ADDR_A }], "", false).needsChoice, false);
  // Once the admin chooses, it may go ahead; both choices at once are refused.
  assert.strictEqual(lib.takedownStrike({ author: ADDR_A, edited_by_others: true }, [], ADDR_B, false).needsChoice, false);
  assert.strictEqual(lib.takedownStrike({ author: ADDR_A, edited_by_others: true }, [], "", true).needsChoice, false);
  assert.throws(() => lib.takedownStrike({ author: ADDR_A }, [], ADDR_B, true), /--strike or --no-strike, not both/);
  // The history the admin compares, oldest first.
  const lines = lib.versionHistory(versions);
  assert.strictEqual(lines.length, 3);
  assert.match(lines[0], /^ {2}v1 original by 1Dde.* at 2023-11-14T22:13:20Z: "original"$/);
  assert.match(lines[2], /v3 changed by 1NRN.*"planted!"$/);
  // Versions are printed in full (AB-033), never cut at 160 characters.
  assert.match(lib.versionHistory([{ version: 2, kind: 2, by: ADDR_B, text: "x".repeat(200), at: "0" }])[0], /at \?: "x{200}"$/);
});

test("takedown --no-strike reaches the operation through the built ABI", async () => {
  const { Contract } = require("koilib");
  const fs = require("fs");
  const path = require("path");
  const abi = lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "stories", "abi", "stories.abi"), "utf8")));
  const c = new Contract({ id: "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt", abi });
  for (const noStrike of [true, false]) {
    const op = await c.encodeOperation({ name: "takedown_segment", args: { story_id: "1", seq: "2", reason: 1, note: "n", strike: "", no_strike: noStrike } });
    assert.strictEqual(!!(await c.decodeOperation(op)).args.no_strike, noStrike);
  }
});

test("takedown: every wallet the contract recorded is a candidate, citation-only ones too (AB-048, AB-052)", () => {
  const ADDR_C = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";
  // Only a citation by ADDR_B: no version, last_edited_by is still the writer.
  let who = lib.takedownStrike({ author: ADDR_A, edited_by_others: true, last_edited_by: ADDR_A }, [], "", false, [ADDR_B]);
  assert.deepStrictEqual([who.needsChoice, who.changers, who.unseen], [true, [ADDR_B], false]);
  assert.ok(who.candidates.includes(ADDR_B));
  // A changed part with no changer to name: the admin is told someone it can't name exists.
  who = lib.takedownStrike({ author: ADDR_A, edited_by_others: true, last_edited_by: ADDR_A }, [], "", false);
  assert.deepStrictEqual([who.unseen, who.candidates[who.candidates.length - 1]], [true, lib.UNSEEN_CHANGER]);
  // A part revised before edited_by_others existed: the versions show the change.
  who = lib.takedownStrike({ author: ADDR_A, version_count: 2 },
    [{ version: 1, kind: 1, by: ADDR_A }, { version: 2, kind: 2, by: ADDR_C }], "", false);
  assert.deepStrictEqual([who.changed, who.needsChoice, who.changers], [true, true, [ADDR_C]]);
});

test("wire: set-once addresses refuse a different value, accept the same or an empty one (AB-050)", () => {
  assert.doesNotThrow(() => lib.requireSetOnce("Shop's Ink address", "", ADDR_A));
  assert.doesNotThrow(() => lib.requireSetOnce("Shop's Ink address", ADDR_A, ADDR_A));
  assert.throws(() => lib.requireSetOnce("Shop's Ink address", ADDR_A, ADDR_B), /can never be changed/);
});
