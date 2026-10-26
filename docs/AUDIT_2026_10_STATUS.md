# 2026-10 mainnet audit: status of every finding

Audit: "SwarmTales Mainnet Audit — audit-2026-10 (16de9dc)". Fixes on branch `audit-2026-10-fixes`.
Status: **Fixed** (code changed and tested), **Doc** (documented, no code change needed),
**Owner** (an action only the owner can take), **Live** (a check on a real network).

Tests after the fixes: Ink 53, Shop 104, Stories 426, Sponsor 33, Multisig 23, website 181, copy checker 105, deploy tool 134; 0 failing.
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
| M-9 | Kondor's window doesn't show what's signed | Fixed, Live pending | ABIs passed to Kondor (`sendAbis`) | Owner: check the Kondor window on testnet (`docs/OWNER_STEPS.md`) |
| M-10 | Checker state can be poisoned through the cache | Fixed | HMAC-sealed state (`CHECKER_STATE_KEY`); Pages build `npm ci --ignore-scripts` | `check.audit-2026-10.test.mjs`; owner adds the secret |
| M-11 | False hides from newer web matches | Fixed | Hide only on a book provably older than the part; web-only matches become notes | checker tests |
| M-12 | No multisig path in the tool | Fixed, Live pending | `--prepare`, `cosign`, `submit` for any number of signers | deploy tests; owner rehearses a pause with the real multisig |
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
| C1-01 | Payment-token list mutable | Fixed | After the first sale, a new token waits 7 days (public event); decimals/symbol fixed while enabled; off is instant. Live: vUSDT's authority rule is an owner check |
| C1-03 | Gifted Writer month wipes Reader time | Fixed | Reader time is saved and resumes after the Writer term |
| C1-04 | Daily cap set mid-day ignores earlier claims | Fixed | Claims are always counted |
| C1-08 | Burner precision | Doc | Ink header comment |
| O1-07 | Lost state silently resets | Fixed | Restored-part protection read from the chain |
| O1-08 | Unsanitized titles in notes | Fixed | Notes cleaned to the contract's rules, checked again before signing |
| O1-09 | Dependencies share the process with the key | Fixed | Plan job (no key) / apply job (key, re-validates on chain) |
| O1-10 | Flag flipping in parseArgs | Fixed | Strict flags |
| O1-11 | set-moderation resets thresholds | Fixed | Keeps current values |
| O1-12 | 10,000 cap allowed on mainnet | Fixed | 6,000 in the contract and the tool |
| O1-13 | Typed wasm hash; real hash printed | Fixed | Pinned `release-hashes.json`; no paste-able hash printed |
| O1-14 | WIF printed into files/pipes | Fixed | Terminal only (also test-promo, test-invite) |
| O1-15 | Runbooks say repository secrets | Fixed (docs) | Environment secrets for the key and state key; search keys as repository secrets |
| O1-16 | Fail-open versions read | Fixed | The part waits instead |
| W1-04 | Vault "Done" for an unrelated tx | Fixed, Live pending | The transaction is read back and compared before "Done" |
| W1-05 | Vault secret in GET query strings | Fixed, Live pending | POST body, GET fallback only if Vault refuses; polling every 10 s once paired |
| W1-06 | Link keys in browser history | Fixed | Stripped from the address bar on load |
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
| main-only environment as strong as push access (O1-21) | Owner: branch protection |
| Read-aloud and grammar privacy wording (W1-09) | Fixed |
| Bookmark prompts (W1-10) | Fixed: saved locally, one "Save to my wallet" (checked live) |
| ADMIN_POWERS not linked (W1-11) | Fixed (footer) |
| CSP needs unsafe-eval; h() inline handlers | Doc (koilib/protobufjs need it; reason in `vite.config.js`); h() refuses string handlers |
| Old audit ledger on GitHub (6.7) | Owner (`docs/OWNER_STEPS.md`) |
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
| `multisig-create`, `multisig-signers`, `status --multisig` | Upload + setup in one transaction; signer changes only prepared for the quorum. | `deploy.multisig.test.js`; live on testnet: `1AQb8fmugoSPDmFTdq9ytPxrBjzLeXger2` (2 of 3), its own key refused by the chain |
| Swappable mana payer | `MANA_PAYER` per network in `web/src/config.js`: `sponsor` (reads caps first) or `payer` (any paying contract, just asked). | `sponsor.test.js` |
| Mainnet node | `https://koinos.armana.io` (community) in the site, the deploy tool and the checker; the chain id is checked before anything is signed. | config and checker tests |
| Several payment tokens | Shop `get_assets` lists every token with a record (at most 10; `set_asset` refuses an 11th). The site reads them and lets the buyer pick ("Pay with"); every price, balance, approve and the sponsor check follow the pick. Admin page: "Add a payment token" reads the token's decimals and symbol from its contract and prices the Writer month and packs from "Ink for 1 token" (rounded up). Deploy tool: `set-price` (whole tokens, several items, `--rate`) and `set-ink-amounts` (keeps what isn't given). | Shop token-list tests; `admin.test.js`; `deploy.prices.test.js` |
| Multisig signing found live (25 Oct 2026) | `cosign`/`submit` refused every real nonce: koilib writes the nonce as value_type field 5 (tag 0x28) and the check took only field 7. Both are read now; the tests' fake nodes use koilib's real encoding. Prepared transactions now default to a 1 mana limit (admin calls use under 0.1; the node holds the whole limit while a transaction waits). | Full rehearsal on testnet with a 2-of-3 test multisig (`1JvWfpzUmoUg22ja5JHnUAL5Y8qqP3gWa7`) as Stories admin: accept_admin (0.09 mana), pause refused with one signature ("has not authorized transaction") and sent with two, unpause, set_signers, handover back |
| Multisig files name their signers (25 Oct 2026) | When the acting account is a multisig, `--prepare` (and the admin page) write its public signer list and threshold into the file (`needs`). `cosign` refuses a key that isn't one of them; `submit` refuses a file with too few of them and leaves out any other signature. A guide only: the chain's multisig still decides. Found when a contract key was pasted at a signer prompt. | `deploy.audit-2026-10.test.js` (needs); live on testnet: the admin key refused at cosign, one signature refused at submit, two sent |
