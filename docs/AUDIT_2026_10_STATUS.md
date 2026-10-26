# 2026-10 mainnet audit: status of every finding

Audit: "SwarmTales Mainnet Audit — audit-2026-10 (16de9dc)". Fixes merged into `main` on 25 Oct 2026 (pull request #25).
Status: **Fixed** (code changed and tested), **Doc** (documented, no code change needed),
**Owner** (an action only the owner can take), **Live** (a check on a real network).

Tests after the fixes: Ink 53, Shop 104, Stories 426, Sponsor 33, Multisig 23, website 181, copy checker 105, deploy tool 134; 0 failing.
After the re-audit fixes (branch `audit-2026-10b-fixes`, section at the end): Ink 53, Shop 112, Stories 428, Sponsor 39, Multisig 31, website 202, copy checker 117, deploy tool 158; 0 failing.
Live checks were run on a throwaway testnet deploy of these exact builds (Ink `1E6NEt…`, Shop `14oJ1f…`, Stories `1EzAZT…`).

## Medium

| ID | Finding | Status | What changed | Proof |
|---|---|---|---|---|
| M-1 | A long pause lets anyone archive every story; take-over works while paused | Fixed | Activity clock that stops while paused (`paused_at`, `paused_seconds`); `admin_take_over` refused while paused; archive also needs the opener quiet | `Stories.audit-2026-10.spec.ts` M-1; `Stories.coverage.spec.ts` paused archive |
| M-2 | Purchases bind the price, not the Ink | Fixed | `min_ink` on `buy_pack`, `buy_membership`, `pay_open_fee` (from `open_story`); `ink_amounts_event`; site and deploy tool send it | `Shop.spec.ts` M-2; on testnet a pack with `min_ink` one above was refused, "Nothing was charged" |
| M-3 | Reports can hide parts of finished books | Fixed | `report_segment` refused on finalized stories; site points finished-book reports to the report page | M-3 test (and an admin hide there still can't be restored) |
| M-4 | Removed writers keep editing their parts | Fixed | `edit_segment` needs the allow-list (or opener/editor) in private stories; removal stays open | M-4 tests |
| M-5 | 10-part reads break on long multibyte parts | Fixed | `get_segments` stops at ~64 KB and returns `next`; site and checker read 3 per call with a single-part fallback; per-part cap 6,000 in the contract | Unit test; **Live:** six 6,000-character CJK parts read back as pages of 5 and 3, the site showed all 8 parts, the checker read all 8 |
| M-6 | Deploy tool doesn't pin mainnet addresses | Fixed | `MAINNET_PINNED` in `deploy/lib.js` (filled after upload); code-hash check on wiring against `deploy/release-hashes.json` | `deploy.audit-2026-10.test.js` |
| M-7 | The site shares an origin with other Pages sites | Owner (prepared) | One setting (`SITE.url`) switches every link to your domain; CNAME written by the build | `site.audit-m7.test.js`; buy the domain and follow `docs/UI.md` |
| M-8 | Token decimals not checked against the chain | Fixed | Startup reads token `decimals` and Shop `get_asset`; prices hidden on mismatch | `payment.audit-m8.test.js` |
| M-9 | Kondor's window doesn't show what's signed | Fixed, Live at launch | ABIs passed to Kondor (`sendAbis`; Kondor's source reads `optsSend.abis`) | Kondor can't sign on the Foundation testnet at all (its built-in testnet is the old Harbinger chain; its "Optimize mana" step fails there), so the window is checked on the first mainnet purchase |
| M-10 | Checker state can be poisoned through the cache | Fixed | HMAC-sealed state (`CHECKER_STATE_KEY`); Pages build `npm ci --ignore-scripts` | `check.audit-2026-10.test.mjs`; owner adds the secret |
| M-11 | False hides from newer web matches | Fixed | Hide only on a book provably older than the part; web-only matches become notes | checker tests |
| M-12 | No multisig path in the tool | Fixed, checked live | `--prepare`, `cosign`, `submit` for any number of signers, plus SwarmTales' own m-of-n multisig contract (`multisig/`) | deploy tests; the owner's rehearsal on testnet with his real 2-of-3 signers (multisig `1AQb8fmugoSPDmFTdq9ytPxrBjzLeXger2` as Stories admin: accept, pause, unpause, handover back; transaction ids in `AUDIT_SCOPE.md`) |
| M-13 | Checker stalls and loses work | Fixed | Saves every few seconds; 20-minute budget; resumes | checker tests |

## Low

| ID | Finding | Status | What changed |
|---|---|---|---|
| F-03 | Duplicate-text rule skipped by edits and paid changes | Fixed | One text list per story recording the part that first had each text; new parts can't repeat any text the story ever had; edits/changes can't copy another part; a part may go back to its own wording |
| F-04 | Own rewrites skip rights and Terms | Fixed | `edit_segment` takes `rights_confirmed` and `terms_version`; the site asks for them (checked live) |
| F-05 | Opener/editor can remove a part under review | Fixed | They may remove only report-hidden parts (writer keeps the refund) |
| F-06 | Removal keeps no version | Fixed | Removals keep a "removed" version; the text stays as the version before; takedown wipes them |
| F-07 | `replace_pdf` takes any hash | Fixed (tool) | `deploy.js replace-pdf` computes the hash from the chain, the same way the site does |
| F-08 | Blocked finalizer removes any part | Fixed | Only hidden parts |
| F-09 | Blocked wallet can revive or join | Fixed | Both refused |
| S2-03 | Price doubling avoidable | Fixed / Doc | Free revive only at the normal price; extra wallets accepted (documented) |
| S2-04 | Doc claims a per-part refund cap | Doc | Design doc corrected (the cap is per story) |
| S2-05 | Lower cap blocks trimming | Fixed | The cap limits growth only |
| S2-06 | Managed quiet story can be archived | Fixed | Archive needs the opener quiet too |
| C1-01 | Payment-token list mutable | Fixed (record); see H-3 | After the first sale, a new token waits 7 days (public event); decimals/symbol fixed while enabled; off is instant (and works from the admin page again, M-D). The wait covers the Shop's record, not the token's code: the re-audit's H-3 adds code-hash pins. Live: vUSDT's authority rule is an owner check |
| C1-03 | Gifted Writer month wipes Reader time | Fixed | Reader time is saved and resumes after the Writer term |
| C1-04 | Daily cap set mid-day ignores earlier claims | Fixed | Claims are always counted |
| C1-08 | Burner precision | Doc | Ink header comment |
| O1-07 | Lost state silently resets | Fixed | Restored-part protection read from the chain |
| O1-08 | Unsanitized titles in notes | Fixed | Notes cleaned to the contract's rules, checked again before signing |
| O1-09 | Dependencies share the process with the key | Partly fixed | Plan job (no key) / apply job (key). Since the re-audit (M-B, L-12): the apply job decides everything it signs from the chain, its own sealed record and its own book lookup, and loads a committed, hash-checked ABI instead of building one. It still loads koilib to sign; a signer with only Node's built-ins is the remaining step |
| O1-10 | Flag flipping in parseArgs | Fixed | Strict flags |
| O1-11 | set-moderation resets thresholds | Fixed | Keeps current values |
| O1-12 | 10,000 cap allowed on mainnet | Fixed | 6,000 in the contract and the tool |
| O1-13 | Typed wasm hash; real hash printed | Fixed | Pinned `release-hashes.json`; no paste-able hash printed |
| O1-14 | WIF printed into files/pipes | Fixed | Terminal only (also test-promo, test-invite) |
| O1-15 | Runbooks say repository secrets | Fixed (docs) | Environment secrets for the key and state key; search keys as repository secrets |
| O1-16 | Fail-open versions read | Fixed | The part waits instead |
| W1-04 | Vault "Done" for an unrelated tx | Fixed, Live at launch (Vault is mainnet only) | The transaction is read back and compared before "Done" |
| W1-05 | Vault secret in GET query strings | Fixed, Live at launch (Vault is mainnet only; Vault's developer says the POST call is supported) | POST body, GET fallback only if Vault refuses; polling every 10 s once paired |
| W1-06 | Link keys in browser history | Partly fixed | Stripped from the address bar on load (the current history entry is rewritten). The browser's own history list may still hold the first address, which no page can erase (`web/src/lib/links.js` says so) |
| W1-07 | siteBase carries query strings | Fixed | One canonical base for every link |
| W1-08 | Test wallet's dry run hands the node a valid tx | Fixed | One signed transaction, dry-run then sent |

## Info

| Item | Status |
|---|---|
| Bookmarks work while paused | Fixed (refused while paused) |
| Wrong `stories.proto` descriptions | Fixed |
| Only the opener revokes invites (doc said editors too) | Doc fixed |
| Hidden text stays readable on-chain | Doc (ADMIN_POWERS, design doc) |
| `trial_limit` missing from ADMIN_POWERS | Doc fixed |
| Legacy upgrade code dead on mainnet (S2-07) | Fixed: removed (testnet reset) |
| Design-doc drift | Fixed: design doc rewritten to match the code |
| Trial-expired promo wallet makes paid cuts | Fixed |
| Shop lock written before the caller check | Fixed |
| Token-header claims | Fixed (Shop header wording) |
| Dead `pay_close_fee`, mutable Shop stories pointer (C1-07) | Fixed: removed; Stories address set once |
| Link digests omit the chain id | Doc: contract addresses differ per network, and the tool refuses reusing a contract key across networks |
| First Ink address not validated | Fixed (tool): wiring checks each contract's code hash; Shop refuses Ink = Stories |
| Forfeited unclaimed Writer months not stated | Doc (proto, ADMIN_POWERS) |
| Checker trusts its node | Doc (accepted) |
| Takedowns not bound to a reviewed text hash | Fixed: `reviewed_hash` and `reviewed_versions` |
| Citation breaks out of the run summary | Fixed |
| prepare-testnet points at the unsafe CLI path | Fixed |
| main-only environment as strong as push access (O1-21) | Owner: done. `main` is protected: changes only by pull request, the `build` check must pass and the branch be up to date, no bypass (admins included), no force pushes or deletion. Approvals: 0 (one maintainer; GitHub doesn't let an author approve their own pull request) |
| Read-aloud and grammar privacy wording (W1-09) | Fixed |
| Bookmark prompts (W1-10) | Fixed: saved locally, one "Save to my wallet" (checked live) |
| ADMIN_POWERS not linked (W1-11) | Fixed (footer) |
| CSP needs unsafe-eval; h() inline handlers | Doc (koilib/protobufjs need it; reason in `vite.config.js`); h() refuses string handlers |
| Old audit ledger on GitHub (6.7) | Owner: the commit isn't in this repository's branches or pull requests; the auditor is asked for its link with this re-audit request |
| Status × action table with a mirroring test | Fixed: `docs/ADMIN_POWERS.md` and `Stories.status-table.spec.ts` |
| Split the large files | Fixed: Stories in 3 files + `lib/`; website `main.js` in 32 modules |

Also closed from earlier rounds: AB-079 (removed with the legacy code) and AB-081 (invites stop working once their opener is blocked); the two version-paging mutation survivors now have tests.

## Added after the audit (23 Oct 2026): please review in full

| Item | What it is | Proof |
|---|---|---|
| Mana sponsor (`sponsor/`) | One wallet whose `authorize()` pays mana only for transactions the user signed that call Ink, Shop or Stories (or approve the Shop to take the user's own payment token), within per-transaction, per-account-per-day and per-day caps. The owner's own transactions are always paid. Only the transaction-application flag is on. | `Sponsor.spec.ts` (33); live on testnet: sponsored bookmark from a wallet with no KOIN, sponsored approve + buy, five kinds of refusal with the contract's message, the per-account cap |
| Site uses the sponsor (`web/src/lib/sponsor.js`, `chain.js`, `wallet.js`, `testWallet.js`) | Asks the sponsor only when it would say yes; on a sponsor refusal, the same action runs again with the user's mana (same nonce, so at most one is included). KOIN Vault always pays its own. | `sponsor.test.js`; live: the site's new test wallet (no tKOIN) saved a bookmark, paid by the sponsor |
| Deploy tool | `upload sponsor` (only the transaction-application flag), `sponsor-config` (checks the same rules as the contract), `status --sponsor` | `deploy.sponsor.test.js` |
| Multisig wallet (`multisig/`) | m-of-n `authorize()` for calls, payments and uploads; setup once by the wallet's own key (sent in the upload transaction); `set_signers` by quorum. Not deployed yet. | `Multisig.spec.ts` (23) |

## Added after the audit, second batch (25 Oct 2026): please review in full

| Item | What it is | Proof |
|---|---|---|
| Poem story kind | Stories `KIND_POEM = 3`: 50 to 25,000 characters, 10-character close slack, 50 Ink private pool. Shop `ITEM_OPEN_POEM = 10` and `config.starter_poem` (set with `set_ink_amounts`, which now takes `starter_poem`). Site: open page, labels, checks. | `Stories.poem.spec.ts` (9); Shop poem tests; `rules.test.js` |
| Admin page (`web/src/pages/admin.js`, `web/src/lib/admin.js`) | Every admin control; signs with the connected wallet or writes a prepared file in the deploy tool's format (own nonce encoding, uint64). | `admin.test.js`: input checks, and a page-made file passes `verifyPrepared`; a downloaded file decoded by the real `cosign` |
| `multisig-create`, `multisig-signers`, `status --multisig` | Upload + setup in one transaction; signer changes only prepared for the quorum (and, since L-16, every new signer). | `deploy.multisig.test.js`; live on testnet: the owner's rehearsal multisig `1AQb8fmugoSPDmFTdq9ytPxrBjzLeXger2` (2 of 3), its own key refused by the chain |
| Swappable mana payer | `MANA_PAYER` per network in `web/src/config.js`: `sponsor` (reads caps first) or `payer` (any paying contract, just asked). | `sponsor.test.js` |
| Mainnet node | `https://koinos.armana.io` (community) in the site, the deploy tool and the checker; the chain id is checked before anything is signed. | config and checker tests (named explicitly since the re-audit, I-14) |
| Several payment tokens | Shop `get_assets` lists every token with a record (at most 10; `set_asset` refuses an 11th). The site reads them and lets the buyer pick ("Pay with"); every price, balance, approve and the sponsor check follow the pick. Admin page: "Add a payment token" reads the token's decimals and symbol from its contract and prices the Writer month and packs from "Ink for 1 token" (rounded up). Deploy tool: `set-price` (whole tokens, several items, `--rate`) and `set-ink-amounts` (keeps what isn't given). | Shop token-list tests; `admin.test.js`; `deploy.prices.test.js` |
| Multisig signing found live (25 Oct 2026) | `cosign`/`submit` refused every real nonce: koilib writes the nonce as value_type field 5 (tag 0x28) and the check took only field 7. Both are read now; the tests' fake nodes use koilib's real encoding. Prepared transactions now default to a 1 mana limit (admin calls use under 0.1; the node holds the whole limit while a transaction waits). | Full rehearsal on testnet with the developer's preflight multisig (`1JvWfpzUmoUg22ja5JHnUAL5Y8qqP3gWa7`, 2 of 3 test signers; not the owner's rehearsal multisig `1AQb8f…`) as Stories admin: accept_admin (0.09 mana), pause refused with one signature ("has not authorized transaction") and sent with two, unpause, set_signers, handover back |
| Multisig files name their signers (25 Oct 2026) | When the acting account is a multisig, `--prepare` (and the admin page) write its public signer list and threshold into the file (`needs`). `cosign` refuses a key that isn't one of them; `submit` refuses a file with too few of them and leaves out any other signature. A guide only: the chain's multisig still decides. Found when a contract key was pasted at a signer prompt. | `deploy.audit-2026-10.test.js` (needs); live on testnet: the admin key refused at cosign, one signature refused at submit, two sent |

## Re-audit of `main` 98230a7 (25 Oct 2026): status of every finding

Report: "SwarmTales Re-audit — main 98230a7 (fixes + sponsor, multisig, Poem, tokens)"; the plan with
each finding checked against the code is `docs/AUDIT_2026_10B_PLAN.md`. Fixed on branch
`audit-2026-10b-fixes`, one commit per finding (`fix(audit-<ID>)`). Owner decisions: 1a, 2a, 3 yes/yes,
4a, 5 fix. Fixing H-1, M-A, M-D, L-1, L-2, L-4, L-5, L-16 and L-17 changes Multisig, Sponsor, Shop
and Stories, so their release hashes change (`AUDIT_SCOPE.md`); Ink is unchanged. They need a short
follow-up review, new testnet uploads and a new multisig rehearsal before the hashes go into
`deploy/release-hashes.json` and `MAINNET_PINNED`.

| ID | Finding | Status | What changed |
|---|---|---|---|
| H-1 | Multisig answers any contract's request | Fixed | `authorize` says yes to a call only when `call.caller` is empty; `set_signers` and `setup` refuse nested calls; the tool refuses a contract wallet as payer (prepare and submit) |
| H-2 | cosign can be shown a fake operation list | Fixed | Known command names and strict ISO `prepared_at` only; control and bidi characters shown escaped in every printed line; terminal reset before the operations; targets repeated at the SIGN prompt |
| H-3 | A payment token's code can change after the 7-day wait | Fixed (off-chain) | Tokens pinned with address, symbol, decimals and code hash (`web/src/config.js` `PAYMENT_TOKENS`, `deploy/lib.js` `TOKEN_PINS`); the site refuses a token whose code isn't its pin; set-asset refuses no contract, other code, and unpinned tokens on mainnet; `ADMIN_POWERS.md` names the issuer trust |
| M-A | Sponsor cap filled for free | Fixed | Sponsored-call allow-list in the sponsor's config (new field); tool default list and caps 1/20/300 mana; hourly GitHub Actions alert (`sponsor-alert.yml`). Owner's choice: run with `--per-tx 4`, not 1, so a full-size part (the site asks for up to 3.5 mana; about 1.8 used) is always sponsored. The site asks each transaction for its own size estimate, not the cap; per wallet (20) and per day (300) stay the limits |
| M-B | Checker key job trusts the plan job | Fixed | Apply derives restored-part protection from the chain and its own sealed record, looks books up itself, writes every note itself, and seals its own protections (the plan's search progress is kept, owner's choice) |
| M-C | Amounts above 2^64-1 wrap | Fixed | Refused in every helper (tool and page); every encoded operation is decoded back before signing |
| M-D | "Turn off" reverts | Fixed | Shop keeps the stored decimals and symbol when turning a token off; the page sends them |
| L-1 | Removed writer sets citations | Fixed | `requireMember` for setting one (clearing stays allowed) |
| L-2 | Poem opening over its size | Fixed | Opening cost must be at most `max_chars` |
| L-3 | Writer can make prepared takedowns fail | Fixed (runbook, tool) | Hide first with the moderator key; the tool says so |
| L-4 | Fee overflow on 16-18-decimal tokens | Fixed | `founderShare` = (p/D)*f + (p%D)*f/D |
| L-5 | Token slots permanent | Fixed | New admin method `shop.remove_asset` (a turned-off token; clears its prices) |
| L-6 | Docs overstate token guarantees | Fixed (docs) | "For an honest token"; the issuer named as a trust assumption |
| L-7 | Nonce tag 0x38 accepted | Fixed | Only 0x28 |
| L-8 | One token pin, one override for all | Fixed | Token pins are a list; the override names its role; `--tokens` and `--admin` are pin-checked |
| L-9 | set-asset trusts typed decimals | Fixed | Reads the token's own decimals and symbol |
| L-10 | Whole-settings setters revert later changes | Fixed | submit shows "now -> after" per field |
| L-11 | Prepared files never expire | Fixed | submit re-reads the next nonce; how to cancel is documented |
| L-12 | Apply loads dependencies beside the key | Fixed (decision 4a) | Committed, hash-checked ABI; no ABI build in the key job |
| L-13 | Sponsored mana pays for other code | Doc | Bounded by the ~1 mana per-transaction cap |
| L-14 | Pending sponsored transactions not counted | Doc | Keep KOIN well above 5x the cap; the alert checks it; the site falls back |
| L-15 | Any contract can call `sponsor.authorize` | **False positive** | koinos-chain's call thunk refuses a call to the authorize entry point that doesn't come from kernel mode ("authorize should only be called from kernel mode", `system_calls.cpp`). No change |
| L-16 | Instant signer rotation | Fixed (decision 3) | Every new signer must sign; threshold below the number of signers (3 to 10 signers) |
| L-17 | Sponsor key used hot; no direct-call check | Fixed | The page shows the `sponsor-config` command only; `set_config` refuses nested calls; ADMIN_POWERS row fixed |
| L-18 | Non-default token checks from one node | Fixed | Covered by H-3's pins |
| L-19 | Old prices after a token switch | Fixed | Prices hidden and purchases refused until the picked token's prices load |
| L-20 | Unexplained second Kondor window | Fixed | Retries only if the node doesn't know the sponsored transaction; says why a second window opens |
| L-21 | Admin page open to all; any write method | Fixed | Admin methods only; controls only for an admin or a signer of the admin multisig |
| L-22 | Vault GET fallback on network errors | Fixed (decision 5) | Only on 404, 405, 415 or 501; to be confirmed with Vault on launch day |
| I-1 | starter_poem reset by an old caller | Doc | Fails closed |
| I-2 | Two tokens share a symbol | Fixed | Tool, page and config refuse it |
| I-3 | Stale proto comment | Fixed | |
| I-4 | Mempool watcher posts a pending part first | Doc | |
| I-5 | Proto and design-doc drift | Fixed | set_blocked, set_citation, close slack, Poem kind |
| I-6 | Poem refrains and short lines | Doc | Design doc and the open page's Poem text |
| I-7 | starter_poem vs the Poem price | Fixed | Tool and page warn |
| I-8 | Invite expiry runs during a pause | Doc | |
| I-9 | Quorum for each final-edit batch | Doc | |
| I-10 | Payee signature dropped | Fixed | Kept by cosign and submit |
| I-11 | `--network __proto__` | Fixed | Own-property lookup |
| I-12 | Contradicting tool comments | Fixed | |
| I-13 | Checker has no timeouts | Fixed | Fetch and RPC timeouts |
| I-14 | No test for the mainnet node mapping | Fixed | Checker, site and tool tests |
| I-15 | Dead `if (!publicKey) continue` | Fixed | Removed in Sponsor and Multisig |
| I-16 | Stale multisig README; two rehearsal addresses | Fixed | `1AQb8f…` is the owner's rehearsal multisig, `1JvWfp…` the developer's preflight multisig |
| I-17 | Vault address unchecked; no wait limit | Fixed | Address validated; 15-minute limit |
| I-18 | Mainnet build allows github.io and no copyright email | Fixed | `configProblems` refuses both on mainnet |
| I-19 | Promo ids read before signing | Doc | The dry run at submit catches a taken id |
| I-20 | needs and nonce come from the node | Doc | The nonce is re-read at submit (L-11) |
| I-21 | 1 mana too low for multi-operation files | Fixed | 1 mana per operation, at most 10 |
| I-22 | No sponsor ABI for Kondor | Fixed | `abisFor` includes the sponsor (no site operation calls the multisig) |

Status-doc corrections from the re-audit: W1-06 and O1-09 above are "Partly fixed"; the mainnet-node
claim is now backed by tests (I-14); the multisig README no longer implies the multisig narrows what
a signature authorizes (it doesn't: the signatures cover the whole transaction, H-1); ADMIN_POWERS.md
says "for an honest token" and that the sponsor key stays offline; sponsor/README.md says counts are
kept on revert (never undercounted); the two testnet multisig addresses are named (I-16).
