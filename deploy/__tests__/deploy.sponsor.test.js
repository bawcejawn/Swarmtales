// The mana sponsor in the deploy tool: upload flags, sponsor-config checks
// and what it sends. No network and no real keys: commands run in-process
// against a fake node.
// Run: node --test deploy/__tests__/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const koilib = require("koilib");
const lib = require("../lib");
const deploy = require("../deploy");

const REPO = path.join(__dirname, "..", "..");
const TESTNET = lib.NETWORKS.testnet;
const INK = "1DdeLhBvZdMJtBUNZBEobkDPJ2jAu9BFCz";
const SHOP = "1C72FDL8NV3MHG7urVgXyvLBjMoC2WPJc6";
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const TOKEN = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";
const KOIN = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";
const SPONSOR_KEY = koilib.Signer.fromSeed("swarmtales test sponsor");
const SPONSOR = SPONSOR_KEY.getAddress();

const GOOD = { ink: INK, shop: SHOP, stories: STORIES, tokens: TOKEN + "," + KOIN, "per-tx": "10", "per-account": "30", "per-day": "300" };

function sponsorAbi() {
  return lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(REPO, "sponsor", "abi", "sponsor.abi"), "utf8")));
}

function fakeNode(meta) {
  const log = { sent: [] };
  class FakeProvider {
    async getChainId() { return TESTNET.chainId; }
    async getAccountRc() { return "1000000000"; }
    async call(method) {
      if (method === "mempool.get_reserved_account_rc") return { rc: "0" };
      throw new Error("unexpected node call " + method);
    }
    async getNextNonce() { return "KAU="; } // koilib's real encoding (field 5)
    async invokeGetContractMetadata() { return { value: meta }; }
    async sendTransaction(tx, broadcast) {
      log.sent.push({ tx: JSON.parse(JSON.stringify(tx)), broadcast });
      return { receipt: { rc_used: "1000", reverted: false, logs: [] }, transaction: tx };
    }
    async wait() { return { blockNumber: 7 }; }
  }
  return { FakeProvider, log };
}

async function run(argv, { node, answers = [], secret } = {}) {
  const out = [];
  const origLog = console.log;
  const origSecret = process.env[lib.SECRET_ENV];
  console.log = (...a) => out.push(a.join(" "));
  if (secret) process.env[lib.SECRET_ENV] = secret;
  else delete process.env[lib.SECRET_ENV];
  Object.assign(deploy.seams, { Provider: node ? node.FakeProvider : null, readLine: () => answers.shift(), releaseHashes: null });
  try {
    await deploy.main(argv);
    return { out: out.join("\n") };
  } catch (e) {
    return { error: e, out: out.join("\n") };
  } finally {
    console.log = origLog;
    if (origSecret === undefined) delete process.env[lib.SECRET_ENV];
    else process.env[lib.SECRET_ENV] = origSecret;
    Object.assign(deploy.seams, { Provider: null, readLine: null, releaseHashes: null });
  }
}

function argv(flags) {
  const out = ["sponsor-config", "--sponsor", SPONSOR];
  for (const [k, v] of Object.entries(flags)) {
    if (v === true) out.push("--" + k);
    else out.push("--" + k, v);
  }
  return out;
}

test("sponsor: planSponsorConfig builds the contract's settings in mana base units", () => {
  const plan = lib.planSponsorConfig(GOOD, SPONSOR);
  assert.deepStrictEqual(plan.args.config, {
    enabled: true, ink: INK, shop: SHOP, stories: STORIES, tokens: [TOKEN, KOIN],
    max_mana_per_tx: "1000000000", max_mana_per_account_day: "3000000000", max_mana_per_day: "30000000000",
  });
  assert.match(plan.summary, /sponsor ON/);
  assert.match(plan.summary, /approve\(spender = Shop\)/);
  const off = lib.planSponsorConfig(Object.assign({}, GOOD, { disable: true, tokens: undefined }), SPONSOR);
  assert.strictEqual(off.args.config.enabled, false);
  assert.deepStrictEqual(off.args.config.tokens, []);
});

test("sponsor: planSponsorConfig refuses what the contract would refuse", () => {
  const bad = (change, re) => assert.throws(() => lib.planSponsorConfig(Object.assign({}, GOOD, change), SPONSOR), re);
  bad({ "per-tx": "40" }, /--per-tx <= --per-account <= --per-day/);
  bad({ "per-account": "400" }, /--per-tx <= --per-account <= --per-day/);
  bad({ "per-day": "1000.00000001", "per-account": "30" }, /can't be above 1000 mana/);
  bad({ "per-tx": "0" }, /more than 0/);
  bad({ "per-tx": "ten" }, /amount of mana/);
  bad({ stories: SHOP }, /four different addresses/);
  bad({ ink: SPONSOR }, /four different addresses/);
  bad({ tokens: TOKEN + "," + TOKEN }, /same token twice/);
  bad({ tokens: [TOKEN, KOIN, INK.replace("1D", "1E"), "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf", "1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq"].join(",") }, /at most 4|Koinos address/);
  bad({ tokens: SHOP }, /can't include a SwarmTales contract/);
  bad({ tokens: "nope" }, /does not look like a Koinos address/);
  bad({ shop: undefined }, /Missing shop/);
});

test("sponsor: sponsor-config sends set_config signed by the sponsor wallet, after SEND", async () => {
  const node = fakeNode({ hash: "0x1220" + "ab".repeat(32), authorizes_call_contract: false, authorizes_transaction_application: true, authorizes_upload_contract: false });
  const r = await run(argv(GOOD), { node, answers: ["SEND"], secret: SPONSOR_KEY.getPrivateKey("wif") });
  assert.ifError(r.error);
  assert.strictEqual(node.log.sent.length, 2, "dry run, then the real one");
  assert.strictEqual(node.log.sent[0].broadcast, false);
  assert.strictEqual(node.log.sent[1].broadcast, true);
  const tx = node.log.sent[1].tx;
  assert.strictEqual(tx.header.payer, SPONSOR);
  assert.strictEqual(tx.operations.length, 1);
  const c = new koilib.Contract({ id: SPONSOR, abi: sponsorAbi() });
  const { name, args } = await c.decodeOperation(tx.operations[0]);
  assert.strictEqual(name, "set_config");
  assert.strictEqual(args.config.enabled, true);
  assert.deepStrictEqual(args.config.tokens, [TOKEN, KOIN]);
  assert.strictEqual(args.config.max_mana_per_day, "30000000000");
  assert.match(r.out, /caps 10\.0000 mana per transaction, 30\.0000 per account per day, 300\.0000 for everyone per day/);
});

test("sponsor: sponsor-config refuses an account without the sponsor contract, or with the wrong flags", async () => {
  let r = await run(argv(GOOD), { node: fakeNode(null), secret: SPONSOR_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /No contract at .* Upload it first/);
  r = await run(argv(GOOD), { node: fakeNode({ hash: "0x1220" + "ab".repeat(32), authorizes_transaction_application: false }), secret: SPONSOR_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /exactly the 'pays for transactions' flag/);
  r = await run(argv(GOOD), { node: fakeNode({ hash: "0x1220" + "ab".repeat(32), authorizes_transaction_application: true, authorizes_call_contract: true }), secret: SPONSOR_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /exactly the 'pays for transactions' flag/);
});

test("sponsor: sponsor-config stops without SEND and asks for no other key", async () => {
  const node = fakeNode({ hash: "0x1220" + "ab".repeat(32), authorizes_transaction_application: true });
  const r = await run(argv(GOOD), { node, answers: ["no"], secret: SPONSOR_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /Stopped/);
  assert.strictEqual(node.log.sent.filter((s) => s.broadcast).length, 0);
});

test("sponsor: a key for another wallet is refused before anything is signed", async () => {
  const node = fakeNode({ hash: "0x1220" + "ab".repeat(32), authorizes_transaction_application: true });
  const other = koilib.Signer.fromSeed("not the sponsor");
  const r = await run(argv(GOOD), { node, answers: ["SEND"], secret: other.getPrivateKey("wif") });
  assert.ok(r.error);
  assert.strictEqual(node.log.sent.length, 0);
});

test("sponsor: upload turns on ONLY the transaction-application flag for the sponsor, none for the others", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF
  assert.match(src, /authorizesCallContract: false,\n\s+authorizesTransactionApplication: payFlag,\n\s+authorizesUploadContract: false,/);
  assert.match(src, /sponsor: \{[\s\S]*?authorizesTransactionApplication: true,/);
  for (const name of ["ink", "shop", "stories"]) {
    const block = new RegExp("\\n  " + name + ": \\{[^}]*\\}").exec(src)[0];
    assert.ok(!/authorizes/.test(block), name + " must not turn on an authority flag");
  }
});
