# 2026-10 mainnet audit: status of every finding

Audit: "SwarmTales Mainnet Audit — audit-2026-10 (16de9dc)". Fixes on branch `audit-2026-10-fixes`.
Status: **Fixed** (code changed and tested), **Doc** (documented, no code change needed),
**Owner** (an action only the owner can take), **Live** (a check on a real network).

Tests after the fixes: Ink 53, Shop 98, Stories 417, website 162, copy checker 105, deploy tool 115; 0 failing.
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
