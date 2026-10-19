# Storyloom contracts

This repository holds two Koinos smart contracts. They were written and tested on a computer. Nothing here is deployed, and the tests do not spend tokens.

| Contract | Folder | What it is |
|---|---|---|
| **Ink** | this folder | A writing allowance. **1 INK = 1 character.** It cannot be transferred or sold. |
| **Shop** | `shop/` | Memberships, Ink packs, story open and close fees, and promo codes. |

The Koinos tool builds one contract per folder, so each folder has its own `yarn install`. The install steps below are shared.

## Shop

The Shop is the cash register. It does not hold customer money, and it has no function that withdraws funds. When someone pays, the Shop asks the stablecoin to send the money in that same transaction:

- the founder share is `floor(price × fee / 10,000)`
- the treasury gets whatever is left, so the two parts always add up to the price

The fee starts at **100** (1%). The admin can change it, but the contract refuses any fee above **500** (5%). Both addresses are set by the admin, and every payment publishes them in a public event.

Ink is created by calling the Ink contract. The Shop may only ask for these reasons, and only after Ink's admin has allowed it: **PURCHASE** (packs), **MEMBERSHIP** (Writer months), **STARTER** (opening a story), **PROMO** (a campaign code).

### What a buyer has to do

Koinos stablecoins do not let another contract pull a normal wallet's tokens from a signature alone. The buyer does two things, usually in one transaction:

1. Approve the Shop, on the stablecoin, for the full price.
2. Sign the Shop call.

The Shop checks the signature itself. Someone else cannot spend a leftover approval by naming the buyer as the payer.

### Prices are per token, in that token's own units

The contract does not contain a token address. The admin turns a token on with `set_asset` (enabled, decimals, symbol) and sets each price with `set_price`. The number charged is the raw price, not "dollars times a hardcoded decimal." Decimals are stored so a wallet can display the price. A 6-decimal practice token and an 8-decimal token can be enabled at the same time, with different prices.

These are the mainnet tokens, read from `https://api.koinos.io` on 19 October 2026. They are **not** written into the contract. Set them with `set_asset` when you are ready, and read `decimals` again first in case the token has changed.

| Token | Address | Name on chain | Decimals |
|---|---|---|---|
| vUSDT | `12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh` | Vortex Tether USD | 8 |
| vUSDC | `1N8iYrYEJdCVK1rhbqv3qZUzHcpoeKmFnj` | Vortex USD Coin | 8 |

Both use 8 decimal places, so **$1.00 = 100,000,000** base units. These are the starting prices to enter. The admin can change them later.

| Item | Price | Base units | Ink |
|---|---|---|---|
| Reader, one month | $1 | 100,000,000 | none |
| Writer, one month | $5 | 500,000,000 | 15,000 per month |
| Pack S (Writers only) | $2 | 200,000,000 | 5,000 |
| Pack M | $5 | 500,000,000 | 15,000 |
| Pack L | $12 | 1,200,000,000 | 45,000 |
| Open a Book | $20 | 2,000,000,000 | 20,000 starter Ink |
| Close a Book | $5 | 500,000,000 | none |
| Open a Short Story | $10 | 1,000,000,000 | 10,000 starter Ink |
| Close a Short Story | $2 | 200,000,000 | none |

A Writer purchase of several months mints the first month immediately and saves the rest. A claim is allowed every **30 days** (2,592,000 seconds). That wait is part of the contract, not an admin setting, so the admin cannot speed claims up. One purchase can be at most **24 months**. The Ink amount is locked when the Writer term starts. Changing the catalog later does not shrink months that were already paid for. When `paid_until` has passed, unclaimed months from that term are gone.

Opening and closing are not buttons on the Shop. The future Stories contract calls `pay_open_fee` or `pay_close_fee`. The opener still has to sign. Starter Ink is normal Ink, minted to the opener.

### Promo codes

There is no open "claim free Ink" button. The admin creates a campaign with a code, an Ink amount (for example 1,000), a total budget, an optional daily cap, and a start and end. `daily_cap` of 0 means "no daily cap."

- A global switch turns every campaign off at once.
- Each campaign can also be turned off by itself.
- The code is stored as a sha256 hash. The claim mints Ink with reason **PROMO** and the public note `campaign:<id>`.
- **One wallet can claim once, ever, across every campaign.**
- Single-use codes are optional. Each of those works once, and the wallet still cannot claim a second campaign.
- `get_promo_claimed` returns the campaign id, or 0 if that wallet has never claimed. The future Stories contract will read this for the 1,000-character trial. That trial limit is not enforced here. Promo Ink cannot open a story, because opening is a separate paid call.

A code sent in an admin transaction is public, because the chain is public. The protections are one claim per wallet, the budget, the daily cap, the dates, and the off switches.

### Not in this contract

Left for later, on purpose: keepsakes and tips, a First Edition sale, a platform token, and anything that belongs to Stories (the 3-open-project limit, 60-day archive, categories, reports, ranking, private books, refunds, and the trial character limit). The Shop also does not pay Mana for users. A buyer still needs Mana from their own wallet to submit the transaction.

### Build and test the Shop

From the `shop` folder. Same commands in PowerShell, Linux, and macOS. They were run here on Linux.

```bash
cd shop
yarn install
yarn build:debug
yarn test
```

Success means `shop/build/debug/contract.wasm` exists and the test report ends with **39 pass** and **0 fail**.

`yarn build:debug` is `koinos-sdk-as-cli build-all debug 0 shop.proto`. The `0` is not a version. Leaving it out makes the tool print help and stop.

## Testnet KOIN, Mana, and a practice stablecoin

You do not need testnet tokens to build or to run the tests above. Those run in a mock chain on your computer.

When you do want testnet coins, do **not** add a testnet node next to your production nodes. A second node on the same machine competes for disk and memory, and a bad config can disturb the nodes you already run. Use a public testnet instead.

**Harbinger** is the Koinos Group testnet described at [docs.koinos.io/developers/testnet](https://docs.koinos.io/developers/testnet/). Their docs say to request **tKOIN** in the Discord `#faucet` channel (under Developers) with:

```text
!faucet YOUR_KOINOS_ADDRESS
```

The documented reply is a transfer of 100 tKOIN. Check with `!balance YOUR_KOINOS_ADDRESS`. Their example API is `https://api.harbinger.koinos.pro/jsonrpc` and it asks for an API key. Older guides also mention `https://harbinger-api.koinos.io`. Harbinger is sometimes reset, so read the chain id from the node you are actually using (`chain.get_chain_id`) instead of copying one from a blog. If the faucet bot does not answer, ask in the Koinos Discord or Telegram. This project did not request any tokens.

There is a **second, different** public testnet run by the Koinos Foundation. Its API is `https://testnet.koinosfoundation.org/jsonrpc` and its faucet is the Telegram bot [t.me/KoinosTestnetFaucetBot](https://t.me/KoinosTestnetFaucetBot). The command is `/faucet YOUR_KOINOS_ADDRESS`. Their README says that sends 100 vKOIN, with a 24-hour cooldown. Its chain id is not the Harbinger example, so confirm which network your wallet is pointed at before you request coins.

**Mana is not a separate coin.** It refills from the KOIN (or tKOIN / vKOIN) balance. The faucet amount arrives with Mana. This Shop does not sponsor Mana for buyers.

**Do not point the Shop at mainnet vUSDT on a testnet.** Those contracts are not on the test network, and you cannot mint them. Also do not deploy a homemade token from this repository. A correct Koinos token (the KCS-4 standard) checks allowances with a system call that this SDK version (1.0.0) does not include. A simplified token would be unsafe if a contract pulled from it.

For a practice stablecoin, deploy the official Koinos token contract, name it something like test USD, mint it to yourself, then `set_asset` that address and set prices using **that** token's decimals. The Shop tests already simulate a token: they check the exact transfer the Shop asked for, and a small ledger in the test refuses a transfer bigger than the buyer's balance or approval.

## Ink

Ink is Storyloom's non-transferable writing allowance. **1 INK = 1 character.** It is not money: it cannot be transferred, sold, redeemed, or traded, and it is not an investment.

The Ink project was created with:

```bash
koinos-sdk-as-cli create ink
```

The tool only accepts a name made of lowercase letters, numbers, and underscores, so the project name is `ink` (not `ink-token`). The sample calculator was removed and replaced with this contract.

### Rules the Ink contract enforces

- **No transfers.** There is no transfer, approve, or allowance function.
- **Only approved Storyloom contracts can create Ink**, and each only for the reasons it was given:
  - Shop: PURCHASE, MEMBERSHIP, STARTER, PROMO
  - Stories: REFUND only
- **Nobody can mint by calling Ink directly**, including the admin. The call has to come from an approved contract.
- **Burning needs two things:** an approved burner contract (Stories) and the owner's signature.
- **Every mint, burn, and admin change publishes a public event** with its reason and a short memo (64 characters max).
- **The admin can:** approve or remove minters and burners, pause minting and burning, and hand admin to a new address (such as a hardware wallet).
- **The admin cannot:** mint, move, or burn anyone's Ink. Pause does not block the admin, so they can still unpause.

## One-time setup

Install [Node.js](https://nodejs.org/) 20 or newer (this project was built and tested with Node.js 22) and Git. Then install Yarn 1 and the Koinos contract tool. Use Yarn 1, the classic version. The Koinos tools call `yarn` and do not work with Yarn 2 or later.

### Windows (PowerShell)

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
npm install -g yarn
npm install -g @koinos/sdk-as-cli
yarn -v
koinos-sdk-as-cli -V
```

`yarn -v` should print `1.x.x`. `koinos-sdk-as-cli -V` should print `1.0.2` (or another 1.0.x).

### Linux and macOS

```bash
npm install -g yarn
npm install -g @koinos/sdk-as-cli
yarn -v
koinos-sdk-as-cli -V
```

If `npm install -g` says "permission denied", install into a folder you own instead of using sudo:

```bash
mkdir -p "$HOME/.local"
npm install -g yarn @koinos/sdk-as-cli --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

Add that `export PATH` line to your shell profile if you want it every time you open a terminal.

## Build and test Ink

Open a terminal in this folder (the one that contains `assembly/Ink.ts`, not `shop/`). These commands are the same on Windows PowerShell, Linux, and macOS. They were run here on Linux with Node.js 22.14.0, Yarn 1.22.22, and `@koinos/sdk-as-cli` 1.0.2. `yarn build:debug` and `yarn test` use the copy of the tool that `yarn install` puts in the project (1.0.0, which is what `create` asks for). Both copies accept the same build command. PowerShell itself was not available on the machine that ran the tests; the commands are the same ones PowerShell runs.

```bash
yarn install
yarn build:debug
yarn test
```

What those do:

1. `yarn install` downloads the Koinos SDK and applies a small fix so the code generators work on current Node.js. Node 20 and later read the generator's input before it has arrived, and the stock tools crash with `EAGAIN`. The fix lives in `scripts/patch-protoc-stdin.js` and runs automatically. The Shop folder has the same fix. You do not edit it.
2. `yarn build:debug` compiles the contract. It is the same as:

   ```bash
   koinos-sdk-as-cli build-all debug 0 ink.proto
   ```

   The `0` is not a version. It means "this is a normal build, not a special testing build." Leaving it out makes the tool print its help text and stop.
3. `yarn test` runs the automatic checks in the mock chain on your computer. Nothing is sent to a blockchain. It is the same as `koinos-sdk-as-cli run-tests`. Build first: the tests need files that the build creates.

### Success looks like

- `build/debug/contract.wasm` exists
- The Ink test report ends with `41 pass` and `0 fail`

A release build (smaller wasm, for later) is `yarn build:release`. You do not need it to run the tests.

## Files you edit, and files the tool rewrites

| File | What it is |
|---|---|
| `assembly/proto/ink.proto` | Ink's menu: every function, its inputs, and its public events |
| `assembly/Ink.ts` | The Ink contract |
| `assembly/__tests__/Ink.spec.ts` | The Ink tests |
| `shop/assembly/proto/shop.proto` | The Shop's menu |
| `shop/assembly/Shop.ts` | The Shop contract |
| `shop/assembly/__tests__/Shop.spec.ts` | The Shop tests |

These are recreated every build, in both folders. Do not edit them. They are not stored in git.

- `assembly/proto/ink.ts` and `shop/assembly/proto/shop.ts`
- `assembly/Ink.boilerplate.ts` and `shop/assembly/Shop.boilerplate.ts`
- `assembly/index.ts` and `shop/assembly/index.ts`
- `abi/*.abi` and `abi/*-abi.json`
- `build/debug/contract.wasm`

## Before this is ever uploaded

Do not upload these contracts yet. When that day comes, two details matter for **both** contracts:

- Upload each one to an address whose private key you still have, and leave the "authorize contract calls" option **off**. Until you call `set_admin`, that address is the admin. A stranger cannot take it, because Koinos asks for a signature from that address. If you upload to an address you cannot sign for, or you turn the authorize option on, nobody can ever set the admin and the contract is stuck.
- The first thing each admin should do is `set_admin` to a hardware wallet. On Ink, then approve the Shop for PURCHASE, MEMBERSHIP, STARTER, and PROMO (and Stories for REFUND only, when that contract exists). The Ink admin key can appoint minters, so treat it like a master key. On the Shop, then set the treasury, the founder, the Ink address, and the stablecoins and prices. The Shop admin cannot pull a payment back after the split, but they can change where the next payment goes.

## Creative-use notice

Ink is a usage allowance for writing on Storyloom. It has no cash value, cannot be transferred, sold, redeemed, or traded, and is not an investment. Stablecoin payments are the only money in this design, and the 1% founder fee is meant to be shown to buyers before they pay.
