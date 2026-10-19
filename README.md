# Storyloom Ink

Ink is Storyloom's non-transferable writing allowance. **1 INK = 1 character.** It is not money: it cannot be transferred, sold, redeemed, or traded, and it is not an investment.

This folder is the contract. It was created with the official Koinos tool:

```bash
koinos-sdk-as-cli create ink
```

The tool only accepts a name made of lowercase letters, numbers, and underscores, so the project name is `ink` (not `ink-token`). The sample calculator was removed and replaced with this contract.

## Rules the contract enforces

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

## Build and test

Open a terminal in this folder. These commands are the same on Windows PowerShell, Linux, and macOS. They were run here on Linux with Node.js 22.14.0, Yarn 1.22.22, and `@koinos/sdk-as-cli` 1.0.2. `yarn build:debug` and `yarn test` use the copy of the tool that `yarn install` puts in the project (1.0.0, which is what `create` asks for). Both copies accept the same build command.

```bash
yarn install
yarn build:debug
yarn test
```

PowerShell, from this folder:

```powershell
yarn install
yarn build:debug
yarn test
```

What those do:

1. `yarn install` downloads the Koinos SDK and applies a small fix so the code generators work on current Node.js. Node 20 and later read the generator's input before it has arrived, and the stock tools crash with `EAGAIN`. The fix lives in `scripts/patch-protoc-stdin.js` and runs automatically. You do not edit it.
2. `yarn build:debug` compiles the contract. It is the same as:

   ```bash
   koinos-sdk-as-cli build-all debug 0 ink.proto
   ```

   The `0` is not a version. It means "this is a normal build, not a special testing build." Leaving it out makes the tool print its help text and stop.
3. `yarn test` runs the automatic checks in the mock chain on your computer. Nothing is sent to a blockchain. It is the same as `koinos-sdk-as-cli run-tests`. Build first: the tests need files that the build creates.

### Success looks like

- `build/debug/contract.wasm` exists
- The test report ends with `41 pass` and `0 fail`

A release build (smaller wasm, for later) is `yarn build:release`. You do not need it to run the tests.

## Files you edit, and files the tool rewrites

| File | What it is |
|---|---|
| `assembly/proto/ink.proto` | The contract's menu: every function, its inputs, and its public events |
| `assembly/Ink.ts` | The contract, with plain-language comments |
| `assembly/__tests__/Ink.spec.ts` | The automatic tests |

These are recreated every build. Do not edit them. They are not stored in git.

- `assembly/proto/ink.ts`
- `assembly/Ink.boilerplate.ts`
- `assembly/index.ts`
- `abi/ink.abi` and `abi/ink-abi.json`
- `build/debug/contract.wasm`

## Before this is ever uploaded

Do not upload this contract yet. When that day comes, two details matter:

- Upload it to an address whose private key you still have, and leave the "authorize contract calls" option **off**. Until you call `set_admin`, that address is the admin. A stranger cannot take it, because Koinos asks for a signature from that address. If you upload to an address you cannot sign for, or you turn the authorize option on, nobody can ever set the admin and the contract is stuck.
- The first thing the admin should do is `set_admin` to a hardware wallet, then approve the Shop and Stories contracts. The admin key can appoint minters, so treat it like a master key.

## Creative-use notice

Ink is a usage allowance for writing on Storyloom. It has no cash value, cannot be transferred, sold, redeemed, or traded, and is not an investment.
