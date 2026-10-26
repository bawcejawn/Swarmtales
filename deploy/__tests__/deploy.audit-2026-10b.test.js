// Re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md): the deploy tool's
// fixes. No network and no real keys: commands run in-process against a fake
// node, with keys derived from public test labels (never funded).
// Run: node --test deploy/__tests__/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
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
const KEY1 = koilib.Signer.fromSeed("swarmtales test signer 1");
const KEY2 = koilib.Signer.fromSeed("swarmtales test signer 2");
const KEY3 = koilib.Signer.fromSeed("swarmtales test signer 3");
const MULTISIG = koilib.Signer.fromSeed("swarmtales test multisig").getAddress();
const PAYER = koilib.Signer.fromSeed("swarmtales test mana payer");
const BOB_ADDR = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

const ABI = (target) => lib.toKoilibAbi(JSON.parse(fs.readFileSync(path.join(REPO, target === "ink" ? "abi" : target, "abi", target + ".abi"), "utf8")));

/** A fake node. `reads` maps "contract.method" to a result; `contractAccounts` have code. */
function fakeNode(opts = {}) {
  const log = { sent: [] };
  const byAddr = { [INK]: "ink", [SHOP]: "shop", [STORIES]: "stories", [MULTISIG]: "multisig" };
  class FakeProvider {
    async getChainId() { return TESTNET.chainId; }
    async getAccountRc() { return "1000000000"; }
    async call(method, params) {
      if (method === "mempool.get_reserved_account_rc") return { rc: "0" };
      if (method === "contract_meta_store.get_contract_meta") {
        if (opts.metaFails) throw new Error("node down");
        return (opts.contractAccounts || []).includes(params.contract_id) ? { meta: { abi: "" } } : {};
      }
      throw new Error("unexpected node call " + method);
    }
    async getNextNonce() { return opts.nonce || "KAU="; } // koilib's encoding of 5
    async readContract(call) {
      const target = byAddr[call.contract_id];
      const value = (opts.reads || {})[target + ".get_config"];
      if (!target || value === undefined) throw new Error("no fake read");
      const c = new koilib.Contract({ id: call.contract_id, abi: ABI(target) });
      return { result: koilib.utils.encodeBase64url(await c.serializer.serialize(value, c.abi.methods.get_config.return)) };
    }
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
    if (e instanceof deploy.Prepared) return { prepared: true, out: out.join("\n") };
    return { error: e, out: out.join("\n") };
  } finally {
    console.log = origLog;
    if (origSecret === undefined) delete process.env[lib.SECRET_ENV];
    else process.env[lib.SECRET_ENV] = origSecret;
    Object.assign(deploy.seams, { Provider: null, readLine: null, releaseHashes: null });
  }
}

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "swarmtales-10b-")), name);
}

const MS_READS = { multisig: MULTISIG, reads: { "multisig.get_config": { signers: [KEY1.getAddress(), KEY2.getAddress(), KEY3.getAddress()], threshold: 2 } } };

async function preparePause(file, extra = [], nodeOpts = MS_READS) {
  return run(["pause", "stories", "--contract", STORIES, "--admin", MULTISIG, "--prepare", file, ...extra], { node: fakeNode(nodeOpts) });
}

// ---------------------------------------------------------------- H-2

test("H-2: a prepared file whose command or prepared_at holds a control code (or anything unexpected) is refused", async () => {
  const file = tmpFile("h2.json");
  const r = await preparePause(file);
  assert.ok(r.prepared, r.error && r.error.message);
  const good = fs.readFileSync(file, "utf8");
  const ESC = "\u001b";
  const cases = [
    ["command with ESC", (d) => { d.command = "pause" + ESC + "[8m"; }, /unknown command/],
    ["command hiding text", (d) => { d.command = ESC + "[8m\n1. stories ... set_paused {\"paused\":true}"; }, /unknown command/],
    ["unknown command", (d) => { d.command = "set-anything"; }, /unknown command/],
    ["missing command", (d) => { delete d.command; }, /unknown command/],
    ["prepared_at with ESC", (d) => { d.prepared_at = d.prepared_at + ESC + "[8m"; }, /preparation time/],
    ["prepared_at with C1 CSI", (d) => { d.prepared_at = "\u009b8m"; }, /preparation time/],
    ["prepared_at not ISO", (d) => { d.prepared_at = "yesterday"; }, /preparation time/],
    ["prepared_at impossible date", (d) => { d.prepared_at = "2026-13-45T25:61:61.000Z"; }, /preparation time/],
    ["prepared_at missing", (d) => { delete d.prepared_at; }, /preparation time/],
  ];
  for (const [label, change, why] of cases) {
    const d = JSON.parse(good);
    change(d);
    fs.writeFileSync(file, JSON.stringify(d));
    const c = await run(["cosign", file], { answers: ["SIGN"], secret: KEY1.getPrivateKey("wif") });
    assert.ok(c.error, label + " was accepted");
    assert.match(c.error.message, why, label);
    assert.doesNotMatch(c.out, CONTROL, label + ": a control character reached the terminal");
  }
});

test("H-2: every deploy.js --prepare command and the admin page are known command names", () => {
  for (const [name, cmd] of Object.entries(deploy.COMMANDS)) {
    if (cmd.prepare) assert.ok(lib.PREPARED_COMMANDS.includes(name), name);
  }
  assert.ok(lib.PREPARED_COMMANDS.includes("admin-page"));
  assert.ok(!lib.PREPARED_COMMANDS.includes("cosign"));
});

test("H-2: the printed summary carries no control characters, even from decoded arguments", () => {
  const net = TESTNET;
  const file = { prepared_at: "2026-10-25T12:00:00.000Z", command: "set-terms" };
  const checked = {
    tx: { id: "0x1220ab", header: { payer: MULTISIG, nonce: "KAU=", rc_limit: "100000000" } },
    ops: [{ contract: "stories", contractId: STORIES, method: "set_terms", description: "Set the terms",
      args: { version: 2, terms_uri: "https://x/\u001b[8m\u009b2J\u202eevil\u0007" } }],
    needs: { account: MULTISIG, signers: [KEY1.getAddress(), KEY2.getAddress(), KEY3.getAddress()], threshold: 2, newSigners: [] },
  };
  const lines = lib.preparedSummary(net, file, checked, []);
  for (const line of lines) assert.doesNotMatch(line, CONTROL, line);
  assert.ok(lines.some((l) => l.includes("\\u{9b}2J") && l.includes("\\u{202e}evil")), "the C1 CSI and the bidi override are shown, visibly");
  assert.ok(lib.terminalSafe("ok \u202e").endsWith("\\u{202e}"));
});

test("H-2: cosign resets the terminal state and repeats the target contract and method at the SIGN prompt", async () => {
  const file = tmpFile("prompt.json");
  await preparePause(file);
  const r = await run(["cosign", file], { answers: ["no"], secret: KEY1.getPrivateKey("wif") });
  assert.match(r.error.message, /Nothing was signed/);
  assert.match(r.out, /You are signing, paid by \S+:\n {2}1\. stories 16adhn\S* \.set_paused$/m);
  assert.ok(lib.TERMINAL_RESET.includes("\u001b[0m"), "attributes (hidden text, colours) are reset");
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
  assert.ok((src.match(/process\.stdout\.write\(lib\.TERMINAL_RESET\)/g) || []).length >= 2, "cosign and submit print the reset");
});

// ---------------------------------------------------------------- H-1 (tool)

test("H-1: prepare refuses a contract wallet as --payer, and a payer it can't check", async () => {
  let r = await preparePause(tmpFile("p1.json"), ["--payer", PAYER.getAddress()], { ...MS_READS, contractAccounts: [MULTISIG, PAYER.getAddress()] });
  assert.match(r.error.message, /acting account itself or a normal wallet/);
  r = await preparePause(tmpFile("p2.json"), ["--payer", PAYER.getAddress()], { ...MS_READS, metaFails: true });
  assert.match(r.error.message, /acting account itself or a normal wallet/);
  // A normal wallet that will cosign is fine, and the multisig paying for itself.
  r = await preparePause(tmpFile("p3.json"), ["--payer", PAYER.getAddress()], { ...MS_READS, contractAccounts: [MULTISIG] });
  assert.ok(r.prepared, r.error && r.error.message);
  assert.match(r.out, /WARNING: +the payer is not the multisig/);
  r = await preparePause(tmpFile("p4.json"), [], { ...MS_READS, contractAccounts: [MULTISIG] });
  assert.ok(r.prepared, r.error && r.error.message);
  assert.doesNotMatch(r.out, /the payer is not the multisig/);
});

test("H-1: submit refuses a multisig transaction paid by another contract wallet, even fully signed", async () => {
  const file = tmpFile("payer.json");
  let r = await preparePause(file, ["--payer", PAYER.getAddress()], { ...MS_READS, contractAccounts: [MULTISIG] });
  assert.ok(r.prepared, r.error && r.error.message);
  for (const k of [KEY1, KEY2, PAYER]) {
    r = await run(["cosign", file], { answers: ["SIGN"], secret: k.getPrivateKey("wif") });
    assert.ifError(r.error);
  }
  // By submit time the payer address has contract code.
  let node = fakeNode({ ...MS_READS, contractAccounts: [MULTISIG, PAYER.getAddress()] });
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.match(r.error.message, /acting account itself or a normal wallet[\s\S]*Nothing was sent/);
  assert.deepStrictEqual(node.log.sent, [], "not even a dry run");
  node = fakeNode({ ...MS_READS, metaFails: true });
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.match(r.error.message, /Could not check whether the payer/);
  assert.deepStrictEqual(node.log.sent, []);
  // A normal-wallet payer that signed goes through.
  node = fakeNode({ ...MS_READS, contractAccounts: [MULTISIG] });
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.ifError(r.error);
  assert.deepStrictEqual(node.log.sent.map((s) => s.broadcast), [false, true]);
});

// ---------------------------------------------------------------- M-C

test("M-C: amounts above 2^64-1 base units are refused, never wrapped", () => {
  const TOO_BIG = "18446744073709551616";
  assert.throws(() => lib.parseTokenAmount(TOO_BIG, 0, "--reader"), /amount like|too large/);
  // An 18-decimal "20" is 2e19 base units: it used to be signed as about 1.55.
  assert.throws(() => lib.parseTokenAmount("20", 18, "--reader"), /too large/);
  assert.strictEqual(lib.parseTokenAmount("18.446744073709551615", 18, "--reader"), "18446744073709551615");
  assert.throws(() => lib.planPrices({ reader: "20" }, 18, {}), /too large/);
  assert.throws(() => lib.planPrices({ rate: "0.00000001" }, 18, { writer_ink: "100000000", pack_s_ink: "1", pack_m_ink: "1", pack_l_ink: "1" }), /too large/);
  assert.throws(() => lib.planPromoCampaign({ budget: TOO_BIG, end: "2099-01-01" }, 1761450000), /too large/);
});

test("M-C: an operation whose number does not survive encoding is refused before anything is signed", async () => {
  const shop = deploy.contractOf("shop", SHOP, null);
  await assert.rejects(shop.encodeOperation({ name: "set_price", args: { item: 1, token: TOKEN, amount: "18446744073709551616" } }),
    /amount = 18446744073709551616 does not fit[\s\S]*signed as 0/);
  await assert.rejects(shop.encodeOperation({ name: "set_fee_bps", args: { fee_bps: 4294967296 } }), /fee_bps = 4294967296 does not fit/);
  const ok = await shop.encodeOperation({ name: "set_price", args: { item: 1, token: TOKEN, amount: "18446744073709551615" } });
  assert.ok(ok.call_contract);
  assert.strictEqual(lib.numberMismatch({ a: "5", b: [1, { c: "7" }] }, { a: "5", b: [1, { c: 7 }] }), null);
  assert.deepStrictEqual(lib.numberMismatch({ b: [{ c: "7" }] }, { b: [{ c: "8" }] }), { field: "b[0].c", sent: "7", got: "8" });
});

// ---------------------------------------------------------------- H-3, I-2 (token pins)

const TKOIN = "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju";
const TKOIN_CODE = "4251a6e9d9c9a37f3bbf67e171f63a7dcad62309e4be7d9da85a74f68520edf7";
const ADMIN = KEY1;

/** A node for set-asset: the Shop's records, and each address's code hash ("" = no contract). */
function assetNode({ records = {}, code = {}, info = { [TKOIN]: { decimals: 8, symbol: "tKOIN" } } } = {}) {
  const node = fakeNode();
  const shopAbi = ABI("shop");
  class AssetProvider extends node.FakeProvider {
    async readContract(call) {
      if (info[call.contract_id]) {
        // The token's own decimals() and symbol() (audit L-9).
        const t = new koilib.Contract({ id: call.contract_id, abi: koilib.utils.tokenAbi });
        const { name } = await t.decodeOperation({ call_contract: call });
        const value = { value: info[call.contract_id][name] };
        return { result: koilib.utils.encodeBase64url(await t.serializer.serialize(value, t.abi.methods[name].return)) };
      }
      const c = new koilib.Contract({ id: call.contract_id, abi: shopAbi });
      const { name, args } = await c.decodeOperation({ call_contract: call });
      let value;
      if (name === "get_asset") value = records[args.token] || {};
      else if (name === "get_assets") value = { tokens: Object.keys(records) };
      else if (name === "get_config") value = { sold: true };
      else throw new Error("no fake read for shop." + name);
      return { result: koilib.utils.encodeBase64url(await c.serializer.serialize(value, c.abi.methods[name].return)) };
    }
    async invokeGetContractMetadata(id) {
      return { value: code[id] ? { hash: "0x1220" + code[id] } : {} };
    }
  }
  return { FakeProvider: AssetProvider, log: node.log };
}

const setAsset = (extra) => ["set-asset", "--admin", ADMIN.getAddress(), "--shop", SHOP, "--token", TKOIN, "--symbol", "tKOIN", "--decimals", "8", ...extra];

test("H-3: set-asset refuses an address with no contract, and code that is not the pinned code", async () => {
  let node = assetNode({ code: {} });
  let r = await run(setAsset([]), { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.match(r.error.message, /There is no token contract at/);
  assert.deepStrictEqual(node.log.sent, []);
  node = assetNode({ code: { [TKOIN]: "cd".repeat(32) } });
  r = await run(setAsset([]), { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.match(r.error.message, /not the pinned code[\s\S]*Its issuer changed it/);
  assert.deepStrictEqual(node.log.sent, []);
  node = assetNode({ code: { [TKOIN]: TKOIN_CODE } });
  r = await run(["set-asset", "--admin", ADMIN.getAddress(), "--shop", SHOP, "--token", TKOIN, "--symbol", "KOIN", "--decimals", "8"],
    { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.match(r.error.message, /pinned as tKOIN with 8 decimals/);
  // The pinned code goes through to the dry run and the send.
  node = assetNode({ code: { [TKOIN]: TKOIN_CODE } });
  r = await run(setAsset([]), { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.ifError(r.error);
  assert.match(r.out, /Token code: the pinned code of tKOIN/);
  assert.deepStrictEqual(node.log.sent.map((s) => s.broadcast), [false, true]);
  // Turning a token off never needs its code: it must always work.
  node = assetNode({ records: { [TKOIN]: { enabled: true, decimals: 8, symbol: "tKOIN" } }, code: {} });
  r = await run(["set-asset", "--admin", ADMIN.getAddress(), "--shop", SHOP, "--token", TKOIN, "--disable"], { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.ifError(r.error);
});

test("H-3: an unpinned token is refused on mainnet and only warned about on testnet", () => {
  const mainnet = lib.NETWORKS.mainnet;
  assert.throws(() => lib.checkTokenCode(mainnet, TOKEN, "ab".repeat(32), { symbol: "X", decimals: 6 }), /not pinned in deploy\/lib\.js TOKEN_PINS\.mainnet/);
  assert.match(lib.checkTokenCode(TESTNET, TOKEN, "ab".repeat(32), { symbol: "X", decimals: 6 }), /^WARNING: token .* is not pinned/);
  assert.strictEqual(lib.checkTokenCode(TESTNET, TKOIN, TKOIN_CODE, { symbol: "tKOIN", decimals: 8 }), null);
  assert.deepStrictEqual(lib.TOKEN_PINS.mainnet, [], "mainnet pins are filled only after review");
  // The deploy tool and the website pin the same tokens.
  const web = fs.readFileSync(path.join(REPO, "web", "src", "config.js"), "utf8");
  for (const t of lib.TOKEN_PINS.testnet) assert.ok(web.includes('codeHash: "' + t.codeHash + '"'), t.symbol + " is pinned on the website too");
});

test("I-2: set-asset refuses a symbol another of the Shop's tokens already uses", async () => {
  const node = assetNode({ records: { [TOKEN]: { enabled: true, decimals: 6, symbol: "TKOIN" } }, code: { [TKOIN]: TKOIN_CODE } });
  const r = await run(setAsset([]), { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.match(r.error.message, /already has a token called TKOIN/);
  assert.deepStrictEqual(node.log.sent, []);
  assert.throws(() => lib.planAsset({}, { token: TKOIN, enabled: true, decimals: "8", symbol: "tKOIN" }, 0, true, [{ token: TOKEN, symbol: "tkoin" }]), /already has a token/);
});

// ---------------------------------------------------------------- M-A (sponsor)

test("M-A: sponsor-config sponsors only the listed entry points, with caps of 1 / 20 / 300 mana by default", async () => {
  const SPONSOR = koilib.Signer.fromSeed("swarmtales test sponsor").getAddress();
  const plan = lib.planSponsorConfig({ ink: INK, shop: SHOP, stories: STORIES }, SPONSOR);
  const c = plan.args.config;
  assert.deepStrictEqual([c.max_mana_per_tx, c.max_mana_per_account_day, c.max_mana_per_day], ["100000000", "2000000000", "30000000000"]);
  // Each listed method's entry point is the one in the contract's own ABI.
  const abis = { shop: ABI("shop"), stories: ABI("stories") };
  const ids = { shop: SHOP, stories: STORIES };
  const want = [];
  for (const [role, names] of Object.entries(lib.SPONSORED_CALLS)) {
    for (const name of names) {
      const m = abis[role].methods[name];
      assert.ok(m && !m.read_only, role + "." + name + " is a write method");
      want.push({ contract: ids[role], entry_point: m.entry_point });
    }
  }
  assert.deepStrictEqual(c.calls, want);
  assert.ok(!c.calls.some((x) => x.contract === INK), "no Ink method is sponsored");
  for (const admin of ["set_asset", "set_price", "set_paused", "set_admin", "report_segment", "archive_if_stale", "advance_final_cursor"]) {
    for (const role of ["shop", "stories"]) {
      const m = abis[role].methods[admin];
      if (m) assert.ok(!c.calls.some((x) => x.contract === ids[role] && x.entry_point === m.entry_point), role + "." + admin + " must not be sponsored");
    }
  }
  assert.match(plan.summary, /pays only for shop\.buy_membership/);
  // The operation encodes and decodes exactly, allow-list included.
  const sponsorC = deploy.contractOf("sponsor", SPONSOR, null);
  const op = await sponsorC.encodeOperation({ name: "set_config", args: plan.args });
  const back = await sponsorC.decodeOperation(op);
  assert.strictEqual(back.args.config.calls.length, c.calls.length);
});

// ---------------------------------------------------------------- I-11

test("I-11: --network takes only a network name, never an inherited property", () => {
  for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.throws(() => lib.resolveNetwork({ network: name }), /Unknown network/, name);
  }
  assert.strictEqual(lib.resolveNetwork({}).key, "testnet");
});

// ---------------------------------------------------------------- I-10

test("I-10: with a signer list, cosign takes the payee's key and submit keeps the payee's signature", async () => {
  const PAYEE = koilib.Signer.fromSeed("swarmtales test payee");
  const file = tmpFile("payee.json");
  let r = await preparePause(file, ["--payer", PAYER.getAddress(), "--payee", PAYEE.getAddress()], { ...MS_READS, contractAccounts: [MULTISIG] });
  assert.ok(r.prepared, r.error && r.error.message);
  for (const k of [KEY1, KEY2, PAYER, PAYEE]) {
    r = await run(["cosign", file], { answers: ["SIGN"], secret: k.getPrivateKey("wif") });
    assert.ifError(r.error);
  }
  const node = fakeNode({ ...MS_READS, contractAccounts: [MULTISIG] });
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.ifError(r.error);
  const sent = await koilib.Signer.recoverAddresses(node.log.sent[1].tx);
  assert.ok(sent.includes(PAYEE.getAddress()), "the payee's signature is kept");
  assert.ok(sent.includes(PAYER.getAddress()));
});

// ---------------------------------------------------------------- I-21

test("I-21: a prepared file's default mana limit is 1 mana per operation, at most 10", async () => {
  assert.deepStrictEqual([1, 3, 10, 64].map(lib.preparedRcLimit), ["100000000", "300000000", "1000000000", "1000000000"]);
  const web = await import(require("node:url").pathToFileURL(path.join(REPO, "web", "src", "lib", "admin.js")).href);
  for (const n of [1, 2, 7, 10, 30]) assert.strictEqual(web.preparedRcLimit(n), lib.preparedRcLimit(n), "the page and the tool agree for " + n);
  // A one-operation pause keeps 1 mana.
  const file = tmpFile("rc.json");
  const r = await preparePause(file);
  assert.ok(r.prepared, r.error && r.error.message);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).transaction.header.rc_limit, "100000000");
});

// ---------------------------------------------------------------- L-11

test("L-11: submit re-reads the account's next nonce and refuses a file for a used or a later nonce", async () => {
  const file = tmpFile("nonce.json");
  let r = await preparePause(file, [], { ...MS_READS, contractAccounts: [MULTISIG] }); // nonce 5
  assert.ok(r.prepared, r.error && r.error.message);
  for (const k of [KEY1, KEY2]) assert.ifError((await run(["cosign", file], { answers: ["SIGN"], secret: k.getPrivateKey("wif") })).error);
  let node = fakeNode({ ...MS_READS, contractAccounts: [MULTISIG], nonce: "KAY=" }); // the account is at 6 now
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.match(r.error.message, /nonce 5 .* already used \(the next is 6\)/);
  assert.deepStrictEqual(node.log.sent, []);
  node = fakeNode({ ...MS_READS, contractAccounts: [MULTISIG], nonce: "KAQ=" }); // the account is at 4: the file is for a later nonce
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.match(r.error.message, /nonce 5 .* but the next one is 4/);
  assert.deepStrictEqual(node.log.sent, []);
  node = fakeNode({ ...MS_READS, contractAccounts: [MULTISIG] });
  r = await run(["submit", file], { node, answers: ["SEND"] });
  assert.ifError(r.error);
});

// ---------------------------------------------------------------- L-10

test("L-10: submit shows what a whole-settings setter changes, against the chain now", async () => {
  const MOD = koilib.Signer.fromSeed("swarmtales test moderator").getAddress();
  const reads = (cfg) => ({ multisig: MULTISIG, contractAccounts: [MULTISIG], reads: { ...MS_READS.reads, "stories.get_config": cfg } });
  const file = tmpFile("moderation.json");
  // Prepared while the threshold is 3 and the strike limit 5; only the moderator changes.
  let r = await run(["set-moderation", "--admin", MULTISIG, "--stories", STORIES, "--moderator", MOD, "--prepare", file],
    { node: fakeNode(reads({ moderator: BOB_ADDR, report_threshold: 3, strike_limit: 5 })) });
  assert.ok(r.prepared, r.error && r.error.message);
  for (const k of [KEY1, KEY2]) assert.ifError((await run(["cosign", file], { answers: ["SIGN"], secret: k.getPrivateKey("wif") })).error);
  // Meanwhile someone raised the threshold to 4: submit shows the file would put it back.
  const node = fakeNode(reads({ moderator: BOB_ADDR, report_threshold: 4, strike_limit: 5 }));
  r = await run(["submit", file], { node, answers: ["no"] });
  assert.match(r.out, /stories\.set_moderation sets every one of these/);
  assert.match(r.out, /report_threshold: 4 -> 3 {3}CHANGES/);
  assert.match(r.out, /strike_limit: 5 \(unchanged\)/);
  assert.ok(r.out.includes("moderator: " + BOB_ADDR + " -> " + MOD));
});

// ---------------------------------------------------------------- L-3

test("L-3: takedown says to hide the part first when it isn't hidden, before any key is asked for", () => {
  const note = lib.takedownHideFirst({ hidden: false }, STORIES, "7", "3");
  assert.match(note, /not hidden, so its writer can still edit it/);
  assert.ok(note.includes("node deploy/deploy.js hide --actor <moderator> --stories " + STORIES + " --story 7 --seq 3"));
  assert.strictEqual(lib.takedownHideFirst({ hidden: true }, STORIES, "7", "3"), null);
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
  const body = src.slice(src.indexOf("async function cmdTakedown("), src.indexOf("async function cmdReplacePdf("));
  assert.ok(body.indexOf("lib.takedownHideFirst(") > 0 && body.indexOf("lib.takedownHideFirst(") < body.indexOf("getSigner("));
  // The live text of a part is printed with control characters made visible (H-2's rule).
  assert.match(body, /lib\.terminalSafe\(JSON\.stringify\(String\(seg\.text/);
});

// ---------------------------------------------------------------- L-9

test("L-9: set-asset reads the token's own decimals and symbol and refuses typed values that differ", async () => {
  // The pin says tKOIN / 8; a token that answers 6 decimals is refused, so is another symbol.
  let node = assetNode({ code: { [TKOIN]: TKOIN_CODE }, info: { [TKOIN]: { decimals: 6, symbol: "tKOIN" } } });
  let r = await run(setAsset([]), { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.match(r.error.message, /says it has 6 decimals, not 8/);
  assert.deepStrictEqual(node.log.sent, []);
  node = assetNode({ code: { [TKOIN]: TKOIN_CODE }, info: { [TKOIN]: { decimals: 8, symbol: "KOIN" } } });
  r = await run(setAsset([]), { node, answers: ["SEND"], secret: ADMIN.getPrivateKey("wif") });
  assert.match(r.error.message, /calls itself "KOIN", not "tKOIN"/);
  assert.throws(() => lib.checkTokenInfo(TKOIN, { decimals: 8, symbol: "tKOIN" }, { decimals: NaN, symbol: "tKOIN" }), /decimals/);
  assert.doesNotThrow(() => lib.checkTokenInfo(TKOIN, { decimals: "8", symbol: "tKOIN" }, { decimals: 8, symbol: "tKOIN" }));
});
