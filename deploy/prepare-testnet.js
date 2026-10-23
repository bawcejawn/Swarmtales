#!/usr/bin/env node
/**
 * Build Ink, Shop and Stories and print the testnet steps, as deploy.js commands.
 * This does not upload, does not connect to a wallet, and does not ask for a key.
 *
 *   node deploy/prepare-testnet.js
 *   node deploy/prepare-testnet.js --no-build
 *
 * Every step goes through deploy/deploy.js: the key is pasted at its hidden
 * prompt, the node's chain id is checked, and each write is dry run before
 * you type SEND. Never paste a key into the Koinos CLI or any other tool for
 * these steps.
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
  if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) {
    fail(key + " does not look like a Koinos address: " + value);
  }
  return value;
}

const sourcePath = fs.existsSync(envPath) ? envPath : examplePath;
const sourceName = path.relative(root, sourcePath);
const values = parseEnv(fs.readFileSync(sourcePath, "utf8"));

for (const name of Object.keys(values)) {
  if (secretNames.some((secret) => name.toUpperCase().includes(secret))) {
    fail("Remove " + name + " from " + sourceName + ". This script never accepts a private key, seed, or password.");
  }
}

const admin = requireAddress(values, "ADMIN_ADDRESS");
const ink = requireAddress(values, "INK_CONTRACT_ADDRESS") || "<ink-address>";
const shop = requireAddress(values, "SHOP_CONTRACT_ADDRESS") || "<shop-address>";
const stories = requireAddress(values, "STORIES_CONTRACT_ADDRESS") || "<stories-address>";
const treasury = requireAddress(values, "TREASURY_ADDRESS") || admin;
const founder = requireAddress(values, "FOUNDER_ADDRESS") || admin;

if (!admin) fail("ADMIN_ADDRESS is empty.");
for (const [name, value] of [["INK", ink], ["SHOP", shop], ["STORIES", stories]]) {
  if (value === admin) fail(name + "_CONTRACT_ADDRESS must be its own new wallet, not the admin wallet.");
}

if (!process.argv.includes("--no-build")) {
  for (const dir of [root, path.join(root, "shop"), path.join(root, "stories")]) {
    const result = spawnSync("yarn", ["build:release"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    if (result.status !== 0) fail("Release build failed in " + dir);
  }
}

const run = (line) => console.log("   node deploy/deploy.js " + line);

console.log("");
console.log("SwarmTales testnet sheet");
console.log("Settings file: " + sourceName);
console.log("Nothing was uploaded. No wallet was opened.");
console.log("");
console.log("Admin wallet:   " + admin);
console.log("Ink contract:   " + ink);
console.log("Shop contract:  " + shop);
console.log("Stories:        " + stories);
console.log("Treasury:       " + treasury);
console.log("Founder:        " + founder);
console.log("");
console.log("Run these from the repository folder. Each one checks the node's chain id, asks for the key at a");
console.log("hidden prompt (nothing shows while you paste), dry runs, and sends only after you type SEND.");
console.log("Use a NEW wallet for each contract, made for testnet only. Never reuse a testnet contract key on");
console.log("mainnet, or a mainnet key on testnet. Never paste a seed or key into the repo, a chat, or another tool.");
console.log("");
console.log("1. Fund each contract wallet from the faucet (an upload spends that wallet's mana), then upload:");
run("upload ink --expect " + ink);
run("upload shop --expect " + shop);
run("upload stories --expect " + stories);
console.log("2. Hand each contract to the admin (the contract wallet's key proposes, then the admin's key accepts):");
for (const [name, addr] of [["ink", ink], ["shop", shop], ["stories", stories]]) {
  run("set-admin " + name + " --contract " + addr + " --admin " + admin);
  run("accept-admin " + name + " --contract " + addr + " --admin " + admin);
}
console.log("3. Fund the admin wallet, then wire everything (admin key):");
run("wire --admin " + admin + " --ink " + ink + " --shop " + shop + " --treasury " + treasury + " --founder " + founder);
run("wire-stories --admin " + admin + " --ink " + ink + " --shop " + shop + " --stories " + stories);
console.log("4. Turn on the test payment token. The Shop makes everyone wait 7 days before a new token can be used:");
run("test-asset --admin " + admin + " --shop " + shop);
console.log("5. Check:");
run("status --admin " + admin + " --ink " + ink + " --shop " + shop + " --stories " + stories);
console.log("The rest of the rehearsal is in docs/TESTNET_DEPLOY.md.");
