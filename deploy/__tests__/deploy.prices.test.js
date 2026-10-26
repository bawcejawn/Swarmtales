// set-price and set-ink-amounts: prices in whole tokens (several items in one
// transaction, --rate for a new token), Ink amounts that keep what isn't given.
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
const ADMIN_KEY = koilib.Signer.fromSeed("swarmtales test admin for prices");
const ADMIN = ADMIN_KEY.getAddress();
const CFG = { writer_ink: "15000", pack_s_ink: "5000", pack_m_ink: "15000", pack_l_ink: "45000", starter_book: "20000", starter_short: "10000", starter_poem: "0" };
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
    async getNextNonce() { return "KAU="; } // koilib's real encoding (field 5)
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


test("prices: whole tokens to base units, several items, 0 takes an item off sale", () => {
  const p = lib.planPrices({ poem: "0.3", reader: "0" }, 8, CFG);
  assert.deepStrictEqual(p, [{ item: 1, amount: "0", name: "reader" }, { item: 10, amount: "30000000", name: "poem" }]);
  assert.throws(() => lib.planPrices({}, 8, CFG), /at least one price/);
  assert.throws(() => lib.planPrices({ poem: "0.123456789" }, 8, CFG), /more than 8 decimals/);
  assert.throws(() => lib.planPrices({ poem: "abc" }, 8, CFG), /amount like/);
});

test("prices: --rate prices the Writer month and packs from their Ink, rounded up", () => {
  const p = lib.planPrices({ rate: "100" }, 6, CFG);
  assert.deepStrictEqual(p.map((x) => [x.name, x.amount]), [["writer", "150000000"], ["pack-s", "50000000"], ["pack-m", "150000000"], ["pack-l", "450000000"]]);
  // 5000 Ink at 3 Ink per token = 1666.666667 tokens (6 decimals), rounded up.
  assert.strictEqual(lib.planPrices({ rate: "3" }, 6, CFG)[1].amount, "1666666667");
  // 2.5 Ink per token, and an explicit price wins over the rate.
  const q = lib.planPrices({ rate: "2.5", "pack-s": "1" }, 0, CFG);
  assert.deepStrictEqual(q.map((x) => [x.name, x.amount]), [["writer", "6000"], ["pack-s", "1"], ["pack-m", "6000"], ["pack-l", "18000"]]);
  assert.throws(() => lib.planPrices({ rate: "0" }, 6, CFG), /more than 0/);
  assert.throws(() => lib.planPrices({ rate: "x" }, 6, CFG), /--rate must be/);
  assert.throws(() => lib.planPrices({ rate: "1" }, 6, { ...CFG, pack_l_ink: "0" }), /no Ink amount for pack-l/);
});

test("ink amounts: what you give changes, the rest stays as on chain", () => {
  const args = lib.planInkAmounts({ "starter-poem": "2000" }, CFG);
  assert.deepStrictEqual(args, { writer_month: "15000", pack_s: "5000", pack_m: "15000", pack_l: "45000", starter_book: "20000", starter_short: "10000", starter_poem: "2000" });
  assert.throws(() => lib.planInkAmounts({}, CFG), /Give at least one/);
  assert.throws(() => lib.planInkAmounts({ writer: "-1" }, CFG), /--writer/);
});

test("set-price sends every price in one transaction, signed by the admin, after SEND", async () => {
  const node = fakeNode(TESTNET, { reads: { "shop.get_asset": { enabled: true, decimals: 8, symbol: "tKOIN", usable_from: "0" }, "shop.get_config": CFG } });
  const r = await run(["set-price", "--admin", ADMIN, "--shop", SHOP, "--token", TOKEN, "--poem", "0.3", "--book", "1"], { node, answers: ["SEND"], secret: ADMIN_KEY.getPrivateKey("wif") });
  assert.ifError(r.error);
  const tx = node.log.sent[node.log.sent.length - 1].tx;
  assert.strictEqual(tx.operations.length, 2);
  const c = new koilib.Contract({ id: SHOP, abi: ABI("shop") });
  const decoded = await Promise.all(tx.operations.map((op) => c.decodeOperation(op)));
  assert.deepStrictEqual(decoded.map((d) => [d.name, d.args.item, d.args.amount]), [["set_price", 6, "100000000"], ["set_price", 10, "30000000"]]);
  assert.match(r.out, /prices in tKOIN: book 1, poem 0.3/);
});

test("set-ink-amounts keeps the chain's amounts and changes only the poem starter", async () => {
  const node = fakeNode(TESTNET, { reads: { "shop.get_config": CFG } });
  const r = await run(["set-ink-amounts", "--admin", ADMIN, "--shop", SHOP, "--starter-poem", "2000"], { node, answers: ["SEND"], secret: ADMIN_KEY.getPrivateKey("wif") });
  assert.ifError(r.error);
  const tx = node.log.sent[node.log.sent.length - 1].tx;
  const d = await new koilib.Contract({ id: SHOP, abi: ABI("shop") }).decodeOperation(tx.operations[0]);
  assert.strictEqual(d.name, "set_ink_amounts");
  assert.strictEqual(d.args.starter_poem, "2000");
  assert.strictEqual(d.args.writer_month, "15000");
});

test("set-price refuses a token the Shop has no record of", async () => {
  const node = fakeNode(TESTNET, { reads: { "shop.get_asset": { enabled: false, decimals: 0, symbol: "" }, "shop.get_config": CFG } });
  const r = await run(["set-price", "--admin", ADMIN, "--shop", SHOP, "--token", TOKEN, "--poem", "1"], { node, secret: ADMIN_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /no record of token/);
});
