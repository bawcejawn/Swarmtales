# Audit scope

For the independent auditor. This is the version we intend to deploy: branch
`audit-2026-10-fixes`, the fixes for the 2026-10 mainnet audit (report "SwarmTales Mainnet Audit —
audit-2026-10 (16de9dc)"). A targeted re-audit of the diff from `16de9dc` is what is asked for; the
finding-by-finding status is in `docs/AUDIT_2026_10_STATUS.md`.

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
| `stories/` | **Stories** contract: `stories/assembly/Stories.ts` (reads, opening, writing, final edit, archive), `StoriesAdmin.ts` (moderation, settings), `StoriesBase.ts` (storage, helpers), `lib/` (rules, keys, text checks); its proto and tests |
| `koinos/`, `google/` | Vendored Koinos and protobuf `.proto` definitions used by the build |
| `abi/` | ABI output folder for Ink (generated at build time) |
| `checker/` | Copy checker: `check.mjs` (plan, no key), `apply.mjs` (signs with the moderator key), `state.mjs` (sealed state), `chain.mjs`, `lib.mjs`, and tests |
| `deploy/` | Deploy, admin, multisig (prepare/cosign/submit), moderation and takedown tool (`deploy.js`, `lib.js`), pinned release hashes (`release-hashes.json`) and tests |
| `web/` | The website (Vite, koilib, Kondor and KOIN Vault wallets) and its tests |
| `.github/workflows/` | `copy-checker.yml` (hourly checker), `pages.yml` (site publishing) |
| `scripts/` | Build helpers (protoc stdin patch, invite-link test fixtures) |
| `tests/chain/` | A local-chain test (needs a local Koinos node; not part of the normal suites) |
| `docs/` | Design, runbooks, `ADMIN_POWERS.md`, `KEY_CUSTODY.md` |

## Scope

The whole repository. The most security-sensitive parts:

- **The three contracts:** `assembly/Ink.ts`, `shop/assembly/Shop.ts`, `stories/assembly/` (all files):
  authority checks, Ink minting and burning, payments, refunds, takedowns and strikes, upgrades.
- **The copy checker** (`checker/`): signs hides and unhides with the moderator key, unattended.
- **Deploy and takedown tooling** (`deploy/`): uploads, admin actions, takedowns, chain-id checks.
- **The site's wallet handling** (`web/src/wallet.js`, `web/src/testWallet.js`, `web/src/chain.js`,
  `web/src/lib/`): what it asks a wallet to sign, KOIN Vault pairing, the testnet-only browser key.

## Build and test (from a fresh clone)

Toolchain used for the figures below: Node.js 22.22.0, npm 10, Yarn 1.22.22 (via
`npx yarn@1.22.22`; do not use Yarn 2+), `koinos-sdk-as-cli` 1.0.0 and `@koinos/sdk-as` 1.0.0
from the lockfiles, AssemblyScript 0.19.23.

```sh
git clone --branch audit-2026-10-fixes https://github.com/bawcejawn/Swarmtales.git
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
cd .. && node --test "checker/__tests__/*.test.mjs" "deploy/__tests__/*.test.js"
```

Expected release sha256 (verified from a fresh clone of this branch):

| Contract | sha256 of `build/release/contract.wasm` |
|---|---|
| Ink | `537f523396c1e195c0262e10dd574c28492b269d247a6025a10f30461b2308dc` |
| Stories | `4b146f3b68658ce06b4eb43e7152a8194099a9512b181129ae59edb0b7162f40` |
| Shop | `f0e0622082bf5e13ed1eb6578457fa28450d28bfe5c7ff5c79499b2184b4bcce` |

(Built with Node.js 22.22.0. These are copied into `deploy/release-hashes.json` once reproduced
by a second person; the deploy tool refuses a mainnet upload or wiring that doesn't match.)

Expected test totals: Ink 53, Stories 417, Shop 98, web 162, checker 105, deploy 115; 0 failing.
The Stories suite takes about an hour on a two-core machine.

## Deployments

- **Testnet:** redeployed fresh with this build on 23 October 2026 (`docs/TESTNET_DEPLOY.md`):
  Ink `1JXZiYaymCCG61YtfBF4L5bnbxem11rTFk`, Shop `13i2g8x9CxKXhuo3EiPbUE6P5G5QDRgqwQ`, Stories
  `1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR`, admin `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`, moderator
  `1AaN68ttQtmhG3HQpGoQr2iuSsYiTxbEsD`. The website points at these. A throwaway preflight
  deploy of exactly these hashes (Ink `1E6NEt6XdP6UeB7uZzQFQ5ovWie9mJtuy`, Shop
  `14oJ1fQEyFUXR3S3oknYhMXWrSDj38twFY`, Stories `1EzAZTf58wajDKnZPKtTASp62CTNtAP4iv`) was used
  for the end-to-end checks.
- **Mainnet:** not deployed.

## Keys and roles

What each role can do is in [docs/ADMIN_POWERS.md](docs/ADMIN_POWERS.md); how the keys are kept is
in [docs/KEY_CUSTODY.md](docs/KEY_CUSTODY.md). No key material is in this repository.

| Role | Can do (short) | Meant to live |
|---|---|---|
| Contract keys (Ink, Shop, Stories) | Upload new code to their address | Hardware wallets or an offline machine, offline after upload |
| Admin (per contract) | Settings, pause, takedowns, admin hides, handover in two steps | 2-of-3 multisig on mainnet, hardware keys |
| Moderator (copy checker) | Hide/unhide parts (not the admin's), take over copy reports hides, source notes, clear summaries | `MODERATOR_WIF` environment secret in `copy-checker` (`main` only), used only by the apply job |
| Treasury, founder | Receive payments only; no contract powers | Hardware wallets, separate from the admin |

## Known and accepted items

- **Accepted by the owner:** separate wallets avoid the open-price doubling (S2-03); hidden text stays readable on-chain until taken down; the copy checker trusts its node's data; the checker's saved progress can be rolled back to an older sealed copy by someone with cache write access (it only forgets recent work); an admin's hand-unhide of a checker hide is remembered only in that state.
- **Search budget:** when the copy checker's free searches run out (for the run or the month), it stops at the first long part and waits; nothing after it is checked until searches are available.
- **`contribution_cap` is at most 6,000 in the contract** (audit M-5, O1-12). Six 6,000-character CJK parts were written to the preflight Stories and read back by the website and the checker.

## Previous review

Internal automated audits (Audit Bot) were run on this code. Their attack and regression tests are
in the repo as `*.audit-*` files next to each part's own tests, and run with the suites above.

## Reporting findings

Please report privately to the owner, Carl Padavano, not as public GitHub issues.
