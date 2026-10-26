# Audit scope

For the independent auditor. This is the version we intend to deploy: the `main` branch, into which
the fixes for the 2026-10 mainnet audit (report "SwarmTales Mainnet Audit — audit-2026-10 (16de9dc)")
were merged on 25 October 2026 (pull request #25, branch `audit-2026-10-fixes`; this note was updated
in pull request #26, documentation only). What is asked for: a re-audit of the diff from `16de9dc`,
**plus a full review of everything added since that audit** (listed under "New since the audit"
below: the mana sponsor, the multisig wallet, the Poem story kind, several payment tokens, the admin
page and the deploy tool's multisig signing). The finding-by-finding status is in
`docs/AUDIT_2026_10_STATUS.md`.

**Re-audit follow-up (branch `audit-2026-10b-fixes`):** the fixes for the re-audit of `main` 98230a7
("SwarmTales Re-audit — main 98230a7 (fixes + sponsor, multisig, Poem, tokens)"; plan in
`docs/AUDIT_2026_10B_PLAN.md`, status at the end of `docs/AUDIT_2026_10_STATUS.md`). They change four
contracts (Multisig: H-1, L-16; Sponsor: M-A, L-17; Shop: M-D, L-4, L-5; Stories: L-1, L-2); Ink is
unchanged. What is asked for is a short follow-up review of those changes, chiefly H-1 in
`multisig/assembly/Multisig.ts`, the sponsor's new allow-list, `shop.remove_asset`, and the copy
checker's apply job (M-B).

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
| `.github/workflows/` | `copy-checker.yml` (hourly checker), `pages.yml` (site publishing), `sponsor-alert.yml` (hourly mana-sponsor usage alert, M-A) |
| `scripts/` | Build helpers (protoc stdin patch, invite-link test fixtures), `sponsor-alert.mjs` (the alert's read-only check) |
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

# Website (npm test first generates its ABIs; the checker uses its own committed, hash-checked ABI, L-12)
cd ../web && npm ci && npm test

# Copy checker and deploy tool (after the web step)
cd .. && node --test "checker/__tests__/*.test.mjs" "deploy/__tests__/*.test.js"
```

Expected release sha256 of this branch (`audit-2026-10b-fixes`, with the re-audit fixes):

| Contract | sha256 of `build/release/contract.wasm` | Changed by |
|---|---|---|
| Ink | `537f523396c1e195c0262e10dd574c28492b269d247a6025a10f30461b2308dc` | unchanged |
| Stories | `d03371559169d2bded741a2d982546ef2d8b01c5795a23ff1ba2793ede1135cf` | L-1, L-2 |
| Shop | `b9e275372293ac4e83eede5317876d9f5553aa6a0db024fe6ef1fbe50dc20480` | M-D, L-4, L-5 |
| Sponsor | `6c204bcb3cbca2e392c7c9cadb0b38c33440d4d09ef10cd5a8a0c3f1435c4353` | M-A, L-17, I-15 |
| Multisig | `00409ea9fcfb47ed690e623a06661b64852dcf709f1166e156880853382d69ce` | H-1, L-16, I-15 |

(Built here with Node.js 24.22.1 and the lockfiles' toolchain; Ink's hash is the one the auditor
reproduced with Node.js 22.22.0. The re-audited `main` 98230a7 hashes were Stories `231674…35c1`,
Shop `15759f…8910`, Sponsor `ed36d0…4ad0`, Multisig `c4867a…ddb8`. The new ones go into
`deploy/release-hashes.json` and the addresses into `MAINNET_PINNED` only after the follow-up review
and a second person reproducing them; the deploy tool refuses a mainnet upload or wiring that
doesn't match.)

Expected test totals: Ink 53, Stories 428, Shop 112, Sponsor 39, Multisig 31, web 202, checker 117,
deploy 158; 0 failing.
The Stories suite takes about an hour on a two-core machine.

## Deployments

- **Testnet:** redeployed fresh with this build on 23 October 2026 (`docs/TESTNET_DEPLOY.md`):
  Ink `1JXZiYaymCCG61YtfBF4L5bnbxem11rTFk`, Shop `13i2g8x9CxKXhuo3EiPbUE6P5G5QDRgqwQ`, Stories
  `1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR`, admin `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`, moderator
  `1AaN68ttQtmhG3HQpGoQr2iuSsYiTxbEsD`. The website points at these. A throwaway preflight
  deploy of exactly these hashes (Ink `1E6NEt6XdP6UeB7uZzQFQ5ovWie9mJtuy`, Shop
  `14oJ1fQEyFUXR3S3oknYhMXWrSDj38twFY`, Stories `1EzAZTf58wajDKnZPKtTASp62CTNtAP4iv`) was used
  for the end-to-end checks.
- **Testnet mana sponsor:** `12eQDZUBAaoScqFTW4zSy4ziAoxctnCxyS` (a throwaway test key) was the
  first, set up for the testnet contracts above; the website now uses `1De7ea6SyHRT7SsHNnwLzTBuqf5ixZ1ZyZ`
  (`MANA_PAYER` in `web/src/config.js`; read 25 Oct 2026: on, caps 4/20/300 mana, 1,000 mana). The
  first still runs the build before M-A and L-17; `1De7ea…` was upgraded to the fixed build on 26 Oct (below). Checked live on 23 Oct 2026: a wallet with no KOIN saved a bookmark
  and the site's test wallet did too (sponsor paid); a Reader month bought with approve + buy was
  paid; a token transfer, an approve for another spender, a payee who didn't sign, a mana limit over
  the cap and a call to another contract were all refused with the contract's message; the
  per-account daily cap stopped the third 2-mana bookmark.
- **Testnet multisigs** (the build before H-1 and L-16; re-made for the new rehearsal): the
  developer's preflight multisig `1JvWfpzUmoUg22ja5JHnUAL5Y8qqP3gWa7` (2 of 3 test signers; found and
  fixed the nonce encoding) and **the owner's rehearsal multisig** `1AQb8fmugoSPDmFTdq9ytPxrBjzLeXger2`, made with
  `multisig-create` on 25 Oct 2026: 2 of 3 of the owner's signers `1LrT3gTG9Rpf5zHf9DENaEgXEuhTdKxFtP`,
  `1C8hrrjXYykrDmPBioex7YRv7cEt1mBcEi`, `1Nw9fsuYPjQXX8pnz9sqg1cSyYyJPWoYat`. A transaction signed only by
  its own key is refused by the chain ("has not authorized transaction").
  The owner's rehearsal with it on 25 Oct 2026 (Stories admin handed to the multisig and back, each
  step signed by two of the three signers): accept `0x1220aeb7…9c23`, pause `0x122098dc…c890`,
  unpause `0x1220597c…ad5a`, propose back `0x12208653…90d8`, accept back `0x1220a60e…61e2`.
- **Re-audit fixes on testnet, 26 Oct 2026** (the hashes in the table above, rebuilt and matched on the
  owner's Windows machine): upgraded in place, data kept: Shop `0x122074472ee1e492e73a7c24986e130e3d8bd275b8884e18be0bfaf15c15728c04c0`,
  Stories `0x12202e395f76451cc2256319a6f113e5b09f158515eec73b7bf4dec543c71181d7cb`, Sponsor
  `0x1220a29f9d03ba06aa77ef00aed4426a7cf6133bd59c242b6a82c19723e79d43f727`. Sponsor config with the
  10-call allow-list, caps 4/20/300 mana (the owner's choice of 4, see the status doc):
  `0x122068a9deb0da4a85174a637eb70f8fbd67b964b998526ed24181921d88bf1676af`.
  New rehearsal multisig with the fixed build: `19YXRkXUD3uAkWYnN3CTi6zCAregmRhXs5` (2 of 3 of the
  owner's signers above), created `0x1220f1b7810f17f8991a575949f046ba0bf4af027055a9064ada8d2c91e47d951877`.
  Rehearsal (each multisig step signed by two different signers, payer = the multisig):
  propose (admin key) `0x12200380d3bc1f4e52461a8f9249e38468d65204a26a33e30f6bd7540adc86e0ef07`,
  accept `0x1220301d8b7f59fc9db951a23ac52bcde8806bc19db929ba439b29b7f50019a945d0`,
  pause `0x1220091bf774dda7ffc7d93afd33770e90590019020580d808e5483af32b79a28ea1`,
  unpause `0x1220669d9893cd93715b2e2bac66dd10efea2516807f763161c98fad22ed0592c624`,
  propose back `0x1220d295213d61ed45a4d49a6c7d3615cfbf0b0f9a315a3f9f697d4afeda5c2173d9`,
  accept back (admin key) `0x122082816af03694c19c1817ba24660a605c4b39366ea90e6dae2209f8d2e880fb88`.
  Stories ends with admin `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`, nothing pending, not paused. Also seen live:
  a set_paused prepared before the multisig was admin was refused by Stories ("admin authority required");
  a file signed by the multisig's own key plus one signer was refused by `submit` (1 of 2), and `cosign`
  now refuses that key outright; `--payer` set to the sponsor contract for a multisig transaction was
  refused before anything was written (the H-1 tool check).
- **Mainnet:** not deployed. The mainnet multisig will be `1BtSGxigg2Nc5uNcei3XnrEg9WXDyGJ6if` (same signers),
  created with the Multisig build above (with the H-1 and L-16 fixes), not an earlier one.

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
