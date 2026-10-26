# Audit scope

For the independent auditor. This is the version we intend to deploy: the `main` branch, into which
the fixes for the 2026-10 mainnet audit (report "SwarmTales Mainnet Audit — audit-2026-10 (16de9dc)")
were merged on 25 October 2026 (pull request #25, branch `audit-2026-10-fixes`; this note was updated
in pull request #26, documentation only). What is asked for: a re-audit of the diff from `16de9dc`,
**plus a full review of everything added since that audit** (listed under "New since the audit"
below: the mana sponsor, the multisig wallet, the Poem story kind, several payment tokens, the admin
page and the deploy tool's multisig signing). The finding-by-finding status is in
`docs/AUDIT_2026_10_STATUS.md`.

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
| `sponsor/` | **Mana sponsor** (added 23 Oct 2026, after the audit): `sponsor/assembly/Sponsor.ts` and its proto and tests. An `authorize()` contract on one wallet that pays mana only for SwarmTales transactions, with caps |
| `multisig/` | **Multisig wallet** (added 23 Oct 2026, after the audit; not deployed yet): `multisig/assembly/Multisig.ts`, proto and tests. An `authorize()` contract that makes one wallet m-of-n, meant as the admin of the three contracts |
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
- **New since the audit, second batch (25 Oct 2026):** the **Poem** story kind (Stories kind 3,
  50 to 25,000 characters, Shop item 10 and `starter_poem`); the **admin page** (`web/src/pages/admin.js`,
  `web/src/lib/admin.js`: signs admin calls with the connected wallet or writes a prepared file that
  the deploy tool's `cosign` checks); `multisig-create` / `multisig-signers` in the deploy tool; the
  swappable mana payer (`MANA_PAYER` in `web/src/config.js`); the community mainnet node
  `koinos.armana.io` (chain id checked before anything is signed); several payment tokens: Shop
  `get_assets` (at most 10 tokens with a record), a "Pay with" choice on the site, an "Add a payment
  token" form priced from an Ink rate, and `set-price` / `set-ink-amounts` in the deploy tool.
- **New since the audit (please review in full):** `sponsor/assembly/Sponsor.ts` (pays mana for
  other people's transactions: which transactions, caps, signature recovery) and
  `multisig/assembly/Multisig.ts` (m-of-n `authorize()` for calls, payments and uploads; setup and
  signer changes). The site's use of the sponsor is `web/src/lib/sponsor.js`, `sponsorFunding()` in
  `web/src/chain.js`, and the fallback in `web/src/wallet.js` / `web/src/testWallet.js`; the tool's
  is `upload sponsor` and `sponsor-config` in `deploy/deploy.js`.
- **The copy checker** (`checker/`): signs hides and unhides with the moderator key, unattended.
- **Deploy and takedown tooling** (`deploy/`): uploads, admin actions, takedowns, chain-id checks.
- **The site's wallet handling** (`web/src/wallet.js`, `web/src/testWallet.js`, `web/src/chain.js`,
  `web/src/lib/`): what it asks a wallet to sign, KOIN Vault pairing, the testnet-only browser key.

## Build and test (from a fresh clone)

Toolchain used for the figures below: Node.js 22.22.0, npm 10, Yarn 1.22.22 (via
`npx yarn@1.22.22`; do not use Yarn 2+), `koinos-sdk-as-cli` 1.0.0 and `@koinos/sdk-as` 1.0.0
from the lockfiles, AssemblyScript 0.19.23.

```sh
git clone https://github.com/bawcejawn/Swarmtales.git
cd Swarmtales

# Ink (repo root), then Stories, then Shop: build the release before testing
npx yarn@1.22.22 install --frozen-lockfile
npx yarn@1.22.22 build:release
npx yarn@1.22.22 test
sha256sum build/release/contract.wasm

cd stories     # same four commands; hash stories/build/release/contract.wasm
cd ../shop     # same four commands; hash shop/build/release/contract.wasm
cd ../sponsor  # same four commands; hash sponsor/build/release/contract.wasm
cd ../multisig # same four commands; hash multisig/build/release/contract.wasm

# Website (npm test first generates the ABIs the checker also imports)
cd ../web && npm ci && npm test

# Copy checker and deploy tool (after the web step)
cd .. && node --test "checker/__tests__/*.test.mjs" "deploy/__tests__/*.test.js"
```

Expected release sha256 (verified from a fresh clone; the contracts are the same on `main`):

| Contract | sha256 of `build/release/contract.wasm` |
|---|---|
| Ink | `537f523396c1e195c0262e10dd574c28492b269d247a6025a10f30461b2308dc` |
| Stories | `231674514bb71c3a44a761babff8df0b27efc3313ccd499f18e9ccebde2335c1` |
| Shop | `15759f4c5b489c71675e4ee2273eaae62f6e64957fa837a5d9229855a6fd8910` |
| Sponsor | `ed36d0bfc49a52a687489be4f46373b8c12bea52551785582223d66c219f4ad0` |
| Multisig | `c4867a75bb90afa9b27a64a0452c093e38843764f8171aac0516d8fd2738ddb8` |

(Built with Node.js 22.22.0. These are copied into `deploy/release-hashes.json` once reproduced
by a second person; the deploy tool refuses a mainnet upload or wiring that doesn't match.)

Expected test totals: Ink 53, Stories 426, Shop 104, Sponsor 33, Multisig 23, web 181, checker 105,
deploy 134; 0 failing.
The Stories suite takes about an hour on a two-core machine.

## Deployments

- **Testnet:** redeployed fresh with this build on 23 October 2026 (`docs/TESTNET_DEPLOY.md`):
  Ink `1JXZiYaymCCG61YtfBF4L5bnbxem11rTFk`, Shop `13i2g8x9CxKXhuo3EiPbUE6P5G5QDRgqwQ`, Stories
  `1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR`, admin `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`, moderator
  `1AaN68ttQtmhG3HQpGoQr2iuSsYiTxbEsD`. The website points at these. A throwaway preflight
  deploy of exactly these hashes (Ink `1E6NEt6XdP6UeB7uZzQFQ5ovWie9mJtuy`, Shop
  `14oJ1fQEyFUXR3S3oknYhMXWrSDj38twFY`, Stories `1EzAZTf58wajDKnZPKtTASp62CTNtAP4iv`) was used
  for the end-to-end checks.
- **Testnet mana sponsor:** `12eQDZUBAaoScqFTW4zSy4ziAoxctnCxyS` (a throwaway test key), set up for
  the testnet contracts above. Checked live on 23 Oct 2026: a wallet with no KOIN saved a bookmark
  and the site's test wallet did too (sponsor paid); a Reader month bought with approve + buy was
  paid; a token transfer, an approve for another spender, a payee who didn't sign, a mana limit over
  the cap and a call to another contract were all refused with the contract's message; the
  per-account daily cap stopped the third 2-mana bookmark.
- **Testnet multisig rehearsal wallet:** `1AQb8fmugoSPDmFTdq9ytPxrBjzLeXger2`, made with
  `multisig-create` on 25 Oct 2026: 2 of 3 of the owner's signers `1LrT3gTG9Rpf5zHf9DENaEgXEuhTdKxFtP`,
  `1C8hrrjXYykrDmPBioex7YRv7cEt1mBcEi`, `1Nw9fsuYPjQXX8pnz9sqg1cSyYyJPWoYat`. A transaction signed only by
  its own key is refused by the chain ("has not authorized transaction").
  The owner's rehearsal with it on 25 Oct 2026 (Stories admin handed to the multisig and back, each
  step signed by two of the three signers): accept `0x1220aeb7…9c23`, pause `0x122098dc…c890`,
  unpause `0x1220597c…ad5a`, propose back `0x12208653…90d8`, accept back `0x1220a60e…61e2`.
- **Mainnet:** not deployed. The mainnet multisig will be `1BtSGxigg2Nc5uNcei3XnrEg9WXDyGJ6if` (same signers).

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
