// The multisig wallet in the deploy tool: multisig-create (upload + setup in
// one transaction), multisig-signers (prepared only) and their checks. No network and no real keys: commands run in-process
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
const MS_KEY = koilib.Signer.fromSeed("swarmtales test fresh multisig wallet");
const MS = MS_KEY.getAddress();
const A = "1LrT3gTG9Rpf5zHf9DENaEgXEuhTdKxFtP", B = "1C8hrrjXYykrDmPBioex7YRv7cEt1mBcEi", C = "1Nw9fsuYPjQXX8pnz9sqg1cSyYyJPWoYat";


function msAbi() {
  return lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(REPO, "multisig", "abi", "multisig.abi"), "utf8")));
}

function fakeNode(meta) {
  const log = { sent: [] };
  class FakeProvider {
    async getChainId() { return TESTNET.chainId; }
    async getAccountRc() { return "1000000000"; }
    async call(method) {
      if (method === "mempool.get_reserved_account_rc") return { rc: "0" };
      if (method === "contract_meta_store.get_contract_meta") return meta && meta.hash ? { meta: { abi: "" } } : {};
      throw new Error("unexpected node call " + method);
    }
    async getNextNonce() { return "OAU="; }
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


test("multisig: planMultisigSigners checks the list the way the contract does", () => {
  assert.deepStrictEqual(lib.planMultisigSigners(A + "," + B + "," + C, undefined, MS).args, { signers: [A, B, C], threshold: 2 });
  assert.match(lib.planMultisigSigners(A + ", " + B + " ," + C, "3", MS).summary, /^3 of 3: /);
  assert.throws(() => lib.planMultisigSigners(A, undefined, MS), /2 to 10 addresses/);
  assert.throws(() => lib.planMultisigSigners(A + "," + A, undefined, MS), /same address twice/);
  assert.throws(() => lib.planMultisigSigners(A + "," + MS, undefined, MS), /can't be one of its own signers/);
  assert.throws(() => lib.planMultisigSigners(A + "," + B + "," + C, "1", MS), /--threshold must be/);
  assert.throws(() => lib.planMultisigSigners(A + "," + B + "," + C, "4", MS), /--threshold must be/);
  assert.throws(() => lib.planMultisigSigners(A + ",nope", undefined, MS), /does not look like a Koinos address/);
});

test("multisig: multisig-create sends ONE transaction: upload with all three flags, then setup", async () => {
  const node = fakeNode(null);
  const r = await run(["multisig-create", "--expect", MS, "--signers", [A, B, C].join(",")], { node, answers: ["SEND"], secret: MS_KEY.getPrivateKey("wif") });
  assert.ifError(r.error);
  assert.strictEqual(node.log.sent.length, 2, "dry run, then the real one");
  const tx = node.log.sent[1].tx;
  assert.strictEqual(tx.header.payer, MS);
  assert.strictEqual(tx.operations.length, 2);
  const up = tx.operations[0].upload_contract;
  assert.ok(up, "the first operation is the upload");
  assert.strictEqual(up.contract_id, MS);
  assert.strictEqual(up.authorizes_call_contract, true);
  assert.strictEqual(up.authorizes_transaction_application, true);
  assert.strictEqual(up.authorizes_upload_contract, true);
  const c = new koilib.Contract({ id: MS, abi: msAbi() });
  const { name, args } = await c.decodeOperation(tx.operations[1]);
  assert.strictEqual(name, "setup");
  assert.deepStrictEqual(args, { signers: [A, B, C], threshold: 2 });
  assert.match(r.out, /acts only with 2 of 3/);
});

test("multisig: multisig-create refuses a wallet that already has a contract, and plain upload refuses the multisig", async () => {
  let r = await run(["multisig-create", "--expect", MS, "--signers", [A, B, C].join(",")], { node: fakeNode({ hash: "0x1220" + "ab".repeat(32) }), secret: MS_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /already has a contract/);
  r = await run(["upload", "multisig", "--expect", MS], { node: fakeNode(null), secret: MS_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /multisig-create/);
});

test("multisig: multisig-create stops without SEND, and refuses another wallet's key", async () => {
  let node = fakeNode(null);
  let r = await run(["multisig-create", "--expect", MS, "--signers", [A, B, C].join(",")], { node, answers: ["no"], secret: MS_KEY.getPrivateKey("wif") });
  assert.match(r.error.message, /Stopped/);
  assert.strictEqual(node.log.sent.filter((s) => s.broadcast).length, 0);
  node = fakeNode(null);
  r = await run(["multisig-create", "--expect", MS, "--signers", [A, B, C].join(",")], { node, answers: ["SEND"], secret: koilib.Signer.fromSeed("someone else").getPrivateKey("wif") });
  assert.ok(r.error);
  assert.strictEqual(node.log.sent.length, 0);
});

test("multisig: multisig-signers only prepares (the current quorum must cosign)", async () => {
  const r = await run(["multisig-signers", "--multisig", MS, "--signers", [A, B].join(",")], { node: fakeNode(null) });
  assert.match(r.error.message, /--prepare/);
});
