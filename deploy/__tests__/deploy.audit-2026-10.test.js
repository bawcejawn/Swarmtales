// audit-2026-10 (16de9dc) off-chain fixes in the deploy tool: M-6 pinned
// mainnet addresses and code hashes, M-12 multisig prepare / cosign / submit,
// O1-10 to O1-14, F-07 replace-pdf, reviewed takedowns, the Shop's min_ink and
// 7-day token wait, and prepare-testnet.js on the safe path.
// No network and no real keys: commands run in-process against a fake node.
// Run: node --test deploy/__tests__/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const koilib = require("koilib");
const lib = require("../lib");
const deploy = require("../deploy");

const REPO = path.join(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "..", "deploy.js");
const TESTNET = lib.NETWORKS.testnet;
const MAINNET_FLAGS = ["--network", "mainnet", "--i-understand-this-is-mainnet"];

const INK = "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz";
const SHOP = "1C72FDL8NV3MHG7urVgXyvLBjMoC2WPJc6";
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const TOKEN = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";
const OTHER = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";
const BOB = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
const KEY1 = koilib.Signer.fromSeed("swarmtales test signer 1");
const KEY2 = koilib.Signer.fromSeed("swarmtales test signer 2");
const MULTISIG = koilib.Signer.fromSeed("swarmtales test multisig").getAddress();
const PAYER = koilib.Signer.fromSeed("swarmtales test mana payer");

function withPins(pins, fn) {
  const saved = Object.assign({}, lib.MAINNET_PINNED);
  Object.assign(lib.MAINNET_PINNED, pins);
  const restore = () => Object.assign(lib.MAINNET_PINNED, saved);
  try {
    const r = fn();
    if (r && typeof r.then === "function") return r.finally(restore);
    restore();
    return r;
  } catch (e) {
    restore();
    throw e;
  }
}

const ABI = (target) => lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(REPO, target === "ink" ? "abi" : target, "abi", target + ".abi"), "utf8")));

/** A fake Koinos node. `reads` maps "contract.method" to a result (or a function of the args). */
function fakeNode(net, opts = {}) {
  const log = { constructed: 0, sent: [], reads: [] };
  const byAddr = { [opts.ink || INK]: "ink", [opts.shop || SHOP]: "shop", [opts.stories || STORIES]: "stories" };
  class FakeProvider {
    constructor() { log.constructed++; }
    async getChainId() { return net.chainId; }
    async getAccountRc() { return opts.rc || "1000000000"; }
    async call(method, params) {
      if (method === "mempool.get_reserved_account_rc") return { rc: "0" };
      if (method === "contract_meta_store.get_contract_meta") return (opts.contractAccounts || []).includes(params.contract_id) ? { meta: { abi: "" } } : {};
      throw new Error("unexpected node call " + method);
    }
    async getNextNonce() { return "OAU="; }
    async invokeGetContractMetadata(id) {
      if (!opts.codeHash) throw new Error("invoke_system_call not available");
      return { value: { hash: "0x1220" + opts.codeHash(id) } };
    }
    async readContract(call) {
      const target = byAddr[call.contract_id];
      const c = new koilib.Contract({ id: call.contract_id, abi: ABI(target) });
      const { name, args } = await c.decodeOperation({ call_contract: call });
      log.reads.push(target + "." + name);
      let value = (opts.reads || {})[target + "." + name];
      if (typeof value === "function") value = value(args);
      if (value === undefined) throw new Error("no fake read for " + target + "." + name);
      return { result: koilib.utils.encodeBase64url(await c.serializer.serialize(value, c.abi.methods[name].return)) };
    }
    async sendTransaction(tx, broadcast) {
      log.sent.push({ tx: JSON.parse(JSON.stringify(tx)), broadcast });
      return { receipt: { rc_used: "1000", reverted: false, logs: [] }, transaction: tx };
    }
    async wait() { return { blockNumber: 7 }; }
  }
  return { FakeProvider, log };
}

/** Run one deploy.js command in-process. Returns { error, prepared, out }. */
async function run(argv, { node, answers = [], release, secret } = {}) {
  const out = [];
  const origLog = console.log;
  const origWrite = process.stdout.write;
  const origSecret = process.env[lib.SECRET_ENV];
  console.log = (...a) => out.push(a.join(" "));
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  if (secret) process.env[lib.SECRET_ENV] = secret;
  else delete process.env[lib.SECRET_ENV];
  Object.assign(deploy.seams, { Provider: node ? node.FakeProvider : null, readLine: () => answers.shift(), releaseHashes: release || null });
  try {
    await deploy.main(argv);
    return { out: out.join("\n") };
  } catch (e) {
    if (e instanceof deploy.Prepared) return { prepared: true, out: out.join("\n") };
    return { error: e, out: out.join("\n") };
  } finally {
    console.log = origLog;
    process.stdout.write = origWrite;
    if (origSecret === undefined) delete process.env[lib.SECRET_ENV];
    else process.env[lib.SECRET_ENV] = origSecret;
    Object.assign(deploy.seams, { Provider: null, readLine: null, releaseHashes: null });
  }
}

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmtales-deploy-"));
  return path.join(dir, name);
}

async function protoAbi(target) {
  const { buildAbi } = await import(pathToFileURL(path.join(REPO, "web", "scripts", "build-abi.mjs")).href);
  return buildAbi({ ink: "assembly/proto/ink.proto", shop: "shop/assembly/proto/shop.proto", stories: "stories/assembly/proto/stories.proto" }[target]);
}

// ---------------------------------------------------------------- M-6

test("M-6: wire-stories with a wrong address on the mainnet profile is refused before the node is contacted", async () => {
  await withPins({ ink: INK, shop: SHOP, stories: STORIES, token: TOKEN }, async () => {
    const node = fakeNode(lib.NETWORKS.mainnet);
    const base = ["wire-stories", ...MAINNET_FLAGS, "--admin", BOB, "--treasury", BOB, "--founder", BOB];
    for (const [flag, good] of [["--stories", STORIES], ["--shop", SHOP], ["--ink", INK]]) {
      const argv = base.concat(["--ink", INK, "--shop", SHOP, "--stories", STORIES]);
      argv[argv.lastIndexOf(flag) + 1] = OTHER;
      const r = await run(argv, { node });
      assert.ok(r.error, flag + " " + OTHER + " was accepted");
      assert.match(r.error.message, new RegExp("must be the pinned address, but the pinned mainnet " + flag.slice(2) + " address is " + good));
    }
    assert.strictEqual(node.log.constructed, 0, "the node was contacted before the address check");
  });
});

test("M-6: with nothing pinned yet, mainnet refuses every contract address except a first upload", async () => {
  const node = fakeNode(lib.NETWORKS.mainnet);
  const r = await run(["pause", "stories", ...MAINNET_FLAGS, "--contract", STORIES, "--admin", BOB], { node });
  assert.match(r.error.message, /no mainnet stories address is pinned in deploy\/lib\.js yet/);
  assert.strictEqual(node.log.constructed, 0);
  const net = lib.resolveNetwork({ network: "mainnet", "i-understand-this-is-mainnet": true });
  assert.strictEqual(lib.checkPinned(net, "stories", STORIES, {}, true), null, "upload may name a new address");
  withPins({ stories: STORIES }, () => {
    assert.throws(() => lib.checkPinned(net, "stories", OTHER, {}, true), /pinned mainnet stories address is/);
    assert.match(lib.checkPinned(net, "stories", OTHER, { "i-understand-this-address-is-not-pinned": true }, false), /^WARNING/);
  });
  // --contract on mainnet needs to know which contract it is.
  assert.throws(() => lib.checkPinnedFlags(net, { contract: STORIES }, undefined), /Say which contract/);
  // Testnet never checks pins.
  assert.deepStrictEqual(lib.checkPinnedFlags(lib.resolveNetwork({}), { stories: OTHER, contract: OTHER }, "ink"), []);
  // The table itself only takes "" or an address.
  assert.ok(Object.keys(lib.MAINNET_PINNED).sort().join() === "ink,shop,stories,token");
});

test("M-6: wire-stories checks each contract's code hash against the release hashes on mainnet", async () => {
  const H = crypto.createHash("sha256").update("release").digest("hex");
  const BAD = crypto.createHash("sha256").update("not the release").digest("hex");
  const release = { ink: H, shop: H, stories: H };
  const argv = ["wire-stories", ...MAINNET_FLAGS, "--admin", BOB, "--ink", INK, "--shop", SHOP, "--stories", STORIES, "--treasury", BOB, "--founder", BOB];
  await withPins({ ink: INK, shop: SHOP, stories: STORIES }, async () => {
    // Stories runs other code: refused, before any setting is read or key asked.
    let node = fakeNode(lib.NETWORKS.mainnet, { codeHash: (id) => (id === STORIES ? BAD : H) });
    let r = await run(argv, { node, release });
    assert.match(r.error.message, /NOT the reviewed stories release build/);
    assert.ok(!/[0-9a-f]{64}/.test(r.error.message), "no hash to paste");
    assert.deepStrictEqual(node.log.reads, []);
    // The node gives no hash: refused, with the reason, unless the loud override is given.
    node = fakeNode(lib.NETWORKS.mainnet);
    r = await run(argv, { node, release });
    assert.match(r.error.message, /did not return the code hash of ink[\s\S]*i-understand-the-code-hash-is-not-verified/);
    r = await run(argv.concat(["--i-understand-the-code-hash-is-not-verified"]), { node, release });
    assert.match(r.out, /WARNING: The node did not return the code hash/);
    assert.match(r.error.message, /no fake read for shop\.get_config/, "with the override it goes on to read the settings");
    // A mismatch is never overridable.
    node = fakeNode(lib.NETWORKS.mainnet, { codeHash: () => BAD });
    r = await run(argv.concat(["--i-understand-the-code-hash-is-not-verified"]), { node, release });
    assert.match(r.error.message, /NOT the reviewed ink release build/);
    // No release hash pinned: nothing can be checked, so mainnet wiring stops.
    r = await run(argv, { node, release: { ink: "", shop: "", stories: "" } });
    assert.match(r.error.message, /No release hash is pinned for ink/);
    // The right code passes on to the chain reads.
    node = fakeNode(lib.NETWORKS.mainnet, { codeHash: () => H });
    r = await run(argv, { node, release });
    assert.match(r.out, /stories at 16adhn.*the reviewed release build \(code hash checked\)/);
    assert.match(r.error.message, /no fake read for shop\.get_config/);
  });
  assert.strictEqual(lib.codeHashFromMeta({ value: { hash: "0x1220" + H.toUpperCase() } }), H);
  assert.strictEqual(lib.codeHashFromMeta({ value: { hash: "0x1220abc" } }), null);
  assert.strictEqual(lib.codeHashFromMeta({}), null);
  assert.strictEqual(lib.checkCodeHash(TESTNET, "ink", INK, BAD, release, {}).startsWith("Note:"), true, "testnet only notes it");
});

test("M-6 / info: a key for a pinned mainnet contract is refused on testnet", () => {
  withPins({ shop: KEY1.getAddress() }, () => {
    assert.throws(() => lib.refuseCrossNetworkKey(TESTNET, KEY1.getAddress()), /pinned MAINNET shop address/);
    assert.doesNotThrow(() => lib.refuseCrossNetworkKey(lib.NETWORKS.mainnet, KEY1.getAddress()));
  });
});

// ---------------------------------------------------------------- M-12

async function preparePause(file, extra = []) {
  const node = fakeNode(TESTNET);
  const r = await run(["pause", "stories", "--contract", STORIES, "--admin", MULTISIG, "--prepare", file, ...extra], { node });
  return { r, node };
}

test("M-12: --prepare builds the unsigned transaction and writes it, without asking for a key", async () => {
  const file = tmpFile("pause.json");
  const { r } = await preparePause(file);
  assert.ok(r.prepared, r.error && r.error.message);
  assert.doesNotMatch(r.out, /PRIVATE KEY|Paste/);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(data.format, lib.PREPARED_FORMAT);
  assert.strictEqual(data.network, "testnet");
  assert.deepStrictEqual(data.transaction.signatures, []);
  const h = data.transaction.header;
  assert.deepStrictEqual([h.payer, h.payee, h.chain_id, h.rc_limit, lib.nonceNumber(h.nonce)], [MULTISIG, undefined, TESTNET.chainId, lib.DEFAULT_PREPARED_RC, "5"]);
  assert.deepStrictEqual(data.operations, [{ contract: "stories", contract_id: STORIES, method: "set_paused", args: { paused: true } }]);
  assert.match(r.out, /1\. stories 16adhn\S* \.set_paused[\s\S]*\{"paused":true\}/);
  assert.match(r.out, /cosign/);
  // Never over an existing file.
  const again = await preparePause(file);
  assert.match(again.r.error.message, /already exists/);
});

test("M-12: a separate mana payer, a payee and a mana limit go in the header", async () => {
  const file = tmpFile("payer.json");
  const { r } = await preparePause(file, ["--payer", PAYER.getAddress(), "--payee", MULTISIG, "--rc-limit", "0.5"]);
  assert.ok(r.prepared, r.error && r.error.message);
  const h = JSON.parse(fs.readFileSync(file, "utf8")).transaction.header;
  assert.deepStrictEqual([h.payer, h.payee, h.rc_limit], [PAYER.getAddress(), MULTISIG, "50000000"]);
  assert.match(r.out, /The payer .* must cosign too/);
  // More than the payer has is refused; without --prepare the multisig flags are refused.
  const over = await preparePause(tmpFile("over.json"), ["--rc-limit", "11"]);
  assert.match(over.r.error.message, /--rc-limit is more than/);
  const stray = await run(["pause", "stories", "--contract", STORIES, "--admin", MULTISIG, "--payer", BOB]);
  assert.match(stray.error.message, /only go with --prepare/);
  // A command that isn't an admin command can't be prepared.
  const user = await run(["test-buy", "--user", BOB, "--shop", SHOP, "--prepare", tmpFile("x.json")]);
  assert.match(user.error.message, /does not use --prepare/);
  assert.throws(() => lib.parseMana("0", "--rc-limit"), /more than 0/);
  assert.throws(() => lib.parseMana("1.123456789", "--rc-limit"), /amount of mana/);
});

test("M-12: cosign shows every operation, adds one signature per key, and refuses repeats", async () => {
  const file = tmpFile("cosign.json");
  await preparePause(file);
  let r = await run(["cosign", file], { answers: ["no"], secret: KEY1.getPrivateKey("wif") });
  assert.match(r.error.message, /Nothing was signed/);
  assert.match(r.out, /set_paused[\s\S]*\{"paused":true\}/, "the summary was shown before the question");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")).transaction.signatures, []);
  r = await run(["cosign", file], { answers: ["SIGN"], secret: KEY1.getPrivateKey("wif") });
  assert.ok(!r.error, r.error && r.error.message);
  r = await run(["cosign", file], { answers: ["SIGN"], secret: KEY1.getPrivateKey("wif") });
  assert.match(r.error.message, /already signed/);
  r = await run(["cosign", file], { answers: ["SIGN"], secret: KEY2.getPrivateKey("wif") });
  assert.ok(!r.error, r.error && r.error.message);
  const tx = JSON.parse(fs.readFileSync(file, "utf8")).transaction;
  assert.deepStrictEqual(await koilib.Signer.recoverAddresses(tx), [KEY1.getAddress(), KEY2.getAddress()]);
  assert.ok(!fs.readFileSync(file, "utf8").includes(KEY1.getPrivateKey("wif")), "a key was written to the file");
  // A testnet file is refused on mainnet, and the other way round.
  r = await run(["cosign", file, ...MAINNET_FLAGS], { answers: ["SIGN"], secret: KEY2.getPrivateKey("wif") });
  assert.match(r.error.message, /That file is for testnet/);
});

test("M-12: cosign refuses a file whose chain id, contract, entry point or arguments don't match what it decodes", async () => {
  const file = tmpFile("tamper.json");
  await preparePause(file);
  const good = fs.readFileSync(file, "utf8");
  const cases = [
    ["arguments bytes", (d) => { d.transaction.operations[0].call_contract.args = "CAA="; }, /was changed/],
    ["described arguments", (d) => { d.operations[0].args = { paused: false }; }, /arguments are not the ones it describes/],
    ["described method", (d) => { d.operations[0].method = "accept_admin"; }, /different entry point/],
    ["described contract", (d) => { d.operations[0].contract_id = OTHER; }, /calls 16adhn\S* but says/],
    ["contract name", (d) => { d.operations[0].contract = "token"; }, /not a call to Ink, Shop or Stories/],
    ["mana limit", (d) => { d.transaction.header.rc_limit = "900000000"; }, /was changed/],
    ["chain id", (d) => { d.transaction.header.chain_id = lib.NETWORKS.mainnet.chainId; }, /chain id/],
    ["extra header field", (d) => { d.transaction.header.extra = "x"; }, /unexpected field 'extra'/],
    ["upload operation", (d) => { d.transaction.operations[0] = { upload_contract: { contract_id: STORIES, bytecode: "AA==" } }; }, /not a contract call|was changed/],
    ["read-only method", (d) => { d.operations[0].method = "get_config"; }, /no write method/],
    ["not a prepared file", (d) => { d.format = "something else"; }, /not a SwarmTales prepared transaction/],
  ];
  for (const [label, change, why] of cases) {
    const d = JSON.parse(good);
    change(d);
    fs.writeFileSync(file, JSON.stringify(d));
    const r = await run(["cosign", file], { answers: ["SIGN"], secret: KEY1.getPrivateKey("wif") });
    assert.ok(r.error, label + " was signed");
    assert.match(r.error.message, why, label);
    assert.strictEqual(fs.readFileSync(file, "utf8"), JSON.stringify(d), label + ": the file was changed");
  }
});

test("M-12: on mainnet, cosign only signs calls to the pinned contracts", async () => {
  const net = lib.resolveNetwork({ network: "mainnet", "i-understand-this-is-mainnet": true });
  const c = deploy.contractOf("stories", STORIES, null);
  const op = await c.encodeOperation({ name: "set_paused", args: { paused: true } });
  const tx = { header: { chain_id: net.chainId, rc_limit: "100000000", nonce: "OAE=", payer: MULTISIG }, operations: [op] };
  await koilib.Transaction.prepareTransaction(tx);
  const file = lib.preparedFile(net, tx, [{ contract: "stories", contract_id: STORIES, method: "set_paused", args: { paused: true } }], "pause");
  const deps = (flags) => ({ koilib, abiFor: ABI, flags });
  await assert.rejects(lib.verifyPrepared(file, net, deps({})), /no mainnet stories address is pinned/);
  await withPins({ stories: OTHER }, () => assert.rejects(lib.verifyPrepared(file, net, deps({})), /pinned mainnet stories address is/));
  await withPins({ stories: STORIES }, async () => {
    const ok = await lib.verifyPrepared(file, net, deps({}));
    assert.deepStrictEqual(ok.ops.map((o) => [o.contract, o.method, o.args]), [["stories", "set_paused", { paused: true }]]);
    assert.deepStrictEqual(ok.warnings, []);
  });
  const warned = await lib.verifyPrepared(file, net, deps({ "i-understand-this-address-is-not-pinned": true }));
  assert.match(warned.warnings[0], /^WARNING/);
});

test("M-12: submit joins copies signed on different computers, dry runs, then sends after SEND", async () => {
  const a = tmpFile("a.json");
  await preparePause(a);
  const b = a.replace(/a\.json$/, "b.json");
  fs.copyFileSync(a, b);
  await run(["cosign", a], { answers: ["SIGN"], secret: KEY1.getPrivateKey("wif") });
  await run(["cosign", b], { answers: ["SIGN"], secret: KEY2.getPrivateKey("wif") });
  await run(["cosign", b], { answers: ["SIGN"], secret: KEY1.getPrivateKey("wif") }); // KEY1 in both copies
  // The multisig pays for itself (a contract wallet), so no other payer signature is needed.
  let node = fakeNode(TESTNET, { contractAccounts: [MULTISIG] });
  let r = await run(["submit", a, b], { node, answers: ["no"] });
  assert.match(r.error.message, /Nothing was sent for real/);
  assert.deepStrictEqual(node.log.sent.map((s) => s.broadcast), [false], "only the dry run");
  node = fakeNode(TESTNET, { contractAccounts: [MULTISIG] });
  r = await run(["submit", a, b], { node, answers: ["SEND"] });
  assert.ok(!r.error, r.error && r.error.message);
  assert.deepStrictEqual(node.log.sent.map((s) => s.broadcast), [false, true]);
  const sent = node.log.sent[1].tx;
  assert.deepStrictEqual(await koilib.Signer.recoverAddresses(sent), [KEY1.getAddress(), KEY2.getAddress()], "each signer once");
  assert.match(r.out, /included in block 7/);
  // A normal-wallet payer that has not signed is refused before the dry run.
  node = fakeNode(TESTNET);
  r = await run(["submit", a], { node, answers: ["SEND"] });
  assert.match(r.error.message, /payer .* has not signed/);
  assert.deepStrictEqual(node.log.sent, []);
  // Two different transactions can't be joined.
  const c = tmpFile("c.json");
  await preparePause(c, ["--rc-limit", "1"]);
  r = await run(["submit", a, c], { node: fakeNode(TESTNET, { contractAccounts: [MULTISIG] }), answers: ["SEND"] });
  assert.match(r.error.message, /different transaction/);
});

test("M-12: prepare works for every admin command and for no other", () => {
  const admin = ["set-admin", "accept-admin", "pause", "unpause", "wire", "wire-stories", "set-asset", "promo-new", "promo-on", "promo-off",
    "promo-end", "stories-limits", "set-terms", "set-moderation", "hide", "takedown", "replace-pdf", "block", "clear-summary"];
  for (const name of admin) assert.strictEqual(deploy.COMMANDS[name].prepare, true, name);
  for (const name of ["upload", "test-buy", "test-open", "claim-promo", "join-invite", "measure", "user-checks", "cosign", "submit", "status"]) {
    assert.ok(!deploy.COMMANDS[name].prepare, name);
  }
});

// ---------------------------------------------------------------- O1-10

test("O1-10: a switch followed by a stray value is refused, never read the other way", async () => {
  assert.throws(() => lib.parseArgs(["hide", "--unhide", "x"]), /--unhide is a switch and takes no value, but 'x' follows it/);
  assert.throws(() => lib.parseArgs(["hide", "--unhide=yes"]), /switch and takes no value/);
  assert.throws(() => lib.parseArgs(["takedown", "--no-strike", "false"]), /switch/);
  assert.throws(() => lib.parseArgs(["block", "--unblock", "0"]), /switch/);
  assert.strictEqual(lib.parseArgs(["hide", "--unhide", "--seq", "2"]).flags.unhide, true);
  assert.throws(() => lib.parseArgs(["hide", "--seq"]), /--seq needs a value/);
  assert.throws(() => lib.parseArgs(["hide", "--seq", "--story", "1"]), /--seq needs a value/);
  assert.throws(() => lib.parseArgs(["hide", "--seq", "1", "--seq", "2"]), /given twice/);
  // Unknown flags and stray words stop the command before the network.
  let r = await run(["hide", "--actor", BOB, "--stories", STORIES, "--story", "1", "--seq", "1", "--unhid"]);
  assert.match(r.error.message, /--unhid is not a flag this tool knows/);
  r = await run(["hide", "--actor", BOB, "--stories", STORIES, "--story", "1", "--seq", "1", "--strike", BOB]);
  assert.match(r.error.message, /'hide' does not use --strike/);
  r = await run(["hide", "x", "--actor", BOB]);
  assert.match(r.error.message, /Unexpected 'x'/);
  r = await run(["pause", "stories", "extra", "--contract", STORIES, "--admin", BOB]);
  assert.match(r.error.message, /Unexpected 'extra'/);
  assert.throws(() => lib.parseArgs(["wire-stories", "--replace-stories", OTHER]), /set once/);
});

// ---------------------------------------------------------------- O1-11, O1-12

test("O1-11: set-moderation keeps the threshold and strike limit on chain unless given", () => {
  const cfg = { report_threshold: 7, strike_limit: 9 };
  assert.deepStrictEqual(lib.planModeration({ moderator: BOB }, cfg), { moderator: BOB, report_threshold: 7, strike_limit: 9 });
  assert.deepStrictEqual(lib.planModeration({ moderator: "off", strikes: "2" }, cfg), { moderator: "", report_threshold: 7, strike_limit: 2 });
  assert.deepStrictEqual(lib.planModeration({ moderator: BOB }, {}), { moderator: BOB, report_threshold: 3, strike_limit: 5 }, "0 on chain is the contract's 3 and 5");
  assert.throws(() => lib.planModeration({ moderator: BOB, threshold: "21" }, cfg), /--threshold must be a whole number from 1 to 20/);
  assert.throws(() => lib.planModeration({ moderator: BOB, strikes: "2.5" }, cfg), /--strikes/);
  assert.throws(() => lib.planModeration({ moderator: BOB }, null), /Could not read/);
  const src = fs.readFileSync(SCRIPT, "utf8");
  const body = src.slice(src.indexOf("async function cmdSetModeration("), src.indexOf("async function cmdHide("));
  assert.ok(body.indexOf("get_config") < body.indexOf("lib.planModeration(") && body.indexOf("lib.planModeration(") < body.indexOf("getSigner("));
});

test("O1-12: stories-limits refuses a cap above 6,000 and keeps unspecified limits", () => {
  const cfg = { contribution_cap: 4000, trial_limit: 500, open_limit: 2, archive_days: 90, inactivity_days: 45, full_price_projects: 3, max_price_multiplier: 8 };
  assert.throws(() => lib.planStoriesLimits({ cap: "6001" }, cfg), /--cap must be a whole number from 100 to 6000/);
  assert.throws(() => lib.planStoriesLimits({ cap: "10000" }, cfg), /6000/);
  assert.strictEqual(lib.planStoriesLimits({ cap: "6000" }, cfg).contribution_cap, 6000);
  assert.deepStrictEqual(lib.planStoriesLimits({ "open-limit": "4" }, cfg), Object.assign({}, cfg, { open_limit: 4 }));
  // An old chain value above the cap must be lowered on purpose.
  assert.throws(() => lib.planStoriesLimits({}, Object.assign({}, cfg, { contribution_cap: 10000 })), /Give --cap/);
  assert.strictEqual(lib.CONTRIBUTION_CAP_MAX, 6000);
});

// ---------------------------------------------------------------- O1-14

test("O1-14: new-moderator-key, test-promo and test-invite print a key only into a terminal", () => {
  for (const argv of [["new-moderator-key"], ["test-invite", "--opener", BOB, "--stories", STORIES, "--story", "1"], ["test-promo", "--admin", BOB, "--shop", SHOP]]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: "utf8" });
    assert.notStrictEqual(r.status, 0, argv[0]);
    assert.match(r.stderr, /only runs in a terminal/, argv[0]);
    assert.doesNotMatch(r.stdout + r.stderr, /[5KL][1-9A-HJ-NP-Za-km-z]{50,51}/, argv[0] + " printed something like a WIF");
    assert.doesNotMatch(r.stdout, /Node:/, argv[0] + " reached the network");
  }
});

// ---------------------------------------------------------------- F-07 replace-pdf

/** The website's own bookText source (wherever it lives under web/src), so any drift fails this test. */
function findWebBookText(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "generated") {
      const found = findWebBookText(full);
      if (found) return found;
    } else if (entry.name.endsWith(".js")) {
      const src = fs.readFileSync(full, "utf8");
      const start = src.indexOf("function bookText(story, segments) {");
      if (start >= 0) return src.slice(start, src.indexOf("\n}\n", start) + 2);
    }
  }
  return null;
}

async function webBookText() {
  const fn = findWebBookText(path.join(REPO, "web", "src"));
  assert.ok(fn, "web/src has no bookText(story, segments)");
  const { readingOrder } = await import(pathToFileURL(path.join(REPO, "web", "src", "lib", "order.js")).href);
  // eslint-disable-next-line no-new-func
  return { web: new Function("readingOrder", fn + "\nreturn bookText;")(readingOrder), readingOrder };
}

function bookFixtures() {
  const seg = (text, extra = {}) => Object.assign({ status: 1, text, author: BOB }, extra);
  return [
    { title: "A Book", segments: [seg("One."), seg("Two.", { starts_chapter: true }), seg("Gone.", { status: 2 }), seg("Hidden.", { hidden: true }), seg("Three 😀 café.")] },
    { title: "", segments: [seg("Root."), seg("After 1, older.", { insert_after: "1" }), seg("After 1, newer.", { insert_after: "1" }), seg("After 3.", { insert_after: "3", starts_chapter: true })] },
    { title: "Removed parent", segments: [seg("Gone parent.", { status: 2 }), seg("Child of removed.", { insert_after: "1" }), seg("Bad pointer.", { insert_after: "99" })] },
    { title: "Only hidden", segments: [seg("x", { hidden: true })] },
  ];
}

test("F-07: the book text and hash match the website's own bookText exactly", async () => {
  const { web, readingOrder } = await webBookText();
  for (const fx of bookFixtures()) {
    const mine = lib.bookText({ title: fx.title }, fx.segments, readingOrder);
    const theirs = web({ title: fx.title }, fx.segments);
    assert.strictEqual(mine.text, theirs.text, fx.title);
    assert.strictEqual(mine.parts, theirs.ordered.length);
  }
  const one = lib.bookText({ title: "A Book" }, bookFixtures()[0].segments, readingOrder);
  assert.strictEqual(one.text, "A Book\n\nChapter 1\n\nOne.\n\nChapter 2\n\nTwo.\nThree 😀 café.");
  assert.strictEqual(one.hidden, 1);
});

test("F-07: parts are read page by page from the contract's next, and a short read stops everything", async () => {
  const all = Array.from({ length: 23 }, (_, i) => ({ text: "p" + (i + 1), status: 1 }));
  const calls = [];
  const got = await lib.readSegments(async (start, limit) => {
    calls.push([start, limit]);
    if (start === 7 && limit > 1) throw new Error("read limit");
    const n = start < 5 ? 3 : limit; // a byte-limited first page
    const values = all.slice(start - 1, start - 1 + n);
    return { values, next: start - 1 + values.length < 23 ? String(start + values.length) : "0" };
  }, "23");
  assert.deepStrictEqual(got.map((s) => s.text), all.map((s) => s.text));
  assert.deepStrictEqual(calls.slice(0, 5), [[1, 10], [4, 10], [7, 10], [7, 1], [8, 10]]);
  await assert.rejects(lib.readSegments(async () => ({ values: [] }), 2), /Could not read part 1/);
  await assert.rejects(lib.readSegments(async () => ({ values: [all[0]], next: "5" }), 3), /does not line up/);
});

test("F-07: replace-pdf computes the hash from the chain, shows it, and sends it", async () => {
  const { readingOrder } = await webBookText();
  const fx = bookFixtures()[1];
  const story = { opener: BOB, title: fx.title, status: 4, needs_new_pdf: true, segment_count: String(fx.segments.length), pdf_uri: "https://example.org/#/stories/3/book", pdf_hash: "" };
  const reads = {
    "stories.get_story": story,
    "stories.get_segments": (a) => {
      const start = Number(a.start);
      const values = fx.segments.slice(start - 1, start + 1); // two per page
      return { values };
    },
  };
  const file = tmpFile("pdf.json");
  const node = fakeNode(TESTNET, { reads });
  const r = await run(["replace-pdf", "--admin", MULTISIG, "--stories", STORIES, "--story", "3", "--prepare", file], { node });
  assert.ok(r.prepared, r.error && r.error.message);
  const hex = crypto.createHash("sha256").update(lib.bookText(story, fx.segments, readingOrder).text, "utf8").digest("hex");
  assert.match(r.out, new RegExp("New hash:  " + hex));
  const op = JSON.parse(fs.readFileSync(file, "utf8")).operations[0];
  assert.strictEqual(op.method, "replace_pdf");
  assert.strictEqual(Buffer.from(op.args.pdf_hash, "base64url").toString("hex"), hex);
  assert.strictEqual(op.args.pdf_uri, story.pdf_uri, "the link stays unless --uri");
  // A story that doesn't need a new book hash is refused before any key.
  const r2 = await run(["replace-pdf", "--admin", BOB, "--stories", STORIES, "--story", "3"],
    { node: fakeNode(TESTNET, { reads: Object.assign({}, reads, { "stories.get_story": Object.assign({}, story, { needs_new_pdf: false }) }) }) });
  assert.match(r2.error.message, /does not need a new book hash/);
  assert.throws(() => lib.requirePdfUri("a b"), /1 to 200 plain characters/);
});

// ---------------------------------------------------------------- takedowns

test("takedown sends the text fingerprint and version count it showed (reviewed_hash, reviewed_versions)", async () => {
  const seg = { author: BOB, text_hash: "EiCq", version_count: 3, status: 1 };
  assert.deepStrictEqual(lib.takedownReview(seg), { reviewed_hash: "EiCq", reviewed_versions: 3 });
  assert.deepStrictEqual(lib.takedownReview({ author: BOB, text_hash: "EiCq" }), { reviewed_hash: "EiCq", reviewed_versions: 0 });
  assert.throws(() => lib.takedownReview({ author: BOB, text_hash: "EiCq", taken_down: true }), /already taken down/);
  assert.throws(() => lib.takedownReview({ author: BOB }), /text fingerprint/);
  const src = fs.readFileSync(SCRIPT, "utf8");
  const body = src.slice(src.indexOf("async function cmdTakedown("), src.indexOf("async function cmdReplacePdf("));
  assert.ok(body.indexOf("lib.takedownReview(seg)") < body.indexOf("getSigner("), "reviewed before the key is asked for");
  assert.match(body, /args: \{ story_id: storyId, seq, reason, note, strike, no_strike: noStrike, \.\.\.review \}/);
  assert.match(body, /Text fingerprint:/);
  // The fields reach the operation with the ABI built from the edited proto.
  const c = new koilib.Contract({ id: STORIES, abi: await protoAbi("stories") });
  const hash = koilib.utils.encodeBase64url(crypto.createHash("sha256").update("x").digest());
  const op = await c.encodeOperation({ name: "takedown_segment", args: { story_id: "1", seq: "2", reason: 1, note: "n", strike: "", no_strike: true, reviewed_hash: hash, reviewed_versions: 3 } });
  const back = (await c.decodeOperation(op)).args;
  assert.deepStrictEqual([back.reviewed_hash, back.reviewed_versions], [hash, 3]);
});

test("a stale contract build that would drop an argument is refused, not silently encoded", async () => {
  const c = deploy.contractOf("stories", STORIES, null);
  await assert.rejects(c.encodeOperation({ name: "set_paused", args: { paused: true, min_ink: "5" } }), /has no 'min_ink' for set_paused\. Rebuild it/);
});

// ---------------------------------------------------------------- Shop

test("Shop: set-asset explains the 7-day wait, never restarts it, and close fees are gone", () => {
  const now = 1_800_000_000;
  const plan = lib.planAsset({}, { token: TOKEN, enabled: true, decimals: "6", symbol: "USDT" }, now);
  assert.deepStrictEqual(plan.args, { token: TOKEN, enabled: true, decimals: 6, symbol: "USDT" });
  assert.match(plan.summary, /wait 7 days: it can be used from about 2027-01-22T08:00:00Z/);
  const on = { enabled: true, decimals: 6, symbol: "USDT", usable_from: String(now + 100) };
  assert.throws(() => lib.planAsset(on, { token: TOKEN, enabled: true, decimals: "6", symbol: "USDT" }, now), /already enabled/);
  assert.throws(() => lib.planAsset(on, { token: TOKEN, enabled: true, decimals: "8", symbol: "USDT" }, now), /Turn it off \(--disable\) first/);
  assert.deepStrictEqual(lib.planAsset(on, { token: TOKEN, enabled: false }, now).args, { token: TOKEN, enabled: false, decimals: 6, symbol: "USDT" });
  assert.throws(() => lib.planAsset({}, { token: TOKEN, enabled: false }, now), /not enabled/);
  assert.throws(() => lib.planAsset({}, { token: TOKEN, enabled: true, decimals: "19", symbol: "X" }, now), /--decimals/);
  assert.throws(() => lib.requireUsableAsset(on, now, TOKEN), /only from .*7-day wait/);
  assert.doesNotThrow(() => lib.requireUsableAsset(on, now + 100, TOKEN));
  assert.throws(() => lib.requireUsableAsset({}, now, TOKEN), /does not accept/);
  assert.ok(!("ITEM_CLOSE_BOOK" in lib.SHOP_ITEMS) && !("ITEM_CLOSE_SHORT" in lib.SHOP_ITEMS));
  assert.ok(!("UNLISTED" in lib.STORY_VISIBILITY));
});

test("Shop: buy_membership and open_story carry min_ink, the Ink the page (here, the tool) showed", async () => {
  const now = 1_800_000_000;
  const cfg = { writer_ink: "15000", starter_short: "10000" };
  assert.strictEqual(lib.membershipMinInk(lib.TIER_READER, null, cfg, now), "0");
  assert.strictEqual(lib.membershipMinInk(lib.TIER_WRITER, {}, cfg, now), "15000");
  assert.strictEqual(lib.membershipMinInk(lib.TIER_WRITER, { tier: 2, paid_until: String(now + 10), ink_per_month: "12000" }, cfg, now), "12000", "an active Writer term keeps its locked amount");
  assert.strictEqual(lib.membershipMinInk(lib.TIER_WRITER, { tier: 2, paid_until: String(now - 10), ink_per_month: "12000" }, cfg, now), "15000");
  assert.throws(() => lib.membershipMinInk(lib.TIER_WRITER, {}, {}, now), /Writer Ink amount/);
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /name: "buy_membership", args: \{ payer: buyer, tier, months: 1, token, max_price: price, min_ink: minInk \}/);
  assert.match(src, /min_ink: minInk,\s+\/\/ the starter Ink read above/);
  assert.match(src, /buy_membership", args: \{ payer: admin, [^}]*min_ink: "0" \}/);
  assert.doesNotMatch(src, /buy_pack|close_story|pay_close_fee|hidden_by_reports|other_version|legacy-parts|UNLISTED/);
  const shopC = new koilib.Contract({ id: SHOP, abi: await protoAbi("shop") });
  const op = await shopC.encodeOperation({ name: "buy_membership", args: { payer: BOB, tier: 2, months: 1, token: TOKEN, max_price: "1", min_ink: "15000" } });
  assert.strictEqual((await shopC.decodeOperation(op)).args.min_ink, "15000");
});

// ---------------------------------------------------------------- prepare-testnet.js

test("info: prepare-testnet.js prints deploy.js commands (the safe path), never Koinos CLI key steps", () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "prepare-testnet.js"), "--no-build"], { encoding: "utf8", cwd: REPO });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Koinos CLI|open the .* wallet|false false false|register /i);
  for (const step of ["upload ink --expect", "upload shop --expect", "upload stories --expect", "accept-admin stories", "wire-stories --admin", "test-asset --admin"]) {
    assert.ok(r.stdout.includes("node deploy/deploy.js " + step), step);
  }
  assert.match(r.stdout, /Never reuse a testnet contract key on\s+mainnet/);
});
