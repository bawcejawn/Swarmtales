#!/usr/bin/env node
/**
 * SwarmTales deploy and setup helper (Koinos testnet by default).
 *
 * Safety rules this script follows:
 *  - The private key is read ONLY from a hidden prompt (nothing is shown
 *    while you paste) or from the SWARMTALES_DEPLOY_SECRET environment
 *    variable you set in your own terminal. Never from a file or a flag.
 *  - The key is never written to disk and never printed or logged.
 *  - Testnet is the default. Mainnet is refused unless you pass BOTH
 *    --network mainnet and --i-understand-this-is-mainnet.
 *  - The node's chain id must match the network before anything is signed.
 *  - The address derived from the key must match the address you expect
 *    (for an upload, that is the future contract address).
 *  - Every write is first run as a dry run (signed, sent with broadcast
 *    off, so it is not added to a block) to show the mana it will use.
 *    Nothing is sent for real until you type SEND.
 *
 * Commands (run from the repository root, after building both contracts):
 *   node deploy/deploy.js status   --ink <addr> --shop <addr> --admin <addr> [--user <addr>]
 *   node deploy/deploy.js upload   ink|shop --expect <contract wallet address>
 *   node deploy/deploy.js set-admin ink|shop --contract <addr> --admin <addr>
 *   node deploy/deploy.js wire     --admin <addr> --ink <addr> --shop <addr> --treasury <addr> --founder <addr>
 *   node deploy/deploy.js test-asset --admin <addr> --shop <addr> [--token <addr>] [--symbol tKOIN] [--decimals 8]
 *   node deploy/deploy.js test-buy --user <addr> --shop <addr> [--tier writer|reader] [--token <addr>]
 *   node deploy/deploy.js test-promo --admin <addr> --shop <addr>
 *   node deploy/deploy.js claim-promo --account <addr> --shop <addr> --campaign <id> [--code SWARMTEST]
 *   node deploy/deploy.js user-checks --user <addr> --ink <addr> --shop <addr> --admin <addr>
 *       (dry runs only: each call must be REJECTED; nothing is ever sent)
 * Common flags: --network testnet|mainnet  --rpc <https url>
 */
"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("./lib");

const root = path.resolve(__dirname, "..");
const CONTRACTS = {
  ink: {
    wasm: path.join(root, "build", "release", "contract.wasm"),
    abi: path.join(root, "abi", "ink.abi"),
    buildHint: "npx yarn@1.22.22 build:release   (in the repository folder)",
  },
  shop: {
    wasm: path.join(root, "shop", "build", "release", "contract.wasm"),
    abi: path.join(root, "shop", "abi", "shop.abi"),
    buildHint: "cd shop; npx yarn@1.22.22 build:release; cd ..",
  },
};

function koilib() {
  try {
    return require("koilib");
  } catch (e) {
    lib.fail("koilib is not installed. Run: npx yarn@1.22.22 install --frozen-lockfile");
  }
}

function readFileOrFail(file, hint) {
  if (!fs.existsSync(file)) lib.fail("Missing " + path.relative(root, file) + ". Build first: " + hint);
  return fs.readFileSync(file);
}

function contractFiles(target) {
  const c = CONTRACTS[target];
  if (!c) lib.fail("Say which contract: ink or shop.");
  return c;
}

function loadAbiJson(target) {
  const c = contractFiles(target);
  return lib.toKoilibAbi(JSON.parse(readFileOrFail(c.abi, c.buildHint).toString("utf8")));
}

// ---------- terminal input ----------

/** Read one line with no echo. Works in PowerShell, Windows Terminal, cmd, and Unix terminals. */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    if (!stdin.isTTY) {
      reject(new lib.UserError("The hidden key prompt needs a real terminal window. Run this in PowerShell directly."));
      return;
    }
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (err) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") {
          value = "";
          return done(new lib.UserError("Cancelled."));
        }
        if (ch === "\u0008" || ch === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function readLine(prompt) {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---------- network ----------

async function connect(flags) {
  const net = lib.resolveNetwork(flags);
  const { Provider } = koilib();
  const provider = new Provider([net.rpc]);
  let chainId;
  try {
    chainId = await provider.getChainId();
  } catch (e) {
    lib.fail("Could not reach " + net.rpc + " (" + e.message + "). Check your internet and try again.");
  }
  lib.checkChainId(net, chainId);
  console.log("Network: " + net.name);
  console.log("Node:    " + net.rpc + "  (chain id verified)");
  return { net, provider };
}

/** Get the signer for `expected`. Refuses if the key controls a different address. */
async function getSigner(provider, expected, label) {
  const { Signer } = koilib();
  console.log("");
  console.log("This step must be signed by " + label + ": " + expected);
  let raw = process.env[lib.SECRET_ENV];
  if (raw) {
    console.log("Using the key from $env:" + lib.SECRET_ENV + " (not shown).");
  } else {
    raw = await readHidden("Paste the PRIVATE KEY (WIF) for that wallet, then press Enter. Nothing will show while you paste: ");
  }
  const secret = lib.classifySecret(raw);
  raw = undefined;
  let signer;
  try {
    signer =
      secret.kind === "wif"
        ? Signer.fromWif(secret.value)
        : new Signer({ privateKey: secret.value });
  } catch (e) {
    // Do not include e.message: some libraries echo their input.
    lib.fail("That key could not be read. Nothing was signed.");
  }
  secret.value = undefined;
  signer.provider = provider;
  lib.checkSignerAddress(signer.getAddress(), expected, label);
  console.log("Key matches " + expected + ".");
  return signer;
}

// ---------- the dry run then send flow ----------

async function buildTx(signer, provider, net, operations, rcLimit) {
  const { Transaction } = koilib();
  const tx = new Transaction({
    signer,
    provider,
    options: { rcLimit, chainId: net.chainId, payer: signer.getAddress() },
  });
  for (const op of operations) await tx.pushOperation(op);
  await tx.prepare();
  await tx.sign();
  return tx;
}

async function dryRunThenSend(signer, provider, net, operations, summary) {
  const payer = signer.getAddress();
  const available = await provider.getAccountRc(payer);
  console.log("");
  console.log("What will happen: " + summary);
  console.log("Mana available on " + payer + ": " + lib.formatMana(available));
  if (BigInt(available) === 0n) lib.fail("This wallet has no mana. Send it some tKOIN first, then wait a minute.");

  // Dry run: signed, submitted with broadcast=false. The node runs it and
  // returns the receipt, but it is not passed to other nodes or put in a block.
  const dry = await buildTx(signer, provider, net, operations, available);
  let receipt;
  try {
    ({ receipt } = await provider.sendTransaction(dry.transaction, false));
  } catch (e) {
    lib.fail("Dry run failed, nothing was sent: " + e.message);
  }
  if (receipt.reverted) lib.fail("Dry run reverted, nothing was sent. Logs: " + JSON.stringify(receipt.logs || []));
  console.log("Dry run OK. Mana it used: " + lib.formatMana(receipt.rc_used) + " (refills over about 5 days).");
  if (receipt.logs && receipt.logs.length) console.log("Contract logs: " + receipt.logs.join(" | "));

  const answer = await readLine("Type SEND (capital letters) to do it for real, or anything else to stop: ");
  if (!lib.isConfirmation(answer)) lib.fail("Stopped. Nothing was sent.");

  const real = await buildTx(signer, provider, net, operations, lib.rcLimitFor(receipt.rc_used, available));
  let sent;
  try {
    sent = await real.send();
  } catch (e) {
    lib.fail("Send failed: " + e.message);
  }
  console.log("");
  console.log("Transaction id: " + real.transaction.id);
  console.log("Mana used:      " + lib.formatMana(sent.rc_used));
  process.stdout.write("Waiting for it to be added to a block (up to 60 s)... ");
  try {
    const { blockNumber } = await real.wait("byBlock", 60000);
    console.log("included in block " + blockNumber + ".");
  } catch (e) {
    console.log("not seen yet. Check the transaction id on a testnet explorer in a minute.");
  }
  return real.transaction.id;
}

// ---------- commands ----------

async function cmdUpload(args) {
  const target = args.target;
  const c = contractFiles(target);
  const expected = lib.requireAddress(args.flags.expect, "expect");
  const wasm = readFileOrFail(c.wasm, c.buildHint);
  const abiText = readFileOrFail(c.abi, c.buildHint).toString("utf8");
  console.log("Uploading " + target + " (" + wasm.length + " bytes of wasm) to " + expected);
  const { net, provider } = await connect(args.flags);

  const meta = await provider.call("contract_meta_store.get_contract_meta", { contract_id: expected }).catch(() => ({}));
  if (meta && meta.meta) {
    lib.fail(expected + " already has a contract on this network. This script does not overwrite contracts.");
  }

  const signer = await getSigner(provider, expected, "the " + target + " contract wallet");
  const { Contract } = koilib();
  const contract = new Contract({ id: expected, signer, provider, bytecode: new Uint8Array(wasm) });
  // The three authorizes* flags stay false: neither contract has an
  // authorize() function, so the wallet key keeps full control.
  const { operation } = await contract.deploy({
    abi: abiText,
    authorizesCallContract: false,
    authorizesTransactionApplication: false,
    authorizesUploadContract: false,
    signTransaction: false,
    sendTransaction: false,
  });
  const txId = await dryRunThenSend(signer, provider, net, [operation], "upload the " + target + " contract to " + expected);
  console.log("");
  console.log("Contract address: " + expected);
  console.log("Send back: the transaction id above (" + txId + ") and the block number.");
}

async function cmdSetAdmin(args) {
  const target = args.target;
  contractFiles(target);
  const contractAddr = lib.requireAddress(args.flags.contract, "contract");
  const admin = lib.requireAddress(args.flags.admin, "admin");
  if (admin === contractAddr) lib.fail("The admin should be your normal wallet, not the contract address.");
  const { net, provider } = await connect(args.flags);
  const signer = await getSigner(provider, contractAddr, "the " + target + " contract wallet");
  const { Contract } = koilib();
  const contract = new Contract({ id: contractAddr, abi: loadAbiJson(target), provider });
  const op = await contract.encodeOperation({ name: "set_admin", args: { new_admin: admin } });
  const txId = await dryRunThenSend(signer, provider, net, [op], target + ".set_admin -> " + admin);
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdWire(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const ink = lib.requireAddress(f.ink, "ink");
  const shop = lib.requireAddress(f.shop, "shop");
  const treasury = lib.requireAddress(f.treasury, "treasury");
  const founder = lib.requireAddress(f.founder, "founder");
  if (ink === shop) lib.fail("Ink and Shop must be different addresses.");
  if (treasury === shop || founder === shop) lib.fail("Treasury and founder cannot be the Shop address.");
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const { Contract } = koilib();
  const inkC = new Contract({ id: ink, abi: loadAbiJson("ink"), provider });
  const shopC = new Contract({ id: shop, abi: loadAbiJson("shop"), provider });
  const ops = [
    await inkC.encodeOperation({ name: "set_minter", args: { account: shop, reasons_mask: lib.SHOP_MINT_MASK } }),
    await shopC.encodeOperation({ name: "set_addresses", args: { treasury, founder, ink, stories: "" } }),
    await shopC.encodeOperation({ name: "set_ink_amounts", args: lib.DEFAULT_INK_AMOUNTS }),
  ];
  const txId = await dryRunThenSend(
    signer,
    provider,
    net,
    ops,
    "ink.set_minter(Shop, mask 30) + shop.set_addresses + shop.set_ink_amounts, in one transaction"
  );
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdTestAsset(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  if (net.mainnet) lib.fail("test-asset is for testnet only.");
  const token = lib.requireAddress(f.token || net.koin, "token");
  const symbol = typeof f.symbol === "string" ? f.symbol : "tKOIN";
  const decimals = f.decimals === undefined ? 8 : Number(f.decimals);
  if (decimals !== 8) lib.fail("The built-in test prices assume 8 decimals.");
  const signer = await getSigner(provider, admin, "the admin wallet");
  const { Contract } = koilib();
  const shopC = new Contract({ id: shop, abi: loadAbiJson("shop"), provider });
  const ops = [await shopC.encodeOperation({ name: "set_asset", args: { token, enabled: true, decimals, symbol } })];
  for (const item of Object.keys(lib.TEST_PRICES)) {
    ops.push(await shopC.encodeOperation({ name: "set_price", args: { item: lib.SHOP_ITEMS[item], token, amount: lib.TEST_PRICES[item] } }));
  }
  const txId = await dryRunThenSend(signer, provider, net, ops, "enable " + symbol + " (" + token + ") as a TEST payment token and set small test prices");
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdTestBuy(args) {
  const f = args.flags;
  const buyer = lib.requireAddress(f.user || f.buyer, "user");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  if (net.mainnet) lib.fail("test-buy is for testnet only.");
  const token = lib.requireAddress(f.token || net.koin, "token");
  const { Contract, utils } = koilib();
  const shopC = new Contract({ id: shop, abi: loadAbiJson("shop"), provider });
  const tierName = f.tier === undefined ? "writer" : String(f.tier);
  if (tierName !== "writer" && tierName !== "reader") lib.fail("--tier must be writer or reader.");
  const tier = tierName === "writer" ? lib.TIER_WRITER : lib.TIER_READER;
  const item = tierName === "writer" ? lib.SHOP_ITEMS.ITEM_WRITER_MONTH : lib.SHOP_ITEMS.ITEM_READER_MONTH;
  const { result: priceRes } = await shopC.functions.get_price({ item, token });
  const price = priceRes && priceRes.value ? priceRes.value : "0";
  if (price === "0") lib.fail(tierName + " month has no price for that token yet. Run test-asset first.");
  console.log(tierName + " month price: " + lib.formatMana(price) + " (token base units " + price + ")");
  const signer = await getSigner(provider, buyer, "the test user wallet");
  const tokenC = new Contract({ id: token, abi: utils.tokenAbi, provider });
  const ops = [
    // Allow the Shop to move exactly the price. Shop splits it into the
    // treasury and founder legs, which together use the whole allowance.
    await tokenC.encodeOperation({ name: "approve", args: { owner: buyer, spender: shop, value: price } }),
    await shopC.encodeOperation({ name: "buy_membership", args: { payer: buyer, tier, months: 1, token } }),
  ];
  const txId = await dryRunThenSend(signer, provider, net, ops, "approve the Shop for " + price + " and buy 1 " + tierName + " month" + (tierName === "writer" ? " (mints Writer Ink)" : ""));
  console.log("Send back: the transaction id (" + txId + "). Then run status with --user to see the Ink balance.");
}

async function cmdTestPromo(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  if (net.mainnet) lib.fail("test-promo is for testnet only.");
  const signer = await getSigner(provider, admin, "the admin wallet");
  const { Contract } = koilib();
  const shopC = new Contract({ id: shop, abi: loadAbiJson("shop"), provider });
  const now = Math.floor(Date.now() / 1000);
  const p = lib.TEST_PROMO;
  const ops = [
    await shopC.encodeOperation({ name: "set_promo_enabled", args: { enabled: true } }),
    await shopC.encodeOperation({
      name: "create_campaign",
      args: {
        code: p.code,
        amount: p.amount,
        budget_total: p.budget_total,
        daily_cap: p.daily_cap,
        starts_at: String(now - 120),
        ends_at: String(now + p.days * 86400),
        single_use: false,
        enabled: true,
      },
    }),
  ];
  let nextId = "(see status)";
  try {
    const { result: cfg } = await shopC.functions.get_config();
    nextId = cfg && cfg.next_campaign_id && cfg.next_campaign_id !== "0" ? cfg.next_campaign_id : "1";
  } catch (e) {
    console.log("Could not read the next campaign id; run status afterwards to see it.");
  }
  const txId = await dryRunThenSend(
    signer, provider, net, ops,
    "turn promos on and create campaign " + nextId + ": code " + p.code + ", " + p.amount + " Ink per wallet, budget " + p.budget_total + ", " + p.days + " days"
  );
  console.log("Campaign id: " + nextId + "   Code: " + p.code);
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdClaimPromo(args) {
  const f = args.flags;
  const account = lib.requireAddress(f.account, "account");
  const shop = lib.requireAddress(f.shop, "shop");
  if (!f.campaign || !/^[1-9][0-9]*$/.test(String(f.campaign))) lib.fail("Add --campaign <id> (a number, usually 1).");
  const code = typeof f.code === "string" ? f.code : lib.TEST_PROMO.code;
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, account, "the test user wallet");
  const { Contract } = koilib();
  const shopC = new Contract({ id: shop, abi: loadAbiJson("shop"), provider });
  const op = await shopC.encodeOperation({ name: "claim_promo", args: { account, campaign_id: String(f.campaign), code } });
  const txId = await dryRunThenSend(signer, provider, net, [op], "claim promo campaign " + f.campaign + " with code " + code);
  console.log("Send back: the transaction id (" + txId + ").");
}

/** Each check must be rejected by the contract. Dry runs only; nothing is ever broadcast. */
async function cmdUserChecks(args) {
  const f = args.flags;
  const user = lib.requireAddress(f.user, "user");
  const ink = lib.requireAddress(f.ink, "ink");
  const shop = lib.requireAddress(f.shop, "shop");
  const admin = lib.requireAddress(f.admin, "admin");
  if (user === admin) lib.fail("Use the test user wallet, not the admin wallet, for these checks.");
  const { net, provider } = await connect(f);
  const token = lib.requireAddress(f.token || net.koin, "token");
  const signer = await getSigner(provider, user, "the test user wallet");
  const { Contract, utils } = koilib();
  const inkC = new Contract({ id: ink, abi: loadAbiJson("ink"), provider });
  const inkAsToken = new Contract({ id: ink, abi: utils.tokenAbi, provider });
  const shopC = new Contract({ id: shop, abi: loadAbiJson("shop"), provider });
  const available = await provider.getAccountRc(user);
  if (BigInt(available) === 0n) lib.fail("The test user wallet has no mana. Fund it first.");

  const checks = [
    ["User mints Ink to self (only approved contracts may mint)",
      () => inkC.encodeOperation({ name: "mint", args: { to: user, value: "1000", reason: 1, memo: "check" } })],
    ["User burns Ink directly (only an approved contract may burn)",
      () => inkC.encodeOperation({ name: "burn", args: { from: user, value: "1", reason: 1, memo: "check" } })],
    ["Burn with the removed reason 2 (BURN_OTHER)",
      () => inkC.encodeOperation({ name: "burn", args: { from: user, value: "1", reason: 2, memo: "check" } })],
    ["Transfer Ink to the admin (Ink is non-transferable, no transfer function)",
      () => inkAsToken.encodeOperation({ name: "transfer", args: { from: user, to: admin, value: "1" } })],
    ["User sets themselves as an Ink minter (admin only)",
      () => inkC.encodeOperation({ name: "set_minter", args: { account: user, reasons_mask: 30 } })],
    ["User changes the Shop fee to 0 (admin only)",
      () => shopC.encodeOperation({ name: "set_fee_bps", args: { fee_bps: 0 } })],
    ["User takes over Shop admin (admin only)",
      () => shopC.encodeOperation({ name: "set_admin", args: { new_admin: user } })],
    ["User buys a membership charged to the admin's wallet (payer must sign)",
      () => shopC.encodeOperation({ name: "buy_membership", args: { payer: admin, tier: lib.TIER_READER, months: 1, token } })],
    ["User claims next month's Writer Ink early (nothing is due yet)",
      () => shopC.encodeOperation({ name: "claim_writer_ink", args: { account: user } })],
  ];
  if (f.campaign) {
    checks.push(["Same wallet claims a promo a second time (one claim per wallet, ever)",
      () => shopC.encodeOperation({ name: "claim_promo", args: { account: user, campaign_id: String(f.campaign), code: lib.TEST_PROMO.code } })]);
    checks.push(["Claim a promo with a wrong code",
      () => shopC.encodeOperation({ name: "claim_promo", args: { account: user, campaign_id: String(f.campaign), code: "WRONG-CODE" } })]);
  }

  console.log("");
  console.log("Running " + checks.length + " checks as dry runs. Nothing is sent. Each one SHOULD be rejected.");
  let failed = 0;
  let unclear = 0;
  for (const [label, makeOp] of checks) {
    let verdict;
    let reason;
    try {
      const op = await makeOp();
      const tx = await buildTx(signer, provider, net, [op], available);
      const { receipt } = await provider.sendTransaction(tx.transaction, false);
      if (receipt && receipt.reverted) {
        verdict = "PASS";
        reason = (receipt.logs || []).join(" | ") || "reverted";
      } else {
        verdict = "FAIL";
        reason = "the node ACCEPTED it (it was not sent, but this should have been rejected)";
      }
    } catch (e) {
      reason = e && e.message ? e.message : String(e);
      verdict = lib.classifyRejection(reason);
    }
    if (verdict === "FAIL") failed++;
    if (verdict === "INCONCLUSIVE") unclear++;
    console.log("[" + verdict + "] " + label);
    console.log("         " + reason.slice(0, 300));
  }
  console.log("");
  console.log(failed === 0 && unclear === 0 ? "All checks rejected as expected." : failed + " FAIL, " + unclear + " INCONCLUSIVE. Send back the whole output.");
  console.log("Send back: this whole output.");
  if (failed) process.exitCode = 2;
}

async function cmdStatus(args) {
  const f = Object.assign({}, args.flags);
  if (f.user && !f.buyer) f.buyer = f.user;
  const { net, provider } = await connect(f);
  const { Contract } = koilib();
  const show = async (label, addr) => {
    if (!addr) return;
    lib.requireAddress(addr, label);
    const rc = await provider.getAccountRc(addr);
    const meta = await provider.call("contract_meta_store.get_contract_meta", { contract_id: addr }).catch(() => ({}));
    console.log(label.padEnd(7) + addr + "  mana " + lib.formatMana(rc) + (meta && meta.meta ? "  [contract uploaded]" : ""));
  };
  console.log("");
  await show("admin", f.admin);
  await show("ink", f.ink);
  await show("shop", f.shop);
  await show("user", f.buyer);
  const read = async (target, addr, name, a) => {
    try {
      const c = new Contract({ id: addr, abi: loadAbiJson(target), provider });
      const { result } = await c.functions[name](a || {});
      return result;
    } catch (e) {
      return "(not readable yet: " + e.message + ")";
    }
  };
  if (f.ink) {
    console.log("");
    console.log("ink.get_info:   " + JSON.stringify(await read("ink", f.ink, "get_info")));
    console.log("ink.get_config: " + JSON.stringify(await read("ink", f.ink, "get_config")));
    if (f.shop) console.log("ink minter mask for Shop (want 30): " + JSON.stringify(await read("ink", f.ink, "get_minter_reasons", { account: f.shop })));
    if (f.buyer) console.log("ink balance of user: " + JSON.stringify(await read("ink", f.ink, "balance_of", { owner: f.buyer })));
  }
  if (f.shop) {
    console.log("");
    console.log("shop.get_config: " + JSON.stringify(await read("shop", f.shop, "get_config")));
    console.log("shop asset " + net.koin + ": " + JSON.stringify(await read("shop", f.shop, "get_asset", { token: net.koin })));
    if (f.buyer) {
      console.log("shop membership of user: " + JSON.stringify(await read("shop", f.shop, "get_membership", { account: f.buyer })));
      console.log("shop promo claimed by user: " + JSON.stringify(await read("shop", f.shop, "get_promo_claimed", { account: f.buyer })));
    }
    console.log("shop campaign 1: " + JSON.stringify(await read("shop", f.shop, "get_campaign", { campaign_id: "1" })));
  }
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "status":
      return cmdStatus(args);
    case "upload":
      return cmdUpload(args);
    case "set-admin":
      return cmdSetAdmin(args);
    case "wire":
      return cmdWire(args);
    case "test-asset":
      return cmdTestAsset(args);
    case "test-buy":
      return cmdTestBuy(args);
    case "test-promo":
      return cmdTestPromo(args);
    case "claim-promo":
      return cmdClaimPromo(args);
    case "user-checks":
      return cmdUserChecks(args);
    default: {
      const head = fs.readFileSync(__filename, "utf8").split("*/")[0];
      console.log(head.replace(/^#!.*\n/, "").replace(/^\/\*\*?|^ \* ?/gm, ""));
      if (args.command && args.command !== "help") process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(process.exitCode || 0),
    (err) => {
      if (err instanceof lib.UserError) console.error("\nSTOPPED: " + err.message);
      else console.error("\nUnexpected error: " + (err && err.message ? err.message : String(err)));
      process.exit(1);
    }
  );
}

module.exports = { readHidden };
