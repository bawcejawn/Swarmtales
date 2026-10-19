#!/usr/bin/env node
/**
 * Build Ink and Shop and print the testnet steps.
 * This does not upload, does not connect to a wallet, and does not ask for a key.
 *
 *   node deploy/prepare-testnet.js
 *   node deploy/prepare-testnet.js --no-build
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, "deploy", "testnet.env");
const examplePath = path.join(root, "deploy", "testnet.env.example");
const secretNames = ["PRIVATE_KEY", "WIF", "SEED", "MNEMONIC", "SECRET", "PASSWORD"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) fail("Could not read this line in the env file:\n" + rawLine);
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function requireAddress(values, key) {
  const value = values[key] || "";
  if (!value) return "";
  if (!/^1[1-9A-HJ-NP-Za-km-z]{20,40}$/.test(value)) {
    fail(key + " does not look like a Koinos address: " + value);
  }
  return value;
}

const sourcePath = fs.existsSync(envPath) ? envPath : examplePath;
const sourceName = path.relative(root, sourcePath);
const values = parseEnv(fs.readFileSync(sourcePath, "utf8"));

for (const name of Object.keys(values)) {
  if (secretNames.indexOf(name) !== -1) {
    fail(
      "Remove " +
        name +
        " from " +
        sourceName +
        ". This script never accepts a private key, seed, or password."
    );
  }
}

const admin = requireAddress(values, "ADMIN_ADDRESS");
const inkAddress = requireAddress(values, "INK_CONTRACT_ADDRESS");
const shopAddress = requireAddress(values, "SHOP_CONTRACT_ADDRESS");
const treasury = requireAddress(values, "TREASURY_ADDRESS");
const founder = requireAddress(values, "FOUNDER_ADDRESS");
const rpc = values.TESTNET_RPC || "https://testnet.koinosfoundation.org";
const chainId = values.TESTNET_CHAIN_ID || "(read this from the node)";

if (!admin) fail("ADMIN_ADDRESS is empty.");

if (!process.argv.includes("--no-build")) {
  for (const dir of [root, path.join(root, "shop")]) {
    const result = spawnSync(
      "yarn",
      ["build:release"],
      { cwd: dir, stdio: "inherit", shell: process.platform === "win32" }
    );
    if (result.status !== 0) fail("Release build failed in " + dir);
  }
}

const blank = "(create a new wallet, then paste its public address into deploy/testnet.env)";
const ink = inkAddress || blank;
const shop = shopAddress || blank;

console.log("");
console.log("SwarmTales testnet sheet");
console.log("Settings file: " + sourceName);
console.log("Nothing was uploaded. No wallet was opened.");
console.log("");
console.log("Network: " + rpc);
console.log("Chain id in the settings file: " + chainId);
console.log("Admin wallet: " + admin);
console.log("Ink contract address: " + ink);
console.log("Shop contract address: " + shop);
console.log("Treasury: " + (treasury || blank));
console.log("Founder: " + (founder || blank));
console.log("");
console.log("Files to upload, after a release build:");
console.log("  Ink wasm:  build/release/contract.wasm");
console.log("  Ink abi:   abi/ink.abi");
console.log("  Shop wasm: shop/build/release/contract.wasm");
console.log("  Shop abi:  shop/abi/shop.abi");
console.log("");
console.log("Do these yourself. Never paste a seed or private key into the repo or into chat.");
console.log("1. Fund the Ink wallet from the faucet. Upload spends mana from that wallet, not from the admin wallet.");
console.log("2. In Koinos CLI, open the Ink wallet and connect to " + rpc);
console.log("   Confirm the chain id matches the node. Then:");
console.log("   upload build/release/contract.wasm abi/ink.abi false false false");
console.log("   The three false values leave contract-call, transaction, and upload authority with the key.");
console.log("3. register ink <ink-address> abi/ink.abi");
console.log("   ink.set_admin " + admin);
console.log("4. The next day, fund the Shop wallet, open that wallet, and:");
console.log("   upload shop/build/release/contract.wasm shop/abi/shop.abi false false false");
console.log("   register shop <shop-address> shop/abi/shop.abi");
console.log("   shop.set_admin " + admin);
console.log("5. Fund " + admin + " and open that wallet. Then, with both ABIs registered:");
console.log("   ink.set_minter <shop-address> 30");
console.log("   shop.set_addresses " + (treasury || "<treasury>") + " " + (founder || "<founder>") + " <ink-address> ");
console.log("   The last argument is the Stories address. Leave it empty until Stories exists.");
console.log("   shop.set_ink_amounts 15000 5000 15000 45000 20000 10000");
console.log("Mask 30 is PURCHASE + MEMBERSHIP + STARTER + PROMO. It does not include REFUND.");
