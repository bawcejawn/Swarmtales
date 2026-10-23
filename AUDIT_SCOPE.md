# Audit scope

For the independent auditor. This is the version we intend to deploy: branch `audit-fixes-2`
(PR #24). Please audit the commit this file was added in.

## What SwarmTales is

SwarmTales is a group-story project on the Koinos blockchain. Readers subscribe or buy packs and
receive **Ink**, a non-transferable writing allowance. They spend Ink to add parts to stories, to
edit their own parts, or to pay for a change to someone else's part. Public stories are open to
contributors; private books are invite-only. Finished books can be read and downloaded.

Three AssemblyScript contracts hold the state and the money: **Ink** (the allowance), **Shop**
(payments in a stablecoin, memberships, packs, story fees, promo links) and **Stories** (stories,
parts, versions, moderation, refunds, strikes). A static website reads the chain and asks the
user's wallet to sign. An hourly copy checker (GitHub Actions) hides copied text with a limited
moderator key. Deploy and moderation tooling runs from the owner's computer.

## Map of the repository

| Path | What it holds |
|---|---|
| `assembly/` (`Ink.ts`, `proto/ink.proto`), root `package.json`, `yarn.lock` | **Ink** contract and its tests |
| `shop/` | **Shop** contract (`shop/assembly/Shop.ts`), its proto and tests |
| `stories/` | **Stories** contract (`stories/assembly/Stories.ts`), its proto and tests |
| `koinos/`, `google/` | Vendored Koinos and protobuf `.proto` definitions used by the build |
| `abi/` | ABI output folder for Ink (generated at build time) |
| `checker/` | Copy checker (`check.mjs`, `lib.mjs`) and its tests |
| `deploy/` | Deploy, admin, moderation and takedown tool (`deploy.js`, `lib.js`) and its tests |
| `web/` | The website (Vite, koilib, Kondor and KOIN Vault wallets) and its tests |
| `.github/workflows/` | `copy-checker.yml` (hourly checker), `pages.yml` (site publishing) |
| `scripts/` | Build helpers (protoc stdin patch, invite-link test fixtures) |
| `tests/chain/` | A local-chain test (needs a local Koinos node; not part of the normal suites) |
| `docs/` | Design, runbooks, `ADMIN_POWERS.md`, `KEY_CUSTODY.md` |

## Scope

The whole repository. The most security-sensitive parts:

- **The three contracts:** `assembly/Ink.ts`, `shop/assembly/Shop.ts`, `stories/assembly/Stories.ts`:
  authority checks, Ink minting and burning, payments, refunds, takedowns and strikes, upgrades.
- **The copy checker** (`checker/`): signs hides and unhides with the moderator key, unattended.
- **Deploy and takedown tooling** (`deploy/`): uploads, admin actions, takedowns, chain-id checks.
- **The site's wallet handling** (`web/src/wallet.js`, `web/src/testWallet.js`, `web/src/chain.js`,
  `web/src/lib/`): what it asks a wallet to sign, KOIN Vault pairing, the testnet-only browser key.

## Build and test (from a fresh clone)

Toolchain used for the figures below: Node.js 24.22.0, npm 11.19.1, Yarn 1.22.22 (via
`npx yarn@1.22.22`; do not use Yarn 2+), `koinos-sdk-as-cli` 1.0.0 and `@koinos/sdk-as` 1.0.0
from the lockfiles, AssemblyScript 0.19.23. The README also documents Node 22.14.0.

```sh
git clone --branch audit-fixes-2 https://github.com/bawcejawn/Swarmtales.git
cd Swarmtales

# Ink (repo root), then Stories, then Shop: build the release before testing
npx yarn@1.22.22 install --frozen-lockfile
npx yarn@1.22.22 build:release
npx yarn@1.22.22 test
sha256sum build/release/contract.wasm

cd stories   # same four commands; hash stories/build/release/contract.wasm
cd ../shop   # same four commands; hash shop/build/release/contract.wasm

# Website (npm test first generates the ABIs the checker also imports)
cd ../web && npm ci && npm test

# Copy checker and deploy tool (after the web step)
cd .. && node --test checker/__tests__/*.test.mjs deploy/__tests__/*.test.js
```

Expected release sha256 (verified from a fresh clone of this branch):

| Contract | sha256 of `build/release/contract.wasm` |
|---|---|
| Ink | `537f523396c1e195c0262e10dd574c28492b269d247a6025a10f30461b2308dc` |
| Stories | `26df39a915ae84c898a988e53a663c457841f3807f8fa3b1ae8ad1fa6a84f0d6` |
| Shop | `4edf015169c85e2f3460abef85aab0ddcbe279c58b074b5b0e208580e54846c6` |

Expected test totals: Ink 53, Stories 381, Shop 89, web 128, checker and deploy 180; 0 failing.

## Deployments

- **Testnet** (Koinos Foundation testnet; the addresses the site uses, `web/src/config.js`):
  Ink `1EbuyYK1kso7GbZamHCU2LRhXaEyePkXpf`, Shop `14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD`,
  Stories `1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ`, payment token (test) `1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju`,
  treasury `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`. Older addresses in some docs are retired.
- **Mainnet:** not deployed.

## Keys and roles

What each role can do is in [docs/ADMIN_POWERS.md](docs/ADMIN_POWERS.md); how the keys are kept is
in [docs/KEY_CUSTODY.md](docs/KEY_CUSTODY.md). No key material is in this repository.

| Role | Can do (short) | Meant to live |
|---|---|---|
| Contract keys (Ink, Shop, Stories) | Upload new code to their address | Hardware wallets or an offline machine, offline after upload |
| Admin (per contract) | Settings, pause, takedowns, admin hides, handover in two steps | 2-of-3 multisig on mainnet, hardware keys |
| Moderator (copy checker) | Hide/unhide parts (not the admin's), take over copy reports hides, source notes, clear summaries | `MODERATOR_WIF` secret in the `copy-checker` GitHub environment, `main` only |
| Treasury, founder | Receive payments only; no contract powers | Hardware wallets, separate from the admin |

## Known and accepted items

- **AB-079 (Low, Stories):** a pre-upgrade writer keeps the summary right through Ink paid for changes to others' parts; fix waits for the next contract upgrade.
- **AB-081 (Low, Stories):** invite links made before the admin blocked their opener still work; fix waits for the next contract upgrade.
- **Untested mutation survivors:** `deploy/lib.js:516` and `web/src/lib/versions.js:30` (`next > from` changed to `>=` survives: no test returns a cursor equal to `from`).
- **Search budget:** when the copy checker's free searches run out (for the run or the month), it stops at the first long part and waits; nothing after it is checked until searches are available.
- **Mainnet `contribution_cap` ≤ 6,000:** `get_versions` paging and the one-time version-62 scan were measured only on a local node with default limits (the scan uses ~90% of a block at 10,000).

## Previous review

Internal automated audits (Audit Bot) were run on this code. Their attack and regression tests are
in the repo as `*.audit-*` files next to each part's own tests, and run with the suites above.

## Reporting findings

Please report privately to the owner, Carl Padavano, not as public GitHub issues.
