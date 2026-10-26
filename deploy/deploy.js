#!/usr/bin/env node
/**
 * SwarmTales deploy and setup helper (Koinos testnet by default).
 *
 * Safety rules this script follows:
 *  - The private key is read ONLY from a hidden prompt (nothing is shown
 *    while you paste) or from the SWARMTALES_DEPLOY_SECRET environment
 *    variable you set in your own terminal. Never from a file or a flag.
 *  - The key is never written to disk and never printed or logged. The only
 *    file this script writes is a prepared multisig transaction (--prepare,
 *    cosign): operations and signatures, never a key.
 *  - Testnet is the default. Mainnet is refused unless you pass BOTH
 *    --network mainnet and --i-understand-this-is-mainnet.
 *  - On mainnet, Ink, Shop, Stories and the payment token must be the
 *    addresses pinned in deploy/lib.js (MAINNET_PINNED), and wire and
 *    wire-stories check each contract's code hash against
 *    deploy/release-hashes.json. Uploads check the wasm against that file too.
 *  - The node's chain id must match the network before anything is signed.
 *  - The address derived from the key must match the address you expect
 *    (for an upload, that is the future contract address).
 *  - Every write is first run as a dry run to show the mana it will use.
 *    The dry run is a fully SIGNED transaction sent to the node with
 *    broadcast off: an honest node runs it without adding it to a block,
 *    but a dishonest one could submit it. This script sends nothing for
 *    real until you type SEND. On mainnet, --rpc may only name a listed
 *    node, and wire-stories needs --treasury and --founder.
 *  - Flags are checked: an unknown flag, a value after a switch
 *    (--unhide x) or a repeated flag stops the run.
 *
 * Commands (run from the repository root, after building the contracts):
 *   node deploy/deploy.js status   --ink <addr> --shop <addr> --admin <addr> [--user <addr>] [--stories <addr>] [--story <id>] [--token <addr>] [--sponsor <addr>]
 *   node deploy/deploy.js upload   ink|shop|stories|sponsor --expect <contract wallet address> [--upgrade]
 *       (mainnet: only the release build pinned in deploy/release-hashes.json is uploaded)
 *       (--upgrade: replace the code of a contract that is already there; its stored data is kept. On mainnet
 *        also add --i-understand-this-replaces-mainnet-code, and follow docs/KEY_CUSTODY.md section 6)
 *   node deploy/deploy.js set-admin ink|shop|stories --contract <addr> --admin <addr> [--from <current admin>]
 *       (step 1: PROPOSES the new admin, signed by the current admin: the contract wallet the
 *        first time, or --from after that. Nothing moves yet)
 *   node deploy/deploy.js accept-admin ink|shop|stories --contract <addr> --admin <addr>
 *       (step 2: the proposed admin signs to take over, so a mistyped address can never become admin)
 *   node deploy/deploy.js pause|unpause ink|shop|stories --contract <addr> --admin <addr>
 *       (the admin stops or restarts the contract's writes; step one when a contract key leaks, docs/KEY_CUSTODY.md section 6)
 *   node deploy/deploy.js wire     --admin <addr> --ink <addr> --shop <addr> --treasury <addr> --founder <addr>
 *       (Shop's Ink address and Stories' Shop address are set once and never change (AB-050))
 *   node deploy/deploy.js set-asset --admin <addr> --shop <addr> --token <addr> --symbol <text> --decimals <n> | --disable
 *       (after the Shop's first sale, enabling a payment token starts a 7-day wait before buyers can use it. Off is at once)
 *   node deploy/deploy.js test-asset --admin <addr> --shop <addr> [--token <addr>] [--symbol tKOIN] [--decimals 8]
 *   node deploy/deploy.js test-buy --user <addr> --shop <addr> [--tier writer|reader] [--token <addr>]
 *   node deploy/deploy.js test-promo --admin <addr> --shop <addr>
 *   node deploy/deploy.js claim-promo --account <addr> --shop <addr> --campaign <id> [--sign-for <addr>]
 *       (testnet only. Asks for the promo link key, the part after k=, at a hidden prompt)
 *
 * Promos (testnet and mainnet; on mainnet add --network mainnet --i-understand-this-is-mainnet):
 *   node deploy/deploy.js promo-new --admin <addr> --shop <addr> --budget <total Ink> --end <day> [--start <day|now>] [--amount 100] [--daily-cap <Ink>] [--site <https url>]
 *       (creates a shared campaign with a fresh link key: each wallet may claim it once. Days are UTC, like 2026-12-31
 *        or 2026-12-31T18:00. Prints the share link ONCE, only to a terminal: it holds the campaign's secret key)
 *   node deploy/deploy.js promo-on  --admin <addr> --shop <addr>      (the global switch: every enabled campaign)
 *   node deploy/deploy.js promo-off --admin <addr> --shop <addr>      (stops every campaign at once)
 *   node deploy/deploy.js promo-end <campaign id> --admin <addr> --shop <addr>   (turns one campaign off)
 *
 *   node deploy/deploy.js user-checks --user <addr> --ink <addr> --shop <addr> --admin <addr>
 *       (dry runs only: each call must be REJECTED; nothing is sent for real, though each dry run is signed)
 *
 * Stories (after building stories/ and uploading it):
 *   node deploy/deploy.js wire-stories --admin <addr> --ink <addr> --shop <addr> --stories <addr> [--treasury <addr>] [--founder <addr>]
 *       (one admin transaction: stories.set_addresses, ink.set_burner, ink.set_minter mask 32,
 *        shop.set_addresses with the treasury and founder READ FROM THE CHAIN, and the 11 categories)
 *   node deploy/deploy.js test-open --user <addr> --shop <addr> --stories <addr> [--token <addr>] [--private] [--fund <ink>]
 *       (testnet: approve the Shop for the Short Story open price (times this wallet's open-price
 *        multiplier), then open a Short Story with no fixed size. --private makes it invite-only, with a
 *        writers' pool of --fund Ink (default and minimum 10000), for the invite rehearsal)
 *   node deploy/deploy.js test-invite --opener <addr> --stories <addr> --story <id> [--uses 5] [--days 7]
 *       (testnet: the opener creates a signed invite link. Only the link key's PUBLIC address
 *        goes on chain; the private key is printed once, for the share link)
 *   node deploy/deploy.js join-invite --account <addr> --stories <addr> --story <id> --invite <id> [--sign-for <addr>]
 *       (testnet: join a private story with a signed invite link. --sign-for signs for a
 *        DIFFERENT wallet on purpose, to show the contract refuses a copied signature)
 *   node deploy/deploy.js measure --user <addr> --ink <addr> --stories <addr> --story <id> [--emoji] [--sizes 100,500,1000,2000,4000]
 *       (dry runs only: mana for contributions of each size; nothing is sent for real, though each dry run is signed)
 *   node deploy/deploy.js test-write --user <addr> --ink <addr> --stories <addr> --story <id> [--size 100] [--emoji] [--text "..."]
 *       (testnet only: one contribute; dry run, then SEND. Burns Ink.
 *        --user must be the opener, unless you add --not-opener (then the chain checks
 *        Writer membership, the promo trial, and a private story's allow-list). Default is 100 units of plain text. Size is lowered to the
 *        per-submission cap and the space left. Stops if the Ink balance is too low.)
 *   node deploy/deploy.js stories-limits --admin <addr> --stories <addr> [--cap <100-6000>] [--open-limit <1-10>] [--full-price <1-10>] [--price-ceiling <1-1024>]
 *       (every limit you leave out stays as it is on chain. --full-price: open projects at the normal price;
 *        each one after doubles the price, up to --price-ceiling times the normal price)
 *
 * Moderation (Stories, October 2026):
 *   node deploy/deploy.js set-terms --admin <addr> --stories <addr> --version <n> --file <terms.md> --uri <https link>
 *       (publishes a Terms of Use version: its sha256 and link go on chain. Every new part must then carry this version)
 *   node deploy/deploy.js new-moderator-key
 *       (makes a fresh key for the automated copy checker and prints it ONCE, only to a terminal. Put it in a GitHub secret)
 *   node deploy/deploy.js set-moderation --admin <addr> --stories <addr> --moderator <addr|off> [--threshold <1-20>] [--strikes <1-20>]
 *       (--threshold and --strikes stay as they are on chain unless you give them)
 *   node deploy/deploy.js hide --actor <admin or moderator addr> --stories <addr> --story <id> --seq <n> --reason copyright|duplicate|spam|illegal|other [--note "..."] [--unhide]
 *       (with the admin key, hiding a part that is already hidden makes it an admin hide in one transaction:
 *        the opener can't restore it and removing it refunds nothing. Only the admin unhides an admin hide)
 *   node deploy/deploy.js takedown --admin <addr> --stories <addr> --story <id> --seq <n> --reason copyright|duplicate|spam|illegal|other --note "notice reference" [--strike <addr> | --no-strike]
 *       (permanent: clears the part's text and its kept versions from contract storage. No Ink refund. It first
 *        prints the writer, who last edited it, who else changed it, the live text and every kept version in full,
 *        and sends the text fingerprint and version count it showed: if the part changes first, nothing happens.
 *        A part nobody else changed is one strike for its writer. Once someone else changed it, it stops until you
 *        choose: --strike the writer or a wallet that changed it, or --no-strike)
 *   node deploy/deploy.js replace-pdf --admin <addr> --stories <addr> --story <id> [--uri <book link>]
 *       (after a takedown in a finished book: reads every live part from the chain, computes the book's text hash
 *        exactly as the website does, shows it, and publishes it. The link stays as it is unless --uri is given)
 *   node deploy/deploy.js block --admin <addr> --stories <addr> --account <addr> [--note "..."] [--unblock]
 *   node deploy/deploy.js clear-summary --actor <admin or moderator addr> --stories <addr> --story <id>
 *       (empties a story's "story so far", for copied or abusive text. Works while Stories is paused)
 *
 * Prices and Ink amounts (admin; --prepare works for a multisig admin):
 *   node deploy/deploy.js set-price --admin <addr> --shop <addr> [--token <addr>] [--reader 1] [--writer 2] [--pack-s 0.5]
 *       [--pack-m 1] [--pack-l 2] [--book 1] [--short 0.5] [--poem 0.3] [--rate <Ink per 1 token>]
 *       (prices in whole tokens, all in one transaction; 0 takes an item off sale. --rate prices the Writer month
 *        and the packs from the Ink they bring, for a newly added token)
 *   node deploy/deploy.js set-ink-amounts --admin <addr> --shop <addr> [--writer 15000] [--pack-s 5000] [--pack-m 15000]
 *       [--pack-l 45000] [--starter-book 20000] [--starter-short 10000] [--starter-poem 2000]
 *       (every amount you leave out stays as it is on chain)
 *
 * Mana sponsor (pays users' mana for SwarmTales transactions only; sponsor/):
 *   node deploy/deploy.js upload sponsor --expect <sponsor wallet address>
 *       (uploads with ONLY the "decides when this account pays" flag on; calls and uploads stay with its key)
 *   node deploy/deploy.js sponsor-config --sponsor <addr> --ink <addr> --shop <addr> --stories <addr> [--tokens <addr>,<addr>]
 *       --per-tx <mana> --per-account <mana> --per-day <mana> [--disable]
 *       (signed by the sponsor wallet's own key. --tokens: payment tokens whose approve(spender = Shop) it pays for.
 *        Caps: per transaction <= per account per day <= everyone per day <= 1000 mana. --disable switches it off)
 *
 * Multisig wallet (multisig/):
 *   node deploy/deploy.js multisig-create --expect <fresh wallet> --signers <a>,<b>,<c> [--threshold 2]
 *       (uploads the multisig contract onto a FRESH wallet and sets its signers in the same transaction,
 *        signed by that wallet's key. After it, the address acts only with the signers' quorum)
 *   node deploy/deploy.js multisig-signers --multisig <addr> --signers <a>,<b>,<c> [--threshold 2] --prepare <file.json>
 *       (replace a lost or leaked signer: prepared, then cosigned by the current quorum, then submitted)
 *
 * Multisig admin (any admin command above, when the admin is a multisig wallet):
 *   node deploy/deploy.js <admin command> <its usual flags> --prepare <file.json> [--payer <addr>] [--payee <addr>] [--rc-limit <mana>]
 *       (builds the transaction WITHOUT signing it and writes it to a new file. No key is asked. --payer pays the
 *        mana: the admin multisig itself (default) or a separate wallet, which must then also cosign. --payee: whose
 *        nonce is used (default: the payer's). --rc-limit: most mana it may use (default 1, never above the payer's))
 *   node deploy/deploy.js cosign <file.json>
 *       (each signer, on their own computer: decodes and shows every operation, refuses a file that was changed
 *        or names other contracts, then adds ONE signature from the key pasted at the hidden prompt. No network needed)
 *   node deploy/deploy.js submit <file.json> [<more copies of it>...]
 *       (joins the signatures from the copies, shows everything again, dry runs it, then sends it after SEND)
 *
 * Common flags: --network testnet|mainnet  --rpc <https url>
 * Mainnet only, after checking the address yourself: --i-understand-this-address-is-not-pinned
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const lib = require("./lib");

const root = path.resolve(__dirname, "..");
const RELEASE_HASHES = path.join(__dirname, "release-hashes.json");
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
  stories: {
    wasm: path.join(root, "stories", "build", "release", "contract.wasm"),
    abi: path.join(root, "stories", "abi", "stories.abi"),
    buildHint: "cd stories; npx yarn@1.22.22 build:release; cd ..",
  },
  // The mana sponsor has an authorize() that answers ONLY "may this account
  // pay for this transaction" (sponsor/assembly/proto/sponsor.proto). Calls
  // and code uploads stay with the sponsor wallet's own key.
  sponsor: {
    wasm: path.join(root, "sponsor", "build", "release", "contract.wasm"),
    abi: path.join(root, "sponsor", "abi", "sponsor.abi"),
    buildHint: "cd sponsor; npx yarn@1.22.22 build:release; cd ..",
    authorizesTransactionApplication: true,
  },
  // The multisig turns on all three flags: calls, payments and code uploads
  // all need its quorum. It is uploaded only by multisig-create, together
  // with its setup in the same transaction.
  multisig: {
    wasm: path.join(root, "multisig", "build", "release", "contract.wasm"),
    abi: path.join(root, "multisig", "abi", "multisig.abi"),
    buildHint: "cd multisig; npx yarn@1.22.22 build:release; cd ..",
    createdBy: "multisig-create",
  },
};

// What this run is doing: its arguments, its network once connected, and
// the --prepare file when a multisig transaction is being prepared.
const session = { args: null, net: null, prepare: null };
// Test seams (set only by deploy/__tests__, in-process): a fake node, scripted
// answers and pinned release hashes. Unset in normal runs.
const seams = { Provider: null, readLine: null, releaseHashes: null };
// A --prepare run stops after writing its file; main() treats this as success.
class Prepared extends Error {}

function koilib() {
  try {
    return require("koilib");
  } catch (e) {
    lib.fail("koilib is not installed. Run: npx yarn@1.22.22 install --frozen-lockfile");
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function readFileOrFail(file, hint) {
  if (!fs.existsSync(file)) lib.fail("Missing " + path.relative(root, file) + ". " + hint);
  return fs.readFileSync(file);
}

function contractFiles(target) {
  const c = CONTRACTS[target];
  if (!c) lib.fail("Say which contract: ink, shop, stories, sponsor or multisig.");
  return c;
}

const abiCache = {};
function loadAbiJson(target) {
  const c = contractFiles(target);
  if (!abiCache[target]) abiCache[target] = lib.toKoilibAbi(JSON.parse(readFileOrFail(c.abi, "Build first: " + c.buildHint).toString("utf8")));
  return abiCache[target];
}

function releaseHashes() {
  if (seams.releaseHashes) return seams.releaseHashes;
  return lib.parseReleaseHashes(readFileOrFail(RELEASE_HASHES, "Restore it from the repository.").toString("utf8"));
}

// Every operation made through contractOf() remembers its contract, method
// and arguments, so --prepare can describe it for the cosigners to check.
const opMeta = new WeakMap();

/** A koilib Contract for Ink, Shop or Stories at `id`, with the repository's own ABI. */
function contractOf(target, id, provider) {
  const { Contract } = koilib();
  const abi = loadAbiJson(target);
  const c = new Contract({ id, abi, provider });
  const encode = c.encodeOperation.bind(c);
  c.encodeOperation = async (op) => {
    // A stale build would silently drop an argument it doesn't know (min_ink,
    // reviewed_hash...): refuse instead.
    const method = abi.methods[op.name];
    const fields = method && method.argument ? c.serializer.root.lookupType(method.argument).fields : {};
    for (const name of Object.keys(op.args || {})) {
      if (!fields[name]) lib.fail("The built " + target + " ABI has no '" + name + "' for " + op.name + ". Rebuild it: " + CONTRACTS[target].buildHint);
    }
    const out = await encode(op);
    // What is signed must be what was shown: decode the bytes back and refuse
    // any number that wrapped around or was cut to fit (audit M-C).
    const back = await c.decodeOperation(out);
    const bad = lib.numberMismatch(op.args || {}, back.args || {});
    if (bad) {
      lib.fail(target + "." + op.name + ": " + bad.field + " = " + bad.sent + " does not fit the contract's number type (it would be signed as " +
        bad.got + "). Nothing was sent.");
    }
    opMeta.set(out, { contract: target, contract_id: id, method: op.name, args: op.args || {} });
    return out;
  };
  return c;
}

async function readOnly(provider, target, addr, name, a) {
  const { result } = await contractOf(target, addr, provider).functions[name](a || {});
  return result || {};
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
  if (seams.readLine) return Promise.resolve(seams.readLine(prompt));
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---------- network ----------

/** Resolve the network, check every contract address against the pinned ones (M-6), then the node's chain id. */
async function connect(flags, target) {
  const net = lib.resolveNetwork(flags);
  for (const warning of lib.checkPinnedFlags(net, flags, target)) console.log(warning);
  const Provider = seams.Provider || koilib().Provider;
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
  session.net = net;
  return { net, provider };
}

/** The key from the environment variable or the hidden prompt, as a koilib Signer. */
async function readKey() {
  const { Signer } = koilib();
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
    signer = secret.kind === "wif" ? Signer.fromWif(secret.value) : new Signer({ privateKey: secret.value });
  } catch (e) {
    // Do not include e.message: some libraries echo their input.
    lib.fail("That key could not be read. Nothing was signed.");
  }
  secret.value = undefined;
  return signer;
}

/**
 * Get the signer for `expected`. Refuses if the key controls a different
 * address, or a pinned mainnet address on testnet. With --prepare no key is
 * asked: the transaction is written unsigned for cosign.
 */
async function getSigner(provider, expected, label) {
  console.log("");
  if (session.prepare) {
    console.log("Preparing for " + label + " (" + expected + ") to sign later with cosign. No key is asked now.");
    return { prepared: true, getAddress: () => expected };
  }
  console.log("This step must be signed by " + label + ": " + expected);
  const signer = await readKey();
  signer.provider = provider;
  lib.checkSignerAddress(signer.getAddress(), expected, label);
  lib.refuseCrossNetworkKey(session.net, expected);
  console.log("Key matches " + expected + ".");
  return signer;
}

/** Read an invite or promo link key at the hidden prompt, never from argv (AB-013). */
async function readLinkKey(from) {
  const { Signer } = koilib();
  const raw = String(await readHidden("Paste the link key from " + from + " (the part after k=). Nothing will show while you paste: ")).trim();
  try {
    return Signer.fromWif(decodeURIComponent(raw));
  } catch (e) {
    lib.fail("That link key could not be read. Nothing was signed.");
  }
}

/**
 * The code at each address must be the reviewed release build (M-6). The
 * hash comes from the chain's get_contract_metadata system call.
 */
async function checkCodeHashes(provider, net, flags, byRole) {
  const release = releaseHashes();
  for (const role of Object.keys(byRole)) {
    let hash = null;
    try {
      hash = lib.codeHashFromMeta(await provider.invokeGetContractMetadata(byRole[role]));
    } catch (e) {
      hash = null;
    }
    const line = lib.checkCodeHash(net, role, byRole[role], hash, release, flags);
    if (line) console.log(line);
    else if (net.mainnet) console.log(role + " at " + byRole[role] + ": the reviewed release build (code hash checked).");
  }
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

/**
 * Mana this wallet can use right now. The node keeps a recent transaction's
 * whole mana limit set aside for a few minutes, even after it is in a block,
 * so that amount is subtracted.
 */
async function freeMana(provider, payer) {
  const total = BigInt(await provider.getAccountRc(payer));
  let reserved = 0n;
  try {
    const r = await provider.call("mempool.get_reserved_account_rc", { account: payer });
    if (r && r.rc) reserved = BigInt(r.rc);
  } catch {
    reserved = 0n;
  }
  return { total, reserved, free: total > reserved ? total - reserved : 0n };
}

/**
 * Show the summary, dry run, ask for SEND, send. With --prepare, write the
 * unsigned transaction instead (onPrepared runs after the file is written).
 */
async function dryRunThenSend(signer, provider, net, operations, summary, onPrepared) {
  console.log("");
  console.log("What will happen: " + summary);
  if (signer.prepared) return prepareTx(signer.getAddress(), provider, net, operations, onPrepared);
  const payer = signer.getAddress();
  const mana = await freeMana(provider, payer);
  const available = mana.free.toString();
  console.log("Mana available on " + payer + ": " + lib.formatMana(available) +
    (mana.reserved > 0n ? " (another " + lib.formatMana(mana.reserved.toString()) + " is held for a recent transaction for a few minutes)" : ""));
  if (mana.free === 0n) {
    lib.fail(mana.reserved > 0n
      ? "All of this wallet's mana is held for a recent transaction. Wait about 5 minutes and run this again."
      : "This wallet has no mana. Send it some tKOIN first, then wait a minute.");
  }

  // Dry run: signed, submitted with broadcast=false. The node runs it and
  // returns the receipt, but it is not passed to other nodes or put in a block.
  const dry = await buildTx(signer, provider, net, operations, available);
  const receipt = await dryRun(provider, dry.transaction);
  console.log("Dry run OK. Mana it used: " + lib.formatMana(receipt.rc_used) + " (refills over about 5 days).");

  const answer = await readLine("Type SEND (capital letters) to do it for real, or anything else to stop: ");
  if (!lib.isConfirmation(answer)) {
    // The dry run was a fully signed transaction (AB-009): the node that ran it
    // could still submit it until this wallet's next transaction uses its nonce.
    lib.fail("Stopped. This script sent nothing for real. The dry run was signed, though: until " + payer +
      " sends another transaction, the node at " + net.rpc + " could still submit it. If that matters, send any small transaction from this wallet.");
  }

  const real = await buildTx(signer, provider, net, operations, lib.rcLimitFor(receipt.rc_used, available));
  return broadcast(provider, real.transaction);
}

async function dryRun(provider, transaction) {
  let receipt;
  try {
    ({ receipt } = await provider.sendTransaction(transaction, false));
  } catch (e) {
    lib.fail("Dry run failed, nothing was sent: " + e.message);
  }
  if (receipt.reverted) lib.fail("Dry run reverted, nothing was sent. Logs: " + JSON.stringify(receipt.logs || []));
  if (receipt.logs && receipt.logs.length) console.log("Contract logs: " + receipt.logs.join(" | "));
  return receipt;
}

async function broadcast(provider, transaction) {
  let sent;
  try {
    ({ receipt: sent } = await provider.sendTransaction(transaction, true));
  } catch (e) {
    lib.fail("Send failed: " + e.message);
  }
  console.log("");
  console.log("Transaction id: " + transaction.id);
  if (sent && sent.rc_used) console.log("Mana used:      " + lib.formatMana(sent.rc_used));
  process.stdout.write("Waiting for it to be added to a block (up to 60 s)... ");
  try {
    const { blockNumber } = await provider.wait(transaction.id, "byBlock", 60000);
    console.log("included in block " + blockNumber + ".");
  } catch (e) {
    console.log("not seen yet. Check the transaction id on a block explorer in a minute.");
  }
  return transaction.id;
}

// ---------- multisig: prepare, cosign, submit (M-12) ----------

function verifyDeps(flags) {
  return { koilib: koilib(), abiFor: loadAbiJson, flags };
}

/** A --prepare / cosign / submit file name: a .json path. */
function txFilePath(value) {
  if (typeof value !== "string" || !/\.json$/i.test(value)) lib.fail("Give the transaction file, a name ending in .json.");
  return path.resolve(value);
}

/**
 * The only file this tool writes: a prepared transaction (its operations,
 * header and signatures; never a key). Written whole, then renamed into place.
 */
function writeTxFile(file, data, replace) {
  if (!replace && fs.existsSync(file)) lib.fail(file + " already exists. Choose a new file name. Nothing was written.");
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
}

function readTxFile(file) {
  if (!fs.existsSync(file)) lib.fail("There is no file " + file + ".");
  if (fs.statSync(file).size > 2 * 1024 * 1024) lib.fail(file + " is too large to be a prepared transaction.");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return lib.fail(file + " is not a prepared transaction file (not JSON).");
  }
}

/** Who signed so far (addresses recovered from the signatures), in order. */
async function signersOf(tx) {
  if (!tx.signatures || !tx.signatures.length) return [];
  try {
    return await koilib().Signer.recoverAddresses(tx);
  } catch (e) {
    return lib.fail("A signature in the file is not valid for this transaction. Nothing was signed or sent.");
  }
}

// A contract wallet as payer runs its own code (its authorize) inside the
// transaction, with every signer's signature on it: it could act in the
// signers' or the multisig's name (audit H-1). Only the acting account itself
// (the multisig paying for itself) or a normal wallet may pay.
const CONTRACT_PAYER = "The payer must be the acting account itself or a normal wallet, not another contract wallet: " +
  "a contract payer's code runs inside the transaction with every signature on it.";

/** true / false, or null when the node could not say. */
async function isContractWallet(provider, address) {
  try {
    const meta = await provider.call("contract_meta_store.get_contract_meta", { contract_id: address });
    return !!(meta && meta.meta);
  } catch (e) {
    return null;
  }
}

async function prepareTx(signerAddr, provider, net, operations, onPrepared) {
  const described = operations.map((op, i) => opMeta.get(op) || lib.fail(
    "This command can't be prepared for multisig signing: operation " + (i + 1) + " is not a call to Ink, Shop, Stories, the sponsor or the multisig."));
  const f = session.args.flags;
  const payer = f.payer === undefined ? signerAddr : lib.requireAddress(f.payer, "payer");
  const payee = f.payee === undefined ? undefined : lib.requireAddress(f.payee, "payee");
  if (payer !== signerAddr && (await isContractWallet(provider, payer)) !== false) lib.fail(CONTRACT_PAYER + " Nothing was written.");
  const mana = await freeMana(provider, payer);
  if (mana.free === 0n) lib.fail(payer + " (the payer) has no free mana. Give it some KOIN first, or name another --payer. Nothing was written.");
  let rcLimit = f["rc-limit"] === undefined ? lib.preparedRcLimit(operations.length) : lib.parseMana(f["rc-limit"], "--rc-limit");
  if (BigInt(rcLimit) > mana.free) {
    if (f["rc-limit"] !== undefined) lib.fail("--rc-limit is more than the " + lib.formatMana(mana.free.toString()) + " mana " + payer + " has. Nothing was written.");
    rcLimit = mana.free.toString();
  }
  const { Transaction } = koilib();
  const tx = {
    header: { chain_id: net.chainId, rc_limit: rcLimit, nonce: await provider.getNextNonce(payee || payer), payer, ...(payee && { payee }) },
    operations,
  };
  await Transaction.prepareTransaction(tx);
  // When the acting account is a multisig, write down its signers, so cosign
  // can refuse any other key and submit can count (a guide; the chain decides).
  let needs;
  try {
    const cfg = await readOnly(provider, "multisig", signerAddr, "get_config", {});
    if (cfg && Number(cfg.threshold) > 0 && Array.isArray(cfg.signers) && cfg.signers.length) {
      needs = { account: signerAddr, signers: cfg.signers, threshold: Number(cfg.threshold) };
    }
  } catch (e) {
    needs = undefined; // not a multisig (or an older node): no list
  }
  const file = lib.preparedFile(net, tx, described, session.args.command, needs);
  // Check the file exactly as every cosigner's tool will, before writing it.
  const checked = await lib.verifyPrepared(JSON.parse(JSON.stringify(file)), net, verifyDeps(f));
  writeTxFile(session.prepare, file, false);
  console.log("");
  for (const line of lib.preparedSummary(net, file, checked, [])) console.log(line);
  console.log("");
  console.log("Written, NOT signed and NOT sent: " + session.prepare);
  console.log("No dry run yet: it needs the signatures. submit runs one before anything is sent.");
  console.log("Next: each signer runs, on their own computer:  node deploy/deploy.js cosign <this file>" +
    (net.mainnet ? " --network mainnet " + lib.MAINNET_FLAG : ""));
  if (payer !== signerAddr) console.log("The payer " + payer + " (a normal wallet) must cosign too.");
  console.log("Then anyone runs:  node deploy/deploy.js submit <the signed file>" + (net.mainnet ? " --network mainnet " + lib.MAINNET_FLAG : ""));
  console.log("It stays valid until " + (payee || payer) + " uses nonce " + lib.nonceNumber(tx.header.nonce) +
    ": to cancel it, send any other transaction from that account first.");
  if (onPrepared) onPrepared();
  throw new Prepared();
}

async function cmdCosign(args) {
  const file = txFilePath(args.target);
  const data = readTxFile(file);
  const net = lib.resolveNetwork(args.flags);
  const checked = await lib.verifyPrepared(data, net, verifyDeps(args.flags));
  const signedBy = await signersOf(checked.tx);
  console.log("");
  if (process.stdout.isTTY) process.stdout.write(lib.TERMINAL_RESET);
  for (const w of checked.warnings) console.log(lib.terminalSafe(w));
  for (const line of lib.preparedSummary(net, data, checked, signedBy)) console.log(line);
  console.log("");
  console.log("Read every operation above. Sign only if it is exactly what the admins agreed to do.");
  console.log("You are signing, paid by " + checked.tx.header.payer + ":");
  for (const line of lib.preparedTargets(checked)) console.log("  " + line);
  const answer = await readLine("Type SIGN (capital letters) to add your signature, or anything else to stop: ");
  if (!lib.isConfirmation(answer, "SIGN")) lib.fail("Stopped. Nothing was signed.");
  const signer = await readKey();
  const me = signer.getAddress();
  lib.refuseCrossNetworkKey(net, me);
  if (signedBy.includes(me)) lib.fail(me + " has already signed this transaction. Nothing was changed.");
  const needs = checked.needs;
  const h = checked.tx.header;
  if (needs && !needs.signers.includes(me) && !needs.newSigners.includes(me) && me !== h.payer && me !== h.payee) {
    lib.fail("That key is for " + me + ", which is not one of the signers this transaction needs:\n  " + needs.signers.concat(needs.newSigners).join("\n  ") +
      "\nPaste one of their keys instead (a contract wallet's or the admin's key doesn't count). Nothing was signed.");
  }
  await signer.signTransaction(checked.tx);
  writeTxFile(file, data, true);
  console.log("Signed by " + me + ". Signatures now: " + (signedBy.length + 1) + ". Pass " + file + " to the next signer, or run submit.");
}

async function cmdSubmit(args) {
  const files = [args.target, ...args.rest].map(txFilePath);
  const { net, provider } = await connect(args.flags);
  // Several copies, each signed by some of the admins, are joined into one.
  let base;
  let checked;
  const signatures = [];
  for (const file of files) {
    const data = readTxFile(file);
    const c = await lib.verifyPrepared(data, net, verifyDeps(args.flags));
    if (!base) {
      base = data;
      checked = c;
    } else if (c.tx.id !== checked.tx.id || JSON.stringify(data.operations) !== JSON.stringify(base.operations)) {
      lib.fail(file + " is a different transaction from " + files[0] + ". Nothing was sent.");
    }
    for (const s of c.tx.signatures || []) if (!signatures.includes(s)) signatures.push(s);
  }
  const tx = Object.assign({}, checked.tx, { signatures });
  const signedBy = await signersOf(tx);
  const needs = checked.needs;
  // Each signer once; with a known signer list, only its signers, the new
  // signers a set_signers adds, the payer and the payee (audit I-10: the
  // payee's signature was dropped).
  const keep = (who, i) => signedBy.indexOf(who) === i &&
    (!needs || needs.signers.includes(who) || needs.newSigners.includes(who) || who === tx.header.payer || who === tx.header.payee);
  tx.signatures = signatures.filter((s, i) => keep(signedBy[i], i));
  const unique = [...new Set(signedBy.filter((who, i) => keep(who, i)))];
  if (needs) {
    const have = needs.signers.filter((s) => unique.includes(s)).length;
    if (have < needs.threshold) {
      for (const line of lib.preparedSummary(net, base, checked, unique)) console.log(line);
      lib.fail("It has " + have + " of the " + needs.threshold + " signer signatures it needs. Have more of the signers listed above run cosign. Nothing was sent.");
    }
    const missing = needs.newSigners.filter((s) => !unique.includes(s));
    if (missing.length) {
      for (const line of lib.preparedSummary(net, base, checked, unique)) console.log(line);
      lib.fail("Each new signer must sign too (the multisig refuses otherwise). Not signed yet: " + missing.join(", ") + ". Nothing was sent.");
    }
  }
  console.log("");
  if (process.stdout.isTTY) process.stdout.write(lib.TERMINAL_RESET);
  for (const w of checked.warnings) console.log(lib.terminalSafe(w));
  for (const line of lib.preparedSummary(net, base, checked, unique)) console.log(line);
  const payer = tx.header.payer;
  const payerIsContract = await isContractWallet(provider, payer);
  // A multisig transaction is paid by the multisig itself or by a normal
  // wallet that also signs, never by another contract wallet (audit H-1).
  if (needs && payer !== needs.account && payerIsContract !== false) {
    lib.fail((payerIsContract === null ? "Could not check whether the payer " + payer + " is a contract wallet. " : "") + CONTRACT_PAYER + " Nothing was sent.");
  }
  if (payerIsContract === null) console.log("Could not check whether the payer is a contract wallet; the dry run below will tell.");
  if (!payerIsContract && !unique.includes(payer)) {
    lib.fail("The payer " + payer + " is a normal wallet and has not signed. It must cosign too. Nothing was sent.");
  }
  const mana = await freeMana(provider, payer);
  if (mana.free < BigInt(tx.header.rc_limit)) {
    lib.fail("The payer has " + lib.formatMana(mana.free.toString()) + " mana free, less than this transaction's limit of " +
      lib.formatMana(tx.header.rc_limit) + ". Wait for it to refill (or add KOIN), then submit again. Nothing was sent.");
  }
  console.log("");
  console.log("What will happen: the operations above, signed by " + unique.length + " wallet(s).");
  const receipt = await dryRun(provider, tx);
  console.log("Dry run OK. Mana it used: " + lib.formatMana(receipt.rc_used) + ".");
  const answer = await readLine("Type SEND (capital letters) to send it for real, or anything else to stop: ");
  if (!lib.isConfirmation(answer)) {
    lib.fail("Stopped. Nothing was sent for real, but the signed transaction stays valid until " + (tx.header.payee || payer) +
      " uses that nonce, and the node at " + net.rpc + " has seen it.");
  }
  const txId = await broadcast(provider, tx);
  console.log("Send back: the transaction id (" + txId + ").");
}

// ---------- commands ----------

async function cmdUpload(args) {
  const target = args.target;
  const c = contractFiles(target);
  if (c.createdBy) lib.fail("Upload the " + target + " with: node deploy/deploy.js " + c.createdBy + " (it sets the signers in the same transaction).");
  const expected = lib.requireAddress(args.flags.expect, "expect");
  const wasm = readFileOrFail(c.wasm, "Build first: " + c.buildHint);
  const abiText = readFileOrFail(c.abi, "Build first: " + c.buildHint).toString("utf8");
  console.log("Uploading " + target + " (" + wasm.length + " bytes of wasm) to " + expected);
  const { net, provider } = await connect(args.flags, target);
  // The exact build that will be uploaded (AB-006, O1-13): mainnet takes only the pinned release.
  const release = lib.checkWasmHash(wasm, target, releaseHashes(), net.mainnet);
  console.log("wasm: " + (release === true ? "the release build pinned in deploy/release-hashes.json"
    : release === false ? "NOT the pinned release build (allowed on testnet only)" : "no release hash pinned yet (allowed on testnet only)"));
  // One key per contract per network: a mainnet contract wallet that already
  // has code on testnet had its key used there.
  lib.refuseCrossNetworkKey(net, expected);
  if (net.mainnet) {
    const Provider = seams.Provider || koilib().Provider;
    let onTestnet = false;
    try {
      const other = await new Provider([lib.NETWORKS.testnet.rpc]).call("contract_meta_store.get_contract_meta", { contract_id: expected });
      onTestnet = !!(other && other.meta);
    } catch (e) {
      console.log("Note: could not check that " + expected + " was never used on testnet. Make sure its key is new and mainnet-only.");
    }
    if (onTestnet) {
      lib.fail(expected + " already has a contract on TESTNET, so its key was used there. Never reuse a contract key across " +
        "networks: make a new wallet for the mainnet contract. Nothing was sent.");
    }
  }

  // On mainnet a failed lookup stops: treating it as "no contract here" would
  // skip the upgrade guard below and replace live code without its flags (AB-054).
  let meta = {};
  try {
    meta = (await provider.call("contract_meta_store.get_contract_meta", { contract_id: expected })) || {};
  } catch (e) {
    if (net.mainnet) {
      lib.fail("Could not check whether a contract is already at " + expected + " (" + (e && e.message ? e.message : String(e)) + ").\n" +
        "Nothing was sent. Try again, or with another listed node (--rpc).");
    }
  }
  // --upgrade replaces the code and keeps the contract's stored data (stories,
  // memberships, settings). On mainnet it also needs a second explicit flag; the
  // release hash check above already ran (AB-041, docs/KEY_CUSTODY.md section 6).
  if (lib.checkUpgrade(!!(meta && meta.meta), args.flags, net.mainnet, expected)) {
    console.log("UPGRADE (" + net.name + "): the code at " + expected + " will be replaced by the build above. Its stored data is kept.");
  }

  const signer = await getSigner(provider, expected, "the " + target + " contract wallet");
  const { Contract } = koilib();
  const contract = new Contract({ id: expected, signer, provider, bytecode: new Uint8Array(wasm) });
  // Ink, Shop and Stories have no authorize() function, so all three flags stay
  // false and the wallet key keeps full control. The sponsor turns on only
  // "transaction application" (who may make it pay); calls and uploads stay
  // with its key.
  const payFlag = c.authorizesTransactionApplication === true;
  if (payFlag) console.log("Authority: this contract decides when " + expected + " pays for a transaction. Calls and code uploads stay with its own key.");
  const { operation } = await contract.deploy({
    abi: abiText,
    authorizesCallContract: false,
    authorizesTransactionApplication: payFlag,
    authorizesUploadContract: false,
    signTransaction: false,
    sendTransaction: false,
  });
  const txId = await dryRunThenSend(signer, provider, net, [operation], "upload the " + target + " contract to " + expected);
  console.log("");
  console.log("Contract address: " + expected);
  if (net.mainnet) console.log("Next: pin it in deploy/lib.js (MAINNET_PINNED." + target + ") and have that one-line change reviewed.");
  console.log("Send back: the transaction id above (" + txId + ") and the block number.");
}

/**
 * Turn a fresh wallet into an m-of-n multisig: upload the multisig contract
 * with all three authority flags on AND set its first signers, in ONE
 * transaction signed by that wallet's own key. After it, the key alone can't
 * do anything for that address.
 */
async function cmdMultisigCreate(args) {
  const f = args.flags;
  const c = contractFiles("multisig");
  const expected = lib.requireAddress(f.expect, "expect");
  const plan = lib.planMultisigSigners(f.signers, f.threshold, expected);
  const wasm = readFileOrFail(c.wasm, "Build first: " + c.buildHint);
  const abiText = readFileOrFail(c.abi, "Build first: " + c.buildHint).toString("utf8");
  const { net, provider } = await connect(f, "multisig");
  const release = lib.checkWasmHash(wasm, "multisig", releaseHashes(), net.mainnet);
  console.log("wasm: " + (release === true ? "the release build pinned in deploy/release-hashes.json"
    : release === false ? "NOT the pinned release build (allowed on testnet only)" : "no release hash pinned yet (allowed on testnet only)"));
  lib.refuseCrossNetworkKey(net, expected);
  let meta = null;
  try {
    meta = await provider.call("contract_meta_store.get_contract_meta", { contract_id: expected });
  } catch (e) {
    if (net.mainnet) lib.fail("Could not check whether " + expected + " already has a contract. Nothing was sent.");
  }
  if (meta && meta.meta) lib.fail(expected + " already has a contract. A multisig is made only once, on a fresh wallet. Nothing was sent.");
  const signer = await getSigner(provider, expected, "the fresh wallet that becomes the multisig");
  const { Contract } = koilib();
  const contract = new Contract({ id: expected, signer, provider, bytecode: new Uint8Array(wasm) });
  const { operation: upload } = await contract.deploy({
    abi: abiText,
    authorizesCallContract: true,
    authorizesTransactionApplication: true,
    authorizesUploadContract: true,
    signTransaction: false,
    sendTransaction: false,
  });
  const setup = await contractOf("multisig", expected, provider).encodeOperation({ name: "setup", args: plan.args });
  console.log("Authority: after this, " + expected + " acts only with " + plan.summary + ". Its own key no longer counts.");
  const txId = await dryRunThenSend(signer, provider, net, [upload, setup],
    "upload the multisig to " + expected + " and set its signers (" + plan.summary + "), in one transaction");
  console.log("");
  console.log("Multisig address: " + expected);
  if (net.mainnet) console.log("Next: pin it in deploy/lib.js (MAINNET_PINNED.multisig) and have that one-line change reviewed.");
  console.log("Check it: node deploy/deploy.js status --multisig " + expected + (net.mainnet ? " --network mainnet " + lib.MAINNET_FLAG : ""));
  console.log("Send back: the transaction id (" + txId + ").");
}

/** Replace the multisig's signers or threshold: always prepared, then cosigned by the current quorum. */
async function cmdMultisigSigners(args) {
  const f = args.flags;
  const multisig = lib.requireAddress(f.multisig, "multisig");
  const plan = lib.planMultisigSigners(f.signers, f.threshold, multisig);
  if (!session.prepare) lib.fail("Changing signers needs the current signers' quorum: add --prepare <file.json>, then cosign and submit.");
  const { net, provider } = await connect(f, "multisig");
  const signer = await getSigner(provider, multisig, "the multisig");
  const op = await contractOf("multisig", multisig, provider).encodeOperation({ name: "set_signers", args: plan.args });
  await dryRunThenSend(signer, provider, net, [op], "multisig.set_signers: " + plan.summary);
}

/**
 * Settings of the mana sponsor: on/off, the SwarmTales contracts it pays
 * for, the payment tokens whose approve(spender = Shop) it pays for, and
 * its caps. Signed (and paid) by the sponsor wallet's own key.
 */
async function cmdSponsorConfig(args) {
  const f = args.flags;
  const sponsorAddr = lib.requireAddress(f.sponsor, "sponsor");
  const plan = lib.planSponsorConfig(f, sponsorAddr);
  const { net, provider } = await connect(f, "sponsor");
  const meta = await provider.invokeGetContractMetadata(sponsorAddr).catch(() => null);
  const m = meta && meta.value;
  if (!m || !m.hash) lib.fail("No contract at " + sponsorAddr + " yet. Upload it first: node deploy/deploy.js upload sponsor --expect " + sponsorAddr);
  if (m.authorizes_transaction_application !== true || m.authorizes_call_contract === true || m.authorizes_upload_contract === true) {
    lib.fail("The contract at " + sponsorAddr + " was not uploaded with exactly the 'pays for transactions' flag (and no other). Re-upload it with this tool.");
  }
  const signer = await getSigner(provider, sponsorAddr, "the sponsor wallet");
  const op = await contractOf("sponsor", sponsorAddr, provider).encodeOperation({ name: "set_config", args: plan.args });
  const txId = await dryRunThenSend(signer, provider, net, [op], plan.summary);
  console.log("Send back: the transaction id (" + txId + "). Check it with: node deploy/deploy.js status --sponsor " + sponsorAddr);
}

async function cmdSetAdmin(args) {
  const target = args.target;
  contractFiles(target);
  const contractAddr = lib.requireAddress(args.flags.contract, "contract");
  const admin = lib.requireAddress(args.flags.admin, "admin");
  if (admin === contractAddr) lib.fail("The admin should be your normal wallet, not the contract address.");
  // The current admin proposes: the contract wallet the first time, the admin wallet after that.
  const from = args.flags.from === undefined ? contractAddr : lib.requireAddress(args.flags.from, "from");
  const { net, provider } = await connect(args.flags, target);
  const signer = await getSigner(provider, from, from === contractAddr ? "the " + target + " contract wallet" : "the current " + target + " admin");
  const op = await contractOf(target, contractAddr, provider).encodeOperation({ name: "set_admin", args: { new_admin: admin } });
  const txId = await dryRunThenSend(signer, provider, net, [op], target + ".set_admin: PROPOSE " + admin + " (admin does not move yet)");
  console.log("Proposed. Admin moves only when " + admin + " accepts (AB-016):");
  console.log("  node deploy/deploy.js accept-admin " + target + " --contract " + contractAddr + " --admin " + admin);
  console.log("Send back: the transaction id (" + txId + ").");
}

/**
 * pause | unpause ink|shop|stories: the contract's admin stops (or restarts)
 * its writes, the first step of KEY_CUSTODY.md section 6 (AB-054).
 */
async function cmdPause(args, paused) {
  const target = args.target;
  contractFiles(target);
  const contractAddr = lib.requireAddress(args.flags.contract, "contract");
  const admin = lib.requireAddress(args.flags.admin, "admin");
  const { net, provider } = await connect(args.flags, target);
  const signer = await getSigner(provider, admin, "the " + target + " admin wallet");
  const op = await contractOf(target, contractAddr, provider).encodeOperation({ name: "set_paused", args: { paused } });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    target + ".set_paused(" + paused + "): " + (paused ? "PAUSE " : "UNPAUSE ") + target + " at " + contractAddr);
  console.log("Send back: the transaction id (" + txId + "). Check it with status.");
}

/** Step 2 of the admin handover: the proposed admin signs to take over. */
async function cmdAcceptAdmin(args) {
  const target = args.target;
  contractFiles(target);
  const contractAddr = lib.requireAddress(args.flags.contract, "contract");
  const admin = lib.requireAddress(args.flags.admin, "admin");
  const { net, provider } = await connect(args.flags, target);
  const signer = await getSigner(provider, admin, "the proposed admin wallet");
  const op = await contractOf(target, contractAddr, provider).encodeOperation({ name: "accept_admin", args: {} });
  const txId = await dryRunThenSend(signer, provider, net, [op], target + ".accept_admin: " + admin + " becomes admin");
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
  await checkCodeHashes(provider, net, f, { ink, shop });
  // Shop's Ink and Stories addresses are set once (AB-050, C1-07), and a Stories
  // link already made is kept. A failed read stops here: taken as "nothing set",
  // it would skip the check and send an empty Stories address (AB-064).
  let shopCfg;
  try {
    shopCfg = await readOnly(provider, "shop", shop, "get_config");
  } catch (e) {
    lib.fail("Could not read Shop's settings at " + shop + " (" + (e && e.message ? e.message : String(e)) + ").\n" +
      "Nothing was sent. Try again, or with another listed node (--rpc).");
  }
  lib.requireSetOnce("Shop's Ink address", shopCfg.ink, ink);
  const stories = shopCfg.stories || "";
  const signer = await getSigner(provider, admin, "the admin wallet");
  const inkC = contractOf("ink", ink, provider);
  const shopC = contractOf("shop", shop, provider);
  const ops = [
    await inkC.encodeOperation({ name: "set_minter", args: { account: shop, reasons_mask: lib.SHOP_MINT_MASK } }),
    await shopC.encodeOperation({ name: "set_addresses", args: { treasury, founder, ink, stories } }),
    await shopC.encodeOperation({ name: "set_ink_amounts", args: lib.DEFAULT_INK_AMOUNTS }),
  ];
  const txId = await dryRunThenSend(signer, provider, net, ops,
    "ink.set_minter(Shop, mask 30) + shop.set_addresses + shop.set_ink_amounts, in one transaction");
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdTestAsset(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  const token = lib.requireAddress(f.token || net.koin, "token");
  const symbol = f.symbol === undefined ? "tKOIN" : f.symbol;
  const decimals = f.decimals === undefined ? "8" : f.decimals;
  if (decimals !== "8") lib.fail("The built-in test prices assume 8 decimals.");
  const shopC = contractOf("shop", shop, provider);
  const current = await readOnly(provider, "shop", shop, "get_asset", { token });
  const ops = [];
  let what;
  if (current.enabled) {
    if (Number(current.decimals) !== 8) lib.fail("That token is enabled with " + current.decimals + " decimals; the test prices assume 8.");
    what = "set small test prices for " + token + " (already enabled; usable from " + lib.utcTime(current.usable_from || 0) + ")";
  } else {
    const sold = !!(await readOnly(provider, "shop", shop, "get_config", {})).sold;
    const plan = lib.planAsset(current, { token, enabled: true, decimals, symbol }, nowSec(), sold, await otherAssets(provider, shop, token));
    await checkTokenCode(provider, net, token, plan.args);
    ops.push(await shopC.encodeOperation({ name: "set_asset", args: plan.args }));
    what = plan.summary + ", and set small test prices";
  }
  const signer = await getSigner(provider, admin, "the admin wallet");
  for (const item of Object.keys(lib.TEST_PRICES)) {
    ops.push(await shopC.encodeOperation({ name: "set_price", args: { item: lib.SHOP_ITEMS[item], token, amount: lib.TEST_PRICES[item] } }));
  }
  const txId = await dryRunThenSend(signer, provider, net, ops, what);
  console.log("Send back: the transaction id (" + txId + "). test-buy and test-open work once the token is usable.");
}

/** set-asset: the admin turns a payment token on (at once before the Shop's first sale, after 7 days later) or off (at once). */
/** The Shop's other token records, { token, symbol }, for the one-symbol-per-token check (audit I-2). */
async function otherAssets(provider, shop, token) {
  const listed = await readOnly(provider, "shop", shop, "get_assets", {});
  const out = [];
  for (const t of listed.tokens || []) {
    if (t === token) continue;
    const a = await readOnly(provider, "shop", shop, "get_asset", { token: t });
    out.push({ token: t, symbol: a.symbol || "" });
  }
  return out;
}

/** The token's code must be its pinned code before it is enabled (audit H-3). */
async function checkTokenCode(provider, net, token, wanted) {
  let hash = null;
  try {
    hash = lib.codeHashFromMeta(await provider.invokeGetContractMetadata(token));
  } catch (e) {
    hash = null;
  }
  const warning = lib.checkTokenCode(net, token, hash, wanted);
  if (warning) console.log(warning);
  else console.log("Token code: the pinned code of " + wanted.symbol + " (" + hash + ").");
}

async function cmdSetAsset(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const token = lib.requireAddress(f.token, "token");
  const enabled = f.disable !== true;
  if (!enabled && (f.symbol !== undefined || f.decimals !== undefined)) lib.fail("--disable takes no --symbol or --decimals.");
  const { net, provider } = await connect(f);
  const current = await readOnly(provider, "shop", shop, "get_asset", { token });
  const sold = !!(await readOnly(provider, "shop", shop, "get_config", {})).sold;
  const plan = lib.planAsset(current, { token, enabled, decimals: f.decimals, symbol: f.symbol }, nowSec(), sold, await otherAssets(provider, shop, token));
  if (enabled) await checkTokenCode(provider, net, token, plan.args);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await contractOf("shop", shop, provider).encodeOperation({ name: "set_asset", args: plan.args });
  const txId = await dryRunThenSend(signer, provider, net, [op], "shop.set_asset: " + plan.summary);
  const after = await readOnly(provider, "shop", shop, "get_asset", { token });
  console.log(after.enabled ? "Enabled. Buyers can pay with it from " + lib.utcTime(after.usable_from || 0) + " (UTC). Set its prices before then."
    : "Turned off.");
  console.log("Send back: the transaction id (" + txId + ").");
}

/**
 * Prices in one payment token, several items in one transaction. Amounts in
 * whole tokens (the tool reads the token's decimals from the Shop's record).
 */
async function cmdSetPrice(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  const token = lib.requireAddress(f.token || net.koin, "token");
  const asset = await readOnly(provider, "shop", shop, "get_asset", { token });
  if (!asset || !asset.symbol) lib.fail("The Shop has no record of token " + token + ". Turn it on first with set-asset. Nothing was sent.");
  const cfg = await readOnly(provider, "shop", shop, "get_config", {});
  const plan = lib.planPrices(f, Number(asset.decimals || 0), cfg);
  const shopC = contractOf("shop", shop, provider);
  const ops = [];
  for (const p of plan) ops.push(await shopC.encodeOperation({ name: "set_price", args: { item: p.item, token, amount: p.amount } }));
  const { utils } = koilib();
  const summary = "prices in " + asset.symbol + ": " + plan.map((p) => p.name + " " + (p.amount === "0" ? "off sale" : utils.formatUnits(p.amount, Number(asset.decimals || 0)))).join(", ");
  const txId = await dryRunThenSend(await getSigner(provider, admin, "the admin wallet"), provider, net, ops, summary);
  console.log("Send back: the transaction id (" + txId + ").");
}

/** Ink each Writer month, pack and story opening brings. Flags not given keep the chain's value. */
async function cmdSetInkAmounts(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  const plan = lib.planInkAmounts(f, await readOnly(provider, "shop", shop, "get_config", {}));
  const op = await contractOf("shop", shop, provider).encodeOperation({ name: "set_ink_amounts", args: plan });
  const txId = await dryRunThenSend(await getSigner(provider, admin, "the admin wallet"), provider, net, [op], "shop.set_ink_amounts: " + JSON.stringify(plan));
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdTestBuy(args) {
  const f = args.flags;
  const buyer = lib.requireAddress(f.user || f.buyer, "user");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  const token = lib.requireAddress(f.token || net.koin, "token");
  const { utils } = koilib();
  const shopC = contractOf("shop", shop, provider);
  const tierName = f.tier === undefined ? "writer" : f.tier;
  if (tierName !== "writer" && tierName !== "reader") lib.fail("--tier must be writer or reader.");
  const tier = tierName === "writer" ? lib.TIER_WRITER : lib.TIER_READER;
  const item = tierName === "writer" ? lib.SHOP_ITEMS.ITEM_WRITER_MONTH : lib.SHOP_ITEMS.ITEM_READER_MONTH;
  const now = nowSec();
  lib.requireUsableAsset(await readOnly(provider, "shop", shop, "get_asset", { token }), now, token);
  const { result: priceRes } = await shopC.functions.get_price({ item, token });
  const price = priceRes && priceRes.value ? priceRes.value : "0";
  if (price === "0") lib.fail(tierName + " month has no price for that token yet. Run test-asset first.");
  // The Ink the buyer agrees to get for the month (M-2).
  const minInk = lib.membershipMinInk(tier, tier === lib.TIER_WRITER ? await readOnly(provider, "shop", shop, "get_membership", { account: buyer }) : null,
    await readOnly(provider, "shop", shop, "get_config"), now);
  console.log(tierName + " month price: " + lib.formatMana(price) + " (token base units " + price + ")" + (minInk !== "0" ? ", " + minInk + " Ink a month" : ""));
  const signer = await getSigner(provider, buyer, "the test user wallet");
  const tokenC = new (koilib().Contract)({ id: token, abi: utils.tokenAbi, provider });
  const ops = [
    // Allow the Shop to move exactly the price. Shop splits it into the
    // treasury and founder legs, which together use the whole allowance.
    await tokenC.encodeOperation({ name: "approve", args: { owner: buyer, spender: shop, value: price } }),
    await shopC.encodeOperation({ name: "buy_membership", args: { payer: buyer, tier, months: 1, token, max_price: price, min_ink: minInk } }),
  ];
  const txId = await dryRunThenSend(signer, provider, net, ops, "approve the Shop for " + price + " and buy 1 " + tierName + " month" + (tierName === "writer" ? " (mints " + minInk + " Writer Ink)" : ""));
  console.log("Send back: the transaction id (" + txId + "). Then run status with --user to see the Ink balance.");
}

async function cmdTestPromo(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  lib.requireTerminal(process.stdout.isTTY, "test-promo");
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const shopC = contractOf("shop", shop, provider);
  const now = nowSec();
  const p = lib.TEST_PROMO;
  // A fresh link key. Its PUBLIC address goes on chain; the private key is
  // printed once, below, as part of the share link. Nothing secret is stored.
  const { Signer } = koilib();
  const linkKey = new Signer({ privateKey: lib.newLinkKeyHex() });
  const ops = [
    await shopC.encodeOperation({ name: "set_promo_enabled", args: { enabled: true } }),
    await shopC.encodeOperation({
      name: "create_campaign",
      args: {
        link_signer: linkKey.getAddress(),
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
    "turn promos on and create campaign " + nextId + ": " + p.amount + " Ink per wallet, budget " + p.budget_total + ", " + p.days + " days"
  );
  console.log("Campaign id: " + nextId);
  console.log("Promo link key (secret, for the share link only): " + linkKey.getPrivateKey("wif"));
  console.log("Share link (replace the host with your site): https://YOUR-SITE/#/promo/" + nextId + "?k=" + linkKey.getPrivateKey("wif"));
  console.log("To claim from the CLI: node deploy/deploy.js claim-promo --account <addr> --shop " + shop + " --campaign " + nextId);
  console.log("  (it asks for the link key at a hidden prompt: paste the part after k=)");
  console.log("Send back: the transaction id (" + txId + ").");
}

// ---------- promo admin (testnet and mainnet) ----------

/**
 * promo-new: one shared campaign with a fresh link key. Only the key's PUBLIC
 * address goes on chain. The share link (which holds the private key) is
 * printed once, to a terminal only, after the campaign is created (or, with
 * --prepare, after the unsigned transaction is written); it never appears in
 * the dry-run summary, an error or a log file.
 */
async function cmdPromoNew(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const plan = lib.planPromoCampaign(f, nowSec());
  const site = f.site === undefined ? lib.DEFAULT_SITE : f.site;
  lib.promoShareLink(site, "1", "check"); // stop on a bad --site before anything is signed
  lib.requireTerminal(process.stdout.isTTY, "promo-new");
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const { Signer } = koilib();
  const shopC = contractOf("shop", shop, provider);
  const { result: cfg } = await shopC.functions.get_config();
  const nextId = cfg && cfg.next_campaign_id && cfg.next_campaign_id !== "0" ? String(cfg.next_campaign_id) : "1";
  const linkKey = new Signer({ privateKey: lib.newLinkKeyHex() });
  const op = await shopC.encodeOperation({
    name: "create_campaign",
    args: { ...plan, link_signer: linkKey.getAddress() },
  });
  const day = (sec) => lib.utcTime(sec);
  const txId = await dryRunThenSend(signer, provider, net, [op],
    "create promo campaign " + nextId + ": " + plan.amount + " Ink per wallet (each wallet may claim it once), budget " +
    plan.budget_total + " Ink" + (plan.daily_cap !== "0" ? ", at most " + plan.daily_cap + " Ink a day" : "") +
    ", from " + day(plan.starts_at) + " to " + day(plan.ends_at),
    () => {
      console.log("");
      console.log("The campaign exists only once this transaction is submitted. Its id will be " + nextId + " unless another campaign");
      console.log("is created first: after submit, check with status that campaign " + nextId + "'s link_signer is " + linkKey.getAddress() + ".");
      printLink();
    });
  // Make sure the id printed in the link is the campaign this transaction made.
  const { result: made } = await shopC.functions.get_campaign({ campaign_id: nextId });
  if (!made || made.link_signer !== linkKey.getAddress()) {
    lib.fail("The campaign was created (transaction " + txId + "), but campaign " + nextId + " is not the one it made\n" +
      "(another campaign was created at the same time). Turn it off with promo-end and run promo-new again.");
  }
  printLink();
  if (!(cfg && cfg.promo_enabled)) console.log("Promos are switched off for everyone. Turn them on with promo-on when you are ready.");
  console.log("Send back: the transaction id (" + txId + ") and the campaign id. Never the link.");

  function printLink() {
    console.log("");
    console.log("Campaign id: " + nextId);
    console.log("Share link (shown once; it holds the campaign's secret key. Copy it now and do not paste it into a log or issue):");
    console.log("  " + lib.promoShareLink(site, nextId, linkKey.getPrivateKey("wif")));
  }
}

/** promo-on / promo-off: the global switch for every campaign. */
async function cmdPromoSwitch(args, enabled) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await contractOf("shop", shop, provider).encodeOperation({ name: "set_promo_enabled", args: { enabled } });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    enabled ? "turn promos ON (every enabled campaign can be claimed within its dates)" : "turn promos OFF for every campaign");
  console.log("Send back: the transaction id (" + txId + ").");
}

/** promo-end <id>: switch one campaign off for good (it can be switched on again with set_campaign_enabled). */
async function cmdPromoEnd(args) {
  const f = args.flags;
  if (args.target !== undefined && f.campaign !== undefined) lib.fail("Give the campaign id once: promo-end <id> or --campaign <id>.");
  const id = lib.requireCampaignId(args.target !== undefined ? args.target : f.campaign);
  const admin = lib.requireAddress(f.admin, "admin");
  const shop = lib.requireAddress(f.shop, "shop");
  const { net, provider } = await connect(f);
  const shopC = contractOf("shop", shop, provider);
  const { result: row } = await shopC.functions.get_campaign({ campaign_id: id });
  if (!row || (!row.link_signer && !row.amount)) lib.fail("Shop " + shop + " has no campaign " + id + ".");
  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await shopC.encodeOperation({ name: "set_campaign_enabled", args: { campaign_id: id, enabled: false } });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    "turn OFF promo campaign " + id + " (" + (row.amount || "?") + " Ink per wallet, " + (row.budget_used || "0") + " of " + (row.budget_total || "?") + " Ink given)");
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdClaimPromo(args) {
  const f = args.flags;
  const account = lib.requireAddress(f.account, "account");
  const shop = lib.requireAddress(f.shop, "shop");
  if (!/^[1-9][0-9]*$/.test(String(f.campaign || ""))) lib.fail("Add --campaign <id> (a number, usually 1).");
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, account, "the test user wallet");
  const { utils } = koilib();
  const shopC = contractOf("shop", shop, provider);
  // Sign "promo / this shop / campaign / this account" with the link key.
  const linkKey = await readLinkKey("the promo link");
  // --sign-for signs for a DIFFERENT wallet on purpose: the dry run must be refused.
  const signedFor = f["sign-for"] === undefined ? account : lib.requireAddress(f["sign-for"], "sign-for");
  if (signedFor !== account) console.log("Signing for " + signedFor + " but claiming as " + account + ". The contract should refuse this.");
  const message = lib.promoMessage(utils.decodeBase58(shop), f.campaign, utils.decodeBase58(signedFor));
  const signature = await linkKey.signHash(lib.sha256(message));
  // koilib takes bytes fields as base64url text.
  const op = await shopC.encodeOperation({ name: "claim_promo", args: { account, campaign_id: f.campaign, signer: "", signature: utils.encodeBase64url(signature) } });
  const txId = await dryRunThenSend(signer, provider, net, [op], "claim promo campaign " + f.campaign + " with its signed link");
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
  if (f.campaign !== undefined && !/^[1-9][0-9]*$/.test(f.campaign)) lib.fail("--campaign must be a campaign id (a number).");
  const { net, provider } = await connect(f);
  const token = lib.requireAddress(f.token || net.koin, "token");
  const signer = await getSigner(provider, user, "the test user wallet");
  const { Contract, Signer, utils } = koilib();
  const inkC = contractOf("ink", ink, provider);
  const inkAsToken = new Contract({ id: ink, abi: utils.tokenAbi, provider });
  const shopC = contractOf("shop", shop, provider);
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
      () => shopC.encodeOperation({ name: "buy_membership", args: { payer: admin, tier: lib.TIER_READER, months: 1, token, max_price: "18446744073709551615", min_ink: "0" } })],   // any price: only the missing signature may refuse it
    ["User claims next month's Writer Ink early (nothing is due yet)",
      () => shopC.encodeOperation({ name: "claim_writer_ink", args: { account: user } })],
  ];
  if (f.campaign) {
    // A real, well-formed signature from a throwaway key that is NOT the
    // campaign's link key. The network accepts its shape, so the refusal has
    // to come from the Shop's own link check ("promo link rejected").
    const probeKey = Signer.fromSeed("swarmtales-user-checks-probe-" + Date.now() + "-" + Math.random());
    const bogusSig = await probeKey.signHash(lib.sha256(lib.promoMessage(utils.decodeBase58(shop), f.campaign, utils.decodeBase58(user))));
    checks.push(["Claim a promo with a signature from the wrong link key (the Shop must say \"promo link rejected\")",
      () => shopC.encodeOperation({ name: "claim_promo", args: { account: user, campaign_id: f.campaign, signer: "", signature: utils.encodeBase64url(bogusSig) } })]);
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

// ---------- Stories ----------

async function cmdWireStories(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const ink = lib.requireAddress(f.ink, "ink");
  const shop = lib.requireAddress(f.shop, "shop");
  const stories = lib.requireAddress(f.stories, "stories");
  if (new Set([ink, shop, stories]).size !== 3) lib.fail("Ink, Shop and Stories must be three different addresses.");
  if (stories === admin) lib.fail("Stories is a contract address, not the admin wallet.");
  const { net, provider } = await connect(f);
  // On mainnet each contract must run the reviewed release build (M-6).
  await checkCodeHashes(provider, net, f, { ink, shop, stories });

  // shop.set_addresses replaces ALL FOUR addresses. Read the current
  // treasury and founder from the Shop itself and send them back unchanged.
  const shopCfg = await readOnly(provider, "shop", shop, "get_config");
  const shopArgs = lib.shopAddressesForStories(shopCfg, {
    ink,
    stories,
    treasury: f.treasury === undefined ? undefined : lib.requireAddress(f.treasury, "treasury"),
    founder: f.founder === undefined ? undefined : lib.requireAddress(f.founder, "founder"),
    mainnet: net.mainnet,
  });
  const storiesCfg = await readOnly(provider, "stories", stories, "get_config");
  if (storiesCfg.admin !== admin) {
    lib.fail("Stories admin is " + (storiesCfg.admin || "(not readable)") + ", not " + admin + ". Run set-admin stories first.");
  }
  // Stories' Ink and Shop addresses are set once (AB-037, AB-050).
  lib.requireSetOnce("Stories' Ink address", storiesCfg.ink, ink);
  lib.requireSetOnce("Stories' Shop address", storiesCfg.shop, shop);
  const haveCategories = Number(storiesCfg.next_category_id || 0) > 1;

  console.log("");
  console.log("Shop addresses that will be sent (treasury and founder copied from the chain):");
  console.log("  treasury " + shopArgs.treasury);
  console.log("  founder  " + shopArgs.founder);
  console.log("  ink      " + shopArgs.ink);
  console.log("  stories  " + shopArgs.stories);

  const signer = await getSigner(provider, admin, "the admin wallet");
  const inkC = contractOf("ink", ink, provider);
  const shopC = contractOf("shop", shop, provider);
  const storiesC = contractOf("stories", stories, provider);
  const ops = [
    await storiesC.encodeOperation({ name: "set_addresses", args: { ink, shop } }),
    await inkC.encodeOperation({ name: "set_burner", args: { account: stories, allowed: true } }),
    await inkC.encodeOperation({ name: "set_minter", args: { account: stories, reasons_mask: lib.STORIES_MINT_MASK } }),
    await shopC.encodeOperation({ name: "set_addresses", args: shopArgs }),
  ];
  if (!haveCategories) {
    for (const name of lib.STORY_CATEGORIES) ops.push(await storiesC.encodeOperation({ name: "add_category", args: { name } }));
  } else {
    console.log("Stories already has categories; they are left as they are.");
  }
  const txId = await dryRunThenSend(
    signer, provider, net, ops,
    "stories.set_addresses + ink.set_burner(Stories) + ink.set_minter(Stories, mask 32 = refunds only) + shop.set_addresses (treasury/founder unchanged)" +
      (haveCategories ? "" : " + " + lib.STORY_CATEGORIES.length + " categories") + ", in one transaction"
  );
  console.log("Send back: the transaction id (" + txId + "). Then run status with --stories.");
}

async function cmdTestOpen(args) {
  const f = args.flags;
  const user = lib.requireAddress(f.user, "user");
  const shop = lib.requireAddress(f.shop, "shop");
  const stories = lib.requireAddress(f.stories, "stories");
  const isPrivate = f.private === true;
  const fund = isPrivate ? (f.fund === undefined ? "10000" : f.fund) : "0";
  if (!isPrivate && f.fund !== undefined) lib.fail("--fund is only for a --private story.");
  if (isPrivate && (!/^[0-9]+$/.test(fund) || BigInt(fund) < 10000n)) lib.fail("--fund must be a whole number of Ink, at least 10000.");
  const { net, provider } = await connect(f);
  const token = lib.requireAddress(f.token || net.koin, "token");
  const { Contract, utils } = koilib();
  const shopC = contractOf("shop", shop, provider);
  const storiesC = contractOf("stories", stories, provider);
  const termsVersion = Number((await readOnly(provider, "stories", stories, "get_config")).terms_version || 0);
  lib.requireUsableAsset(await readOnly(provider, "shop", shop, "get_asset", { token }), nowSec(), token);
  const { result: priceRes } = await shopC.functions.get_price({ item: lib.SHOP_ITEMS.ITEM_OPEN_SHORT, token });
  const basePrice = priceRes && priceRes.value ? priceRes.value : "0";
  if (basePrice === "0") lib.fail("Opening a Short Story has no price for that token yet. Run test-asset first.");
  // The starter Ink the opener agrees to get (M-2).
  const minInk = String((await readOnly(provider, "shop", shop, "get_config")).starter_short || "0");
  if (minInk === "0") lib.fail("Could not read the Shop's starter Ink for a Short Story. Nothing was sent.");
  // Beyond the normal-price projects, the price doubles (up to a ceiling).
  const multRes = await readOnly(provider, "stories", stories, "get_open_multiplier", { account: user }).catch(() => null);
  const multiplier = multRes && multRes.value ? Number(multRes.value) : 1;
  const price = (BigInt(basePrice) * BigInt(multiplier)).toString();
  if (multiplier > 1) console.log("This wallet already has open projects: the price is " + multiplier + "x the normal price.");
  const text = "The first line of a SwarmTales test story.";
  const signer = await getSigner(provider, user, "the test user wallet");
  const tokenC = new Contract({ id: token, abi: utils.tokenAbi, provider });
  const ops = [
    await tokenC.encodeOperation({ name: "approve", args: { owner: user, spender: shop, value: price } }),
    await storiesC.encodeOperation({
      name: "open_story",
      args: {
        opener: user,
        kind: lib.STORY_KIND.SHORT,
        title: isPrivate ? "Testnet Private Story" : "Testnet Short Story",
        max_chars: "0",
        category_1: 1,
        category_2: 0,
        visibility: isPrivate ? lib.STORY_VISIBILITY.PRIVATE : lib.STORY_VISIBILITY.PUBLIC,
        free_chapters: 0,
        contributor_edition_min: "0",
        opening_text: text,
        ai_assisted: false,
        expected_ink: String(lib.inkCost(text)),
        token,
        rights_confirmed: true,
        terms_version: termsVersion,
        fund,
        max_price: price,   // the price read above: Shop charges no more (AB-017)
        min_ink: minInk,    // the starter Ink read above: Shop mints no less (M-2)
      },
    }),
  ];
  const txId = await dryRunThenSend(
    signer, provider, net, ops,
    "approve the Shop for " + price + " (Short Story open price), then open a Short Story with no fixed size (Shop mints " + minInk +
      " starter Ink; the opening line burns " + lib.inkCost(text) + " Ink" + (isPrivate ? "; " + fund + " Ink goes into the writers' pool" : "") + ")"
  );
  console.log("Send back: the transaction id (" + txId + "). The new story id is shown by status --stories --story 1 (or the next number).");
}

async function cmdTestInvite(args) {
  const f = args.flags;
  const opener = lib.requireAddress(f.opener, "opener");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const uses = f.uses === undefined ? 5 : lib.wholeInRange(f.uses, "--uses", 1, 1000);
  const days = f.days === undefined ? 7 : lib.wholeInRange(f.days, "--days", 1, 365);
  lib.requireTerminal(process.stdout.isTTY, "test-invite");
  const { net, provider } = await connect(f);
  const st = await readOnly(provider, "stories", stories, "get_story", { story_id: storyId });
  lib.assertStoryOpener(storyId, st.opener, opener);
  const inviteId = st.next_invite_id && st.next_invite_id !== "0" ? st.next_invite_id : "1";

  // A fresh link key. Only its PUBLIC address goes on chain.
  const { Signer } = koilib();
  const linkKey = new Signer({ privateKey: lib.newLinkKeyHex() });
  const signer = await getSigner(provider, opener, "the story opener");
  const expiresAt = String(nowSec() + days * 86400);
  const op = await contractOf("stories", stories, provider).encodeOperation({
    name: "create_invite",
    args: { opener, story_id: storyId, link_signer: linkKey.getAddress(), max_uses: uses, expires_at: expiresAt },
  });
  const txId = await dryRunThenSend(
    signer, provider, net, [op],
    "create invite " + inviteId + " on story " + storyId + ": " + uses + " uses, " + days + " days. Stored on chain: link key address " + linkKey.getAddress() + " only"
  );
  const wif = linkKey.getPrivateKey("wif");
  console.log("Invite id: " + inviteId);
  console.log("Invite link key (goes in the share link only): " + wif);
  console.log("Share link (replace the host with your site): https://YOUR-SITE/#/join/" + storyId + "/" + inviteId + "?k=" + wif);
  console.log("To join from the CLI: node deploy/deploy.js join-invite --account <addr> --stories " + stories + " --story " + storyId + " --invite " + inviteId);
  console.log("  (it asks for the link key at a hidden prompt: paste the part after k=)");
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdJoinInvite(args) {
  const f = args.flags;
  const account = lib.requireAddress(f.account, "account");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  if (!/^[1-9][0-9]*$/.test(String(f.invite || ""))) lib.fail("Add --invite <id> (a number, usually 1).");
  const { net, provider } = await connect(f);
  const { utils } = koilib();
  // --sign-for signs for a DIFFERENT wallet on purpose: the dry run must be refused.
  const signedFor = f["sign-for"] === undefined ? account : lib.requireAddress(f["sign-for"], "sign-for");
  if (signedFor !== account) console.log("Signing for " + signedFor + " but joining as " + account + ". The contract should refuse this.");
  const linkKey = await readLinkKey("the invite link");
  const message = lib.inviteMessage(utils.decodeBase58(stories), storyId, f.invite, utils.decodeBase58(signedFor));
  const signature = await linkKey.signHash(lib.sha256(message));
  const signer = await getSigner(provider, account, "the joining wallet");
  const op = await contractOf("stories", stories, provider).encodeOperation({
    name: "join_with_invite",
    args: { account, story_id: storyId, invite_id: f.invite, signature: utils.encodeBase64url(signature) },
  });
  const txId = await dryRunThenSend(signer, provider, net, [op], "join story " + storyId + " with invite " + f.invite + " (signed link)");
  console.log("Send back: the transaction id (" + txId + ").");
}

/** Dry runs only: never broadcast. Shows the mana each contribution size would use. */
async function cmdMeasure(args) {
  const f = args.flags;
  const user = lib.requireAddress(f.user, "user");
  const ink = lib.requireAddress(f.ink, "ink");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const sizes = f.sizes === undefined ? lib.MEASURE_SIZES : f.sizes.split(",").map((x) => lib.wholeInRange(x.trim(), "--sizes", 1, lib.CONTRIBUTION_CAP_MAX));
  const emoji = f.emoji === true;
  const { net, provider } = await connect(f);
  const cfg = await readOnly(provider, "stories", stories, "get_config");
  const termsVersion = Number(cfg.terms_version || 0);
  const st = await readOnly(provider, "stories", stories, "get_story", { story_id: storyId });
  lib.assertStoryOpener(storyId, st.opener, user);
  const bal = await readOnly(provider, "ink", ink, "balance_of", { owner: user });
  const cap = Number(cfg.contribution_cap || lib.CONTRIBUTION_CAP_MAX);
  const left = BigInt(st.max_chars || "0") - BigInt(st.used_chars || "0");
  console.log("Per-submission cap now: " + cap + "   Ink balance: " + (bal.value || "0") + "   Space left in story: " + left);

  const signer = await getSigner(provider, user, "the test user wallet");
  const storiesC = contractOf("stories", stories, provider);
  const available = await provider.getAccountRc(user);
  if (BigInt(available) === 0n) lib.fail("The test user wallet has no mana. Fund it first.");
  console.log("");
  console.log("Dry runs only. Nothing is sent. " + (emoji ? "Text includes emoji." : "Plain text."));
  console.log("size  | result   | mana (rc)  | disk | network | compute");
  for (const size of sizes) {
    const text = lib.measurementText(size, emoji);
    let line = String(size).padEnd(5) + " | ";
    if (size > cap) {
      console.log(line + "skipped  | over the cap " + cap + ". Raise it first: stories-limits --cap " + Math.min(4000, size));
      continue;
    }
    try {
      const op = await storiesC.encodeOperation({
        name: "contribute",
        args: {
          author: user, story_id: storyId, text, starts_chapter: false, ai_assisted: false,
          expected_ink: String(lib.inkCost(text)), rights_confirmed: true, terms_version: termsVersion,
        },
      });
      const tx = await buildTx(signer, provider, net, [op], available);
      const { receipt } = await provider.sendTransaction(tx.transaction, false);
      if (receipt.reverted) {
        line += "REVERTED | " + (receipt.logs || []).join(" | ");
      } else {
        line += "ok       | " + lib.formatMana(receipt.rc_used).padEnd(10) + " | " + String(receipt.disk_storage_used || 0).padEnd(4) + " | " +
          String(receipt.network_bandwidth_used || 0).padEnd(7) + " | " + String(receipt.compute_bandwidth_used || 0);
      }
    } catch (e) {
      line += "REJECTED | " + String(e && e.message ? e.message : e).slice(0, 200);
    }
    console.log(line);
  }
  console.log("");
  console.log("Send back: this whole table.");
}

/** Testnet only. One contribute from the story opener, dry run, then SEND. Burns Ink. */
async function cmdTestWrite(args) {
  const f = args.flags;
  const user = lib.requireAddress(f.user, "user");
  const ink = lib.requireAddress(f.ink, "ink");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const { net, provider } = await connect(f);

  const cfg = await readOnly(provider, "stories", stories, "get_config");
  const st = await readOnly(provider, "stories", stories, "get_story", { story_id: storyId });
  if (f["not-opener"] === true) {
    console.log("Writing as " + user + ", who is not the opener. The chain will check Writer membership,");
    console.log("the promo trial, and (for a private story) the allow-list. A refusal shows in the dry run.");
  } else {
    lib.assertStoryOpener(storyId, st.opener, user);
  }
  const bal = await readOnly(provider, "ink", ink, "balance_of", { owner: user });
  const plan = lib.planTestWrite(
    { size: f.size, emoji: f.emoji === true, text: f.text },
    {
      cap: cfg.contribution_cap,
      maxChars: st.max_chars,
      usedChars: st.used_chars || "0",
      balance: bal.value,
    }
  );

  const kind = plan.custom ? "the text you supplied" : (plan.emoji ? "sample text with emoji" : "plain sample text");
  const cappedNote = plan.capped
    ? " Requested " + plan.requested + "; lowered to " + plan.cost + " (per-submission cap " + plan.cap + ", space left " + plan.spaceLeft + ")."
    : "";
  console.log("");
  if (f["not-opener"] !== true) console.log("Story " + storyId + " opener matches " + user + ".");
  console.log("Ink balance: " + plan.balance + "    this write: " + plan.cost + "    cap: " + plan.cap + "    space left: " + plan.spaceLeft);

  const signer = await getSigner(provider, user, "the test user wallet");
  const op = await contractOf("stories", stories, provider).encodeOperation({
    name: "contribute",
    args: {
      author: user,
      story_id: storyId,
      text: plan.text,
      starts_chapter: false,
      ai_assisted: false,
      expected_ink: plan.cost,
      rights_confirmed: true,
      terms_version: Number(cfg.terms_version || 0),
    },
  });
  const txId = await dryRunThenSend(
    signer, provider, net, [op],
    "stories.contribute on story " + storyId + ": burn " + plan.cost + " Ink (" + kind + ")." + cappedNote
  );
  console.log("Send back: the transaction id (" + txId + "). Then run status with --user and --story.");
}

async function cmdStoriesLimits(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const stories = lib.requireAddress(f.stories, "stories");
  const { net, provider } = await connect(f);
  // Limits not given stay as they are on chain; the cap never goes above 6,000 (O1-12).
  const limits = lib.planStoriesLimits(f, await readOnly(provider, "stories", stories, "get_config"));
  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await contractOf("stories", stories, provider).encodeOperation({ name: "set_limits", args: limits });
  const txId = await dryRunThenSend(signer, provider, net, [op], "stories.set_limits: per-part cap " + limits.contribution_cap +
    ", open projects per wallet " + limits.open_limit + " (all limits: " + JSON.stringify(limits) + ")");
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdBlock(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const stories = lib.requireAddress(f.stories, "stories");
  const account = lib.requireAddress(f.account, "account");
  const blocked = f.unblock !== true;
  const note = f.note === undefined ? "" : f.note;
  if (note.length > 200) lib.fail("--note must be at most 200 characters.");
  const { net, provider } = await connect(f);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await contractOf("stories", stories, provider).encodeOperation({ name: "set_blocked", args: { account, blocked, note } });
  const txId = await dryRunThenSend(signer, provider, net, [op], (blocked ? "BLOCK " : "UNBLOCK ") + account + (note ? " (" + note + ")" : ""));
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdSetTerms(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const stories = lib.requireAddress(f.stories, "stories");
  const version = lib.wholeInRange(f.version, "--version", 1, 4294967295);
  if (!f.file || !fs.existsSync(f.file)) lib.fail("--file must point to the Terms of Use text you are publishing.");
  const uri = String(f.uri || "");
  if (!/^[\x21-\x7e]{1,200}$/.test(uri)) lib.fail("--uri must be the link where the terms are published (1 to 200 plain characters).");
  // Fingerprint the text with Unix line endings, whatever computer this runs
  // on, so it matches the file the website serves.
  const text = fs.readFileSync(f.file, "utf8").replace(/\r\n/g, "\n");
  const hash = lib.sha256(Buffer.from(text, "utf8"));
  const { net, provider } = await connect(f);
  const cfg = await readOnly(provider, "stories", stories, "get_config");
  if (version <= Number(cfg.terms_version || 0)) lib.fail("The chain is already at version " + cfg.terms_version + ". Use a higher number.");
  const signer = await getSigner(provider, admin, "the admin wallet");
  const { utils } = koilib();
  const op = await contractOf("stories", stories, provider).encodeOperation({
    name: "set_terms",
    args: { version, terms_hash: utils.encodeBase64url(hash), terms_uri: uri },
  });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    "stories.set_terms: version " + version + ", sha256 " + Buffer.from(hash).toString("hex") + ", link " + uri);
  console.log("Send back: the transaction id (" + txId + "). The website reads the new version from the chain by itself.");
}

async function cmdNewModeratorKey() {
  // The WIF goes to a terminal only, never into a file or pipe (O1-14).
  lib.requireTerminal(process.stdout.isTTY, "new-moderator-key");
  const { Signer } = koilib();
  const key = new Signer({ privateKey: lib.newLinkKeyHex() });
  console.log("");
  console.log("A new key for the automated copy checker (the moderator). It is shown ONCE and saved nowhere.");
  console.log("It can only hide story parts, unhide ones the admin didn't hide, and clear a story summary. It can't remove text, move Ink, or change settings.");
  console.log("");
  console.log("  Moderator address (safe to share): " + key.getAddress());
  console.log("  Private key (put it in the GitHub secret MODERATOR_WIF, then clear this window):");
  console.log("  " + key.getPrivateKey("wif", true));
  console.log("");
  console.log("Never paste the private key into a chat, an email or a file in the repository.");
}

async function cmdSetModeration(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const stories = lib.requireAddress(f.stories, "stories");
  const { net, provider } = await connect(f);
  // The threshold and strike limit stay as they are unless given (O1-11).
  const cfg = await readOnly(provider, "stories", stories, "get_config");
  const m = lib.planModeration(f, cfg);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await contractOf("stories", stories, provider).encodeOperation({ name: "set_moderation", args: m });
  const same = (given) => (given === undefined ? " (unchanged)" : "");
  const txId = await dryRunThenSend(signer, provider, net, [op],
    "stories.set_moderation: moderator " + (m.moderator || "OFF") + ", " + m.report_threshold + " writer reports hide a part" + same(f.threshold) +
    ", " + m.strike_limit + " takedowns block a wallet" + same(f.strikes));
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdHide(args) {
  const f = args.flags;
  const actor = lib.requireAddress(f.actor, "actor (the admin or moderator address)");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const seq = lib.requireStoryId(f.seq);
  const hidden = f.unhide !== true;
  if (!hidden && f.reason !== undefined) lib.fail("--unhide takes no --reason.");
  const reason = hidden ? lib.requireReason(f.reason) : 0;
  const note = f.note === undefined ? "" : f.note;
  if (note.length > 200) lib.fail("--note must be at most 200 characters.");
  const { net, provider } = await connect(f);
  const storiesC = contractOf("stories", stories, provider);
  // Hiding a part that is already hidden is the admin taking it over, in one
  // transaction (AB-062); only the admin unhides an admin hide (AB-061).
  const { result: seg } = await storiesC.functions.get_segment({ story_id: storyId, seq });
  const { result: cfg } = await storiesC.functions.get_config({});
  const what = lib.hidePlan(seg, hidden, actor, (cfg && cfg.admin) || "");
  const signer = await getSigner(provider, actor, "the admin or moderator wallet");
  const op = await storiesC.encodeOperation({
    name: "set_segment_hidden",
    args: { actor, story_id: storyId, seq, hidden, reason, note },
  });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    what + " story " + storyId + " part " + seq + (note ? " (" + note + ")" : ""));
  console.log("Send back: the transaction id (" + txId + ").");
}

/** clear-summary: the admin or moderator empties a story's "story so far" (AB-034). Works while paused. */
async function cmdClearSummary(args) {
  const f = args.flags;
  const actor = lib.requireAddress(f.actor, "actor (the admin or moderator address)");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const { net, provider } = await connect(f);
  const storiesC = contractOf("stories", stories, provider);
  const { result: st } = await storiesC.functions.get_story({ story_id: storyId });
  if (!st || !st.opener) lib.fail("There is no story " + storyId + ".");
  console.log("Summary now (by " + (st.summary_by || "nobody") + "): " + JSON.stringify(String(st.summary || "")));
  const signer = await getSigner(provider, actor, "the admin or moderator wallet");
  const op = await storiesC.encodeOperation({ name: "set_story_summary", args: { account: actor, story_id: storyId, summary: "" } });
  const txId = await dryRunThenSend(signer, provider, net, [op], "CLEAR the summary of story " + storyId);
  console.log("Send back: the transaction id (" + txId + ").");
}

async function cmdTakedown(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const seq = lib.requireStoryId(f.seq);
  const reason = lib.requireReason(f.reason);
  const note = f.note === undefined ? "" : f.note;
  if (note.length > 200) lib.fail("--note must be at most 200 characters.");
  const strike = f.strike === undefined ? "" : lib.requireAddress(f.strike, "strike");
  const noStrike = f["no-strike"] === true;
  const { net, provider } = await connect(f);
  const storiesC = contractOf("stories", stories, provider);

  // Show who could get the strike before any key is asked for (AB-029). The
  // takedown wipes the kept versions, so this is the last easy look at them.
  const { result: seg } = await storiesC.functions.get_segment({ story_id: storyId, seq });
  if (!seg || !seg.author) lib.fail("Story " + storyId + " has no part " + seq + ".");
  // What is reviewed here is what the contract checks: the takedown is refused
  // if the text or its versions change before it lands.
  const review = lib.takedownReview(seg);
  // A few versions per read (AB-060). If the history can't be read, say so and
  // carry on: the takedown itself never needs it, and the dry run below still
  // checks the strike.
  let versions = [];
  let historyError = "";
  try {
    versions = await lib.readVersions(lib.versionPage(storiesC, storyId, seq), seg.version_count);
  } catch (e) {
    historyError = e && e.message ? e.message : String(e);
  }
  // Every wallet the contract recorded as a changer, citation-only ones too (AB-048).
  let recorded;
  try {
    const { result: list } = await storiesC.functions.get_changers({ story_id: storyId, seq });
    recorded = (list && list.values) || [];
  } catch (e) {
    lib.fail("Could not read who changed this part (get_changers: " + (e && e.message ? e.message : String(e)) + "). Nothing was sent. Try again.");
  }
  const who = lib.takedownStrike(seg, versions, strike, noStrike, recorded);
  console.log("Writer:            " + who.writer);
  console.log("Last edited by:    " + (seg.last_edited_by || who.writer) + (seg.last_edited_by && seg.last_edited_by !== who.writer ? "" : " (the writer)"));
  console.log("Changed by others: " + (who.changed ? (who.changers.join(", ") || "yes") : "no"));
  if (who.unseen) console.log("                   " + lib.UNSEEN_CHANGER);
  console.log("Live text:         " + JSON.stringify(String(seg.text || "")));
  console.log("Text fingerprint:  " + Buffer.from(review.reviewed_hash, "base64url").toString("hex") + ", " + review.reviewed_versions +
    " kept version(s). The takedown is refused if either changes before it lands.");
  if (historyError) {
    console.log("Versions:          could not be read (" + historyError + "). Carrying on without them; the same history is");
    console.log("                   public on a block explorer (stories.revise_event and stories.segment_changed_event).");
  }
  if (versions.length) {
    // Every change to the text is a version naming who made it (AB-033), printed in full.
    console.log("Versions, oldest first:");
    for (const line of lib.versionHistory(versions, seg)) console.log(line);
  }
  if (who.needsChoice) {
    lib.fail(
      "Someone other than the writer changed this part, so the contract will not pick who gets the strike.\n" +
      "Nothing was sent. Compare the versions above: strike the wallet whose change made the text infringing.\n" +
      "A cut can change the meaning as much as new words, and a typo fix alone is no reason for a strike.\n" +
      "The same history is public on a block explorer: each stories.revise_event and stories.segment_changed_event\n" +
      "for this part (\"by\" is who changed it).\n" +
      "Then run this command again with one of (whoever last edited the text comes first, even the writer):\n" +
      who.candidates.filter((a) => lib.isAddress(a)).map((a) => "  --strike " + a + (a === who.writer ? "   (the writer)" : "")).join("\n") + "\n" +
      (who.unseen ? "  --strike <the wallet you found>   (" + lib.UNSEEN_CHANGER + ")\n" : "") +
      "  --no-strike   (take the part down without striking anyone)");
  }
  // Without the versions, the "no" above rests on edited_by_others and
  // get_changers alone: ask for an explicit choice instead (AB-069).
  if (historyError && !strike && !noStrike && Number(seg.version_count || 0) > 0) {
    lib.fail(
      "The part's history could not be read, so this tool can't show you whether someone other than the writer changed it.\n" +
      "Nothing was sent. Check its history on a block explorer (stories.revise_event and stories.segment_changed_event\n" +
      "for this part), then run this command again with --strike <wallet> or --no-strike.");
  }
  if (strike && !who.candidates.includes(strike)) {
    console.log("--strike " + strike + " is not the writer or a wallet seen above. The contract accepts it only if that wallet changed this part; the dry run checks this before anything is sent.");
  }

  const signer = await getSigner(provider, admin, "the admin wallet");
  const op = await storiesC.encodeOperation({
    name: "takedown_segment",
    args: { story_id: storyId, seq, reason, note, strike, no_strike: noStrike, ...review },
  });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    "PERMANENT TAKEDOWN of story " + storyId + " part " + seq + ": its text is cleared, its versions are wiped and no Ink is refunded" +
    (note ? " (" + note + ")" : "") + "; " + (noStrike ? "no strike" : "strike for " + (strike || who.writer)));
  console.log("Send back: the transaction id (" + txId + ").");
}

/**
 * replace-pdf: after a takedown in a finished book, publish the book's new
 * text hash (F-07). The hash is computed here from the chain, exactly as the
 * website computes it at finalize, never typed in.
 */
async function cmdReplacePdf(args) {
  const f = args.flags;
  const admin = lib.requireAddress(f.admin, "admin");
  const stories = lib.requireAddress(f.stories, "stories");
  const storyId = lib.requireStoryId(f.story);
  const { net, provider } = await connect(f);
  const storiesC = contractOf("stories", stories, provider);
  const { result: st } = await storiesC.functions.get_story({ story_id: storyId });
  lib.requireNeedsNewPdf(st, storyId);
  const uri = lib.requirePdfUri(f.uri === undefined ? st.pdf_uri : f.uri);
  const segments = await lib.readSegments(async (start, limit) =>
    (await storiesC.functions.get_segments({ story_id: storyId, start: String(start), limit })).result || {}, st.segment_count);
  // The website's own reading-order rule, so the text is the one it hashes.
  const { readingOrder } = await import(pathToFileURL(path.join(root, "web", "src", "lib", "order.js")).href);
  const book = lib.bookText(st, segments, readingOrder);
  const hash = lib.sha256(Buffer.from(book.text, "utf8"));
  const hex = Buffer.from(hash).toString("hex");
  console.log("");
  console.log("Book:      " + JSON.stringify(String(st.title || "Untitled")) + ", " + book.parts + " live part(s) of " + segments.length +
    ", about " + book.text.split(/\s+/).filter(Boolean).length + " words");
  if (book.hidden) console.log("           " + book.hidden + " hidden part(s) are left out, as the website leaves them out.");
  console.log("Hash now:  " + (st.pdf_hash ? Buffer.from(st.pdf_hash, "base64url").toString("hex") : "(none)"));
  console.log("New hash:  " + hex + "  (sha256 of the book text read from the chain just now)");
  console.log("Link:      " + uri);
  const signer = await getSigner(provider, admin, "the admin wallet");
  const { utils } = koilib();
  const op = await storiesC.encodeOperation({ name: "replace_pdf", args: { story_id: storyId, pdf_uri: uri, pdf_hash: utils.encodeBase64url(hash) } });
  const txId = await dryRunThenSend(signer, provider, net, [op],
    "stories.replace_pdf: story " + storyId + "'s book hash becomes " + hex + " (computed from its " + book.parts + " live parts), link " + uri);
  console.log("Send back: the transaction id (" + txId + "). The book page should now say the copy matches.");
}

async function cmdStatus(args) {
  const f = Object.assign({}, args.flags);
  if (f.user && !f.buyer) f.buyer = f.user;
  const { net, provider } = await connect(f);
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
  await show("stories", f.stories);
  await show("user", f.buyer);
  await show("sponsor", f.sponsor);
  await show("msig", f.multisig);
  const read = async (target, addr, name, a) => {
    try {
      return await readOnly(provider, target, addr, name, a);
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
    const token = f.token || net.koin;
    console.log("");
    console.log("shop.get_config: " + JSON.stringify(await read("shop", f.shop, "get_config")));
    const asset = await read("shop", f.shop, "get_asset", { token });
    console.log("shop asset " + token + ": " + JSON.stringify(asset) +
      (asset && asset.enabled ? "  (usable from " + lib.utcTime(asset.usable_from || 0) + ")" : ""));
    if (f.buyer) {
      console.log("shop membership of user: " + JSON.stringify(await read("shop", f.shop, "get_membership", { account: f.buyer })));
      console.log("shop promo claimed by user: " + JSON.stringify(await read("shop", f.shop, "get_promo_claimed", { account: f.buyer })));
    }
    console.log("shop campaign 1: " + JSON.stringify(await read("shop", f.shop, "get_campaign", { campaign_id: "1" })));
  }
  if (f.stories) {
    console.log("");
    console.log("stories.get_config: " + JSON.stringify(await read("stories", f.stories, "get_config")));
    if (f.ink) {
      console.log("ink burner flag for Stories (want true): " + JSON.stringify(await read("ink", f.ink, "is_burner", { account: f.stories })));
      console.log("ink minter mask for Stories (want 32): " + JSON.stringify(await read("ink", f.ink, "get_minter_reasons", { account: f.stories })));
    }
    if (f.shop) {
      const cfg = await read("shop", f.shop, "get_config");
      console.log("shop points at Stories (want " + f.stories + "): " + JSON.stringify(cfg && cfg.stories));
    }
    console.log("stories category 1: " + JSON.stringify(await read("stories", f.stories, "get_category", { category_id: 1 })));
    if (f.story) console.log("story " + f.story + ": " + JSON.stringify(await read("stories", f.stories, "get_story", { story_id: f.story })));
    if (f.buyer) console.log("open projects of user: " + JSON.stringify(await read("stories", f.stories, "get_open_count", { account: f.buyer })));
  }
  if (f.multisig) {
    console.log("");
    const meta = await provider.invokeGetContractMetadata(f.multisig).catch(() => null);
    const m = meta && meta.value;
    console.log("multisig authority flags (want call true, pay true, upload true): " +
      (m && m.hash ? "call " + !!m.authorizes_call_contract + ", pay " + !!m.authorizes_transaction_application + ", upload " + !!m.authorizes_upload_contract : "(no contract)"));
    console.log("multisig.get_config: " + JSON.stringify(await read("multisig", f.multisig, "get_config")));
  }
  if (f.sponsor) {
    console.log("");
    const meta = await provider.invokeGetContractMetadata(f.sponsor).catch(() => null);
    const m = meta && meta.value;
    console.log("sponsor authority flags (want call false, pay true, upload false): " +
      (m && m.hash ? "call " + !!m.authorizes_call_contract + ", pay " + !!m.authorizes_transaction_application + ", upload " + !!m.authorizes_upload_contract : "(no contract)"));
    console.log("sponsor.get_config: " + JSON.stringify(await read("sponsor", f.sponsor, "get_config")));
    console.log("sponsor.get_total_usage: " + JSON.stringify(await read("sponsor", f.sponsor, "get_total_usage")));
    if (f.buyer) console.log("sponsor usage of user: " + JSON.stringify(await read("sponsor", f.sponsor, "get_usage", { account: f.buyer })));
  }
}

// Each command: what it runs, the flags it takes, how many positional values
// (ink|shop|stories, a campaign id, transaction files), whether --prepare may
// build it for multisig signing (admin commands), and whether it is testnet only.
const COMMON_FLAGS = ["network", "rpc", "i-understand-this-is-mainnet", lib.PIN_OVERRIDE_FLAG.slice(2)];
const PREPARE_FLAGS = ["prepare", "payer", "payee", "rc-limit"];
const COMMANDS = {
  "status": { run: cmdStatus, flags: "ink shop admin user buyer stories story token sponsor multisig" },
  "multisig-create": { run: cmdMultisigCreate, flags: "expect signers threshold" },
  "multisig-signers": { run: cmdMultisigSigners, prepare: true, flags: "multisig signers threshold" },
  "sponsor-config": { run: cmdSponsorConfig, flags: "sponsor ink shop stories tokens per-tx per-account per-day disable" },
  "upload": { run: cmdUpload, positionals: 1, flags: "expect upgrade i-understand-this-replaces-mainnet-code" },
  "set-admin": { run: cmdSetAdmin, positionals: 1, prepare: true, flags: "contract admin from" },
  "accept-admin": { run: cmdAcceptAdmin, positionals: 1, prepare: true, flags: "contract admin" },
  "pause": { run: (a) => cmdPause(a, true), positionals: 1, prepare: true, flags: "contract admin" },
  "unpause": { run: (a) => cmdPause(a, false), positionals: 1, prepare: true, flags: "contract admin" },
  "wire": { run: cmdWire, prepare: true, flags: "admin ink shop treasury founder " + lib.HASH_OVERRIDE_FLAG.slice(2) },
  "set-asset": { run: cmdSetAsset, prepare: true, flags: "admin shop token symbol decimals disable" },
  "set-price": { run: cmdSetPrice, prepare: true, flags: "admin shop token reader writer pack-s pack-m pack-l book short poem rate" },
  "set-ink-amounts": { run: cmdSetInkAmounts, prepare: true, flags: "admin shop writer pack-s pack-m pack-l starter-book starter-short starter-poem" },
  "test-asset": { run: cmdTestAsset, testnet: true, prepare: true, flags: "admin shop token symbol decimals" },
  "test-buy": { run: cmdTestBuy, testnet: true, flags: "user buyer shop tier token" },
  "test-promo": { run: cmdTestPromo, testnet: true, flags: "admin shop" },
  "claim-promo": { run: cmdClaimPromo, testnet: true, flags: "account shop campaign sign-for" },
  "promo-new": { run: cmdPromoNew, prepare: true, flags: "admin shop budget end start amount daily-cap site" },
  "promo-on": { run: (a) => cmdPromoSwitch(a, true), prepare: true, flags: "admin shop" },
  "promo-off": { run: (a) => cmdPromoSwitch(a, false), prepare: true, flags: "admin shop" },
  "promo-end": { run: cmdPromoEnd, positionals: 1, prepare: true, flags: "admin shop campaign" },
  "user-checks": { run: cmdUserChecks, flags: "user ink shop admin token campaign" },
  "wire-stories": { run: cmdWireStories, prepare: true, flags: "admin ink shop stories treasury founder " + lib.HASH_OVERRIDE_FLAG.slice(2) },
  "test-open": { run: cmdTestOpen, testnet: true, flags: "user shop stories token private fund" },
  "test-invite": { run: cmdTestInvite, testnet: true, flags: "opener stories story uses days" },
  "join-invite": { run: cmdJoinInvite, testnet: true, flags: "account stories story invite sign-for" },
  "measure": { run: cmdMeasure, flags: "user ink stories story emoji sizes" },
  "test-write": { run: cmdTestWrite, testnet: true, flags: "user ink stories story size emoji text not-opener" },
  "stories-limits": { run: cmdStoriesLimits, prepare: true, flags: "admin stories cap open-limit full-price price-ceiling" },
  "set-terms": { run: cmdSetTerms, prepare: true, flags: "admin stories version file uri" },
  "new-moderator-key": { run: cmdNewModeratorKey, flags: "" },
  "set-moderation": { run: cmdSetModeration, prepare: true, flags: "admin stories moderator threshold strikes" },
  "hide": { run: cmdHide, prepare: true, flags: "actor stories story seq reason note unhide" },
  "takedown": { run: cmdTakedown, prepare: true, flags: "admin stories story seq reason note strike no-strike" },
  "replace-pdf": { run: cmdReplacePdf, prepare: true, flags: "admin stories story uri" },
  "block": { run: cmdBlock, prepare: true, flags: "admin stories account note unblock" },
  "clear-summary": { run: cmdClearSummary, prepare: true, flags: "actor stories story" },
  "cosign": { run: cmdCosign, positionals: 1, flags: "" },
  "submit": { run: cmdSubmit, positionals: Infinity, flags: "" },
};

const KNOWN_FLAGS = [...new Set(COMMON_FLAGS.concat(PREPARE_FLAGS, ...Object.values(COMMANDS).map((c) => c.flags.split(" "))))];

async function main(argv) {
  const args = lib.parseArgs(argv, KNOWN_FLAGS);
  const spec = Object.prototype.hasOwnProperty.call(COMMANDS, args.command || "") ? COMMANDS[args.command] : null;
  if (!spec) {
    const head = fs.readFileSync(__filename, "utf8").split("*/")[0];
    console.log(head.replace(/^#!.*\n/, "").replace(/^\/\*\*?|^ \* ?/gm, ""));
    if (args.command && args.command !== "help") process.exitCode = 1;
    return;
  }
  lib.checkCommandArgs(args, COMMON_FLAGS.concat(spec.flags.split(" ").filter(Boolean), spec.prepare ? PREPARE_FLAGS : []), spec.positionals);
  if (spec.testnet) lib.requireTestnet(lib.resolveNetwork(args.flags), args.command);
  const prepare = args.flags.prepare === undefined ? null : txFilePath(args.flags.prepare);
  if (!prepare && PREPARE_FLAGS.some((name) => args.flags[name] !== undefined)) {
    lib.fail("--payer, --payee and --rc-limit only go with --prepare <file.json>.");
  }
  Object.assign(session, { args, net: null, prepare });
  return spec.run(args);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    () => process.exit(process.exitCode || 0),
    (err) => {
      if (err instanceof Prepared) process.exit(0);
      if (err instanceof lib.UserError) console.error("\nSTOPPED: " + err.message);
      else console.error("\nUnexpected error: " + (err && err.message ? err.message : String(err)));
      process.exit(1);
    }
  );
}

module.exports = { readHidden, COMMANDS, main, Prepared, seams, contractOf };
