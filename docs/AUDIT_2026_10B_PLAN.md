# Re-audit of main 98230a7: findings, verification and fix plan

Source: "SwarmTales Re-audit — main 98230a7 (fixes + sponsor, multisig, Poem, tokens)",
https://claude.ai/artifact/UJcCWwL7U6eHADz2UuJWqn. Line numbers below are at 98230a7.

The re-audit found 3 High, 4 Medium, 22 Low and 22 Info issues, and no Critical. The five
release hashes in AUDIT_SCOPE.md reproduce exactly. Every finding below was checked against
the code at 98230a7 (status column). Nothing has been fixed yet.

Fixing H-1, M-A, M-D, L-1, L-2, L-4, L-5, L-16 changes the code of four contracts
(Multisig, Sponsor, Shop, Stories); Ink is unchanged. Their release hashes change, so the
owner re-uploads them on testnet, re-runs the multisig rehearsal, and the auditor does a
short follow-up review. No one uploads anything to mainnet as part of this work.

## High and Medium

### H-1 (High): the multisig doesn't check who is asking. Confirmed.
- Where: `multisig/assembly/Multisig.ts` authorize (35-46, ignores `args.call`), set_signers
  (69-75, no caller check); `deploy/deploy.js` prepareTx (~561, 598: any `--payer`), cmdSubmit (~668-678).
- Problem: once enough signer signatures are on a transaction, the multisig says yes to any
  request, including one made by contract code running inside that transaction. A contract
  wallet named as `--payer` runs its authorize before the operations, with all signatures
  present, and can call `multisig.set_signers` (taking over the admin role of Ink, Shop and
  Stories) or move the multisig's KOIN. Every signer still sees an honest summary.
- Fix:
  - authorize: for `contract_call`, return true only when `args.call` is present and
    `args.call.caller` is empty (the asking contract was called straight from the
    transaction). transaction_application and contract_upload keep the signature count.
  - set_signers: `System.require` that `System.getCaller().caller` is empty.
  - Tool: in prepareTx (and again in submit), when the acting account is a multisig, refuse
    a `--payer` that is a contract wallet other than the multisig itself.
- Verified against koinos-chain `src/koinos/chain/system_calls.cpp` check_authority: for
  contract_call the chain sets `call.contract_id` = the contract asking, `call.caller` = that
  contract's caller (empty when called from the transaction).
- Tests: authorize with `call.caller` = some contract returns false; a nested set_signers
  call reverts; the tool refuses a contract `--payer` other than the multisig.

### H-2 (High): cosign can be shown a fake operation list. Confirmed.
- Where: `deploy/lib.js` preparedSummary (1422-1428), verifyPrepared (1366-1420, never checks
  `command` and `prepared_at`); `deploy/deploy.js` cmdCosign (606-631).
- Problem: terminal escape codes in those two text fields can hide the real operations and
  draw fake ones.
- Fix: accept only known command names and a strict ISO date in verifyPrepared; strip control
  characters from every string taken from the file before printing; print a terminal reset
  before the operations; repeat the target contract and method at the SIGN prompt.
- Tests: each free-text field holding an ESC character is refused; the printed summary has no
  control characters.

### H-3 (High): a payment token's code can change after the 7-day wait. Confirmed.
- Where: `shop/assembly/Shop.ts` set_asset (534-552), requireEnabledAsset (1045-1049),
  takePayment (838-858), readBalance (895-902).
- Problem: the wait protects the Shop's record of a token, not its code. Whoever holds a
  listed token's upload key can give it new code, which runs inside every buyer's signed
  purchase (KOIN accepts the buyer's signature at any call depth).
- Fix (off-chain): pin each accepted token (address, decimals, symbol, code hash) in
  `web/src/config.js` and in the deploy tool. The site reads each token's code hash
  (contract_meta_store.get_contract_meta) and refuses to show or use a token whose hash
  differs from its pin; mainnet shows only pinned tokens. The tool refuses set-asset for an
  address with no contract, and for a token whose code hash differs from its pin.
  `ADMIN_POWERS.md` names the issuer trust. Owner: launch with one token.
- Tests: site refuses a token whose hash differs; tool refuses an address with no code.

### M-A (Medium): the sponsor can be switched off for a day for free. Confirmed.
- Where: `sponsor/assembly/Sponsor.ts` authorize (69-101), checkOperation (158-172); default
  caps 4/20/300 mana at `web/src/pages/admin.js` (~601-603).
- Problem: throwaway wallets (free) can use the whole daily cap with reverting or useless
  calls; ~75 transactions from 15 wallets at the defaults. New users without KOIN are then
  shut out until 00:00 UTC.
- Fix (decision 1): an allow-list of sponsored entry points (new optional config field,
  contract + entry point pairs; the tool and page fill a default list of what new users need);
  default per-transaction cap about 1 mana; a free GitHub Actions alert on get_total_usage.
- Tests: a non-listed entry point is refused; the default per-transaction cap is about 1 mana.

### M-B (Medium): the checker's key job trusts the key-less job. Confirmed.
- Where: `checker/apply.mjs` check (74, 89-90: trusts `afterRestore`, `published`,
  `sourceKind`, `src`, note text), main (111-121: re-seals the plan job's progress as-is),
  header comment (7-18) overclaims.
- Fix (decision 2): recompute the restored-part protection from the chain plus apply's own
  last sealed state; get the book date in apply itself (or stop automatic book-copy hides);
  build notes in apply from fields it can check; seal only state apply derived. Correct the
  header comment.
- Test: check() with a hide for a clean live part with sourceKind "book", published "1900",
  afterRestore true is refused; apply's sealed state equals what apply recomputed.

### M-C (Medium): large amounts wrap around. Confirmed.
- Where: `web/src/lib/admin.js` toBaseUnits (69-76), ratePrice (197-206), whole (50-60),
  planAny (401-414); `deploy/lib.js` parseTokenAmount (1081-1088), planPrices (1096-1120).
- Problem: values above 2^64-1 are signed wrapped (an 18-decimal "20" signs as ~1.55).
- Fix: refuse any base-unit value above 18446744073709551615 in every helper (and in planAny's
  uint64 fields); summaries show the value decoded back from the encoded operation.
- Tests: 18446744073709551616 is refused by toBaseUnits, ratePrice, whole, planAny and
  parseTokenAmount/planPrices.

### M-D (Medium): "Turn off" on the admin page reverts. Confirmed.
- Where: `web/src/lib/admin.js` planAsset (184: sends symbol ""); `shop/assembly/Shop.ts`
  set_asset (526-528: checks the symbol before `enabled`).
- Fix: in the contract, skip the symbol and decimals checks when disabling (keep the stored
  values); the page also sends the stored values, as the tool does.
- Tests: as-pect test set_asset({enabled:false, decimals:0, symbol:""}) on an enabled token
  passes; a page-to-contract test runs planAsset's exact arguments.

## Low

| ID | Where | Status | Fix |
|---|---|---|---|
| L-1 | Stories.ts set_citation 1231-1234 | Confirmed, partly false positive | A writer removed from a private story (requireMember) can't set a citation. Citations on hidden parts stay allowed: that is the writer's appeal against a checker hide (AB-067, checker/lib.mjs:518). |
| L-2 | Stories.ts open_story 362-366 | Confirmed | Require the opening text's cost <= max_chars. |
| L-3 | StoriesAdmin.ts takedown_segment 131-132 | Confirmed | Runbook (ADMIN_POWERS.md, OWNER_STEPS) and the tool's takedown message: hide the part with the moderator key first; hidden parts can't be edited. |
| L-4 | Shop.ts takePayment 825-829 | Confirmed | price*fee_bps overflows for 16-18 decimal tokens. Compute floor(p*f/D) as (p/D)*f + (p%D)*f/D (exact). |
| L-5 | Shop.ts set_asset 535-538 | Confirmed | New admin method remove_asset for a disabled record (adds to the interface: flag it). |
| L-6 | docs/ADMIN_POWERS.md:51; Shop.ts:34-36 | Confirmed | Say "for an honest token" and name the issuer as a trust assumption. |
| L-7 | deploy/lib.js NONCE_TAGS 1300, nonceNumber 1302-1317 | Confirmed | Accept only 0x28 (koilib's real encoding); fix the comment. |
| L-8 | deploy/lib.js MAINNET_PINNED 15-22, checkPinned 800-824 | Confirmed | token becomes a list; the override flag names the role (e.g. --i-understand-this-address-is-not-pinned=shop); check sponsor-config --tokens and --admin against the pins (--admin against the pinned multisig). |
| L-9 | deploy/lib.js planAsset 978-1006 | Confirmed | Read decimals and symbol from the token and refuse a mismatch with the flags. |
| L-10 | deploy/lib.js planInkAmounts 1122-1136, planModeration 931-938 (and stories-limits) | Confirmed | At submit, re-read the config and show "was -> will be" for each field. |
| L-11 | deploy.js prepareTx 600-601, cmdSubmit 681-690; web admin.js 121,144 | Confirmed | At submit, re-read the payer's (or payee's) next nonce and refuse a file whose nonce is not it; document how to cancel (send any transaction from that account). |
| L-12 | checker/chain.mjs 15-24; copy-checker.yml 146 | Confirmed | Decision 4. |
| L-13 | Sponsor.ts checkOperation | Confirmed | Document; keep the per-transaction cap low (M-A). |
| L-14 | Chain behaviour with Sponsor.ts 86-101 | Confirmed | Document; keep KOIN well above the cap; the site's fallback (L-20) covers it. |
| L-15 | Sponsor.ts 58-103 | FALSE POSITIVE | koinos-chain's call thunk refuses any call to the authorize entry point that does not come from kernel mode ("authorize should only be called from kernel mode", system_calls.cpp call thunk). No change; note it in the status doc. |
| L-16 | Multisig.ts set_signers 69-75, validate 87-99 | Confirmed | Decision 3: each new signer must sign set_signers; refuse threshold = number of signers. |
| L-17 | Sponsor.ts 118-122; web pages/admin.js 590-614 | Confirmed | Admin page shows sponsor settings read-only plus the exact sponsor-config command; set_config also requires System.getCaller().caller empty; fix ADMIN_POWERS.md:17. |
| L-18 | web chain.js loadPaymentTokens 156-175; app/payment.js checkPayment 122-132 | Confirmed | Covered by H-3's pinned token list. |
| L-19 | web config.js selectPaymentToken 95-100; app/data.js switchPaymentToken 12-27 | Confirmed | Clear prices on switch; refuse to encode a purchase when the overview's token differs from the selected one. |
| L-20 | web lib/sponsor.js isSponsorRefusal ~97; wallet.js signAndSend ~129-137 (testWallet.js too) | Confirmed | Before falling back, check the sponsored transaction id is unknown to the node; tell the user why a second Kondor window opens. |
| L-21 | web pages/admin.js anySection 626-650; app/shell.js 46,127,240 | Confirmed | List only admin-gated methods; hide controls unless a wallet that is an admin (or a signer of the admin multisig) is connected. |
| L-22 | web lib/vaultApi.js authedCall 218-236 | Confirmed | Decision 5: fall back to GET only on an explicit 404, 405, 415 or 501. |

## Info

| ID | Item | Plan |
|---|---|---|
| I-1 | An old caller omitting starter_poem resets it to 0 (fails closed) | Document; no code change. |
| I-2 | Two tokens can share a display symbol | Tool and page refuse a symbol already used by another token. |
| I-3 | Stale comment stories.proto:326 (pay_close_fee is gone) | Fix the comment. |
| I-4 | Mempool watcher can post a pending part's text first (F-03) | Document. |
| I-5 | Proto and design-doc drift: set_blocked, set_citation ("source note"), Poem kind and slack | Fix proto descriptions and STORIES_DESIGN.md. |
| I-6 | Poem refrains and short lines refused by F-03 and the 20-char minimum | Document (Poem help text and design doc). |
| I-7 | Nothing bounds starter_poem against the Poem price | Tool and page warn when the starter Ink is worth more than the Poem price. |
| I-8 | Invite expiry runs during a pause | Document. |
| I-9 | A multisig admin needs the quorum for each of a Book's 50+ final-edit batches | Document in ADMIN_POWERS.md / OWNER_STEPS. |
| I-10 | cosign/submit drop a payee signature when needs is set | Keep the payee's signature too. |
| I-11 | --network __proto__ | Use own-property lookup for NETWORKS. |
| I-12 | Deploy tool comments contradict each other (e.g. the nonce field comment) | Fix them. |
| I-13 | Checker: no fetch or RPC timeouts | Add timeouts. |
| I-14 | No test covers koinos.armana.io mapping to the mainnet chain id | Add the test (checker and web config). |
| I-15 | Dead `if (!publicKey) continue` in Sponsor.ts and Multisig.ts | Remove (contracts change anyway). |
| I-16 | Multisig README stale; two testnet multisig addresses both called the rehearsal wallet | 1AQb8fmugoSPDmFTdq9ytPxrBjzLeXger2 = owner's rehearsal multisig; 1JvWfpzUmoUg22ja5JHnUAL5Y8qqP3gWa7 = the developer's preflight multisig. Say so in AUDIT_SCOPE.md and the status doc; update the README. |
| I-17 | Vault address not validated (W1-04); the wait loop has no limit of its own (N-8) | Validate; add a limit. |
| I-18 | A mainnet build allows a github.io SITE.url and an empty copyrightEmail | configProblems refuses both on mainnet. |
| I-19 | Promo-link ids are read before signing in prepare mode | Document (the dry run at submit catches a taken id). |
| I-20 | The prepared needs list and nonce come from the node | Document; L-11 re-reads the nonce. |
| I-21 | The 1-mana prepared limit may be too low for multi-operation multisig transactions | Default scales with the number of operations (1 mana each, capped). |
| I-22 | No sponsor ABI for Kondor | abisFor includes the sponsor and multisig ABIs. |

## Status-doc corrections (the audit's "trust and consistency" table)

- docs/AUDIT_2026_10_STATUS.md: W1-06 and O1-09 become "Partly fixed"; drop the claim that the
  config and checker tests cover the mainnet node until I-14 adds them.
- multisig README: it does not "change what a signature authorizes" (H-1).
- docs/ADMIN_POWERS.md:51 "true only for an honest token"; :17 sponsor key not offline (L-17).
- sponsor/README.md: counts are kept on revert (never undercounted); remove "may be rolled back".
- Two testnet multisig addresses (I-16).

## Owner items (not code)

Fill deploy/release-hashes.json and MAINNET_PINNED after the follow-up review (four hashes
change); CHECKER_STATE_KEY is set (the checker's apply job passes); the domain (M-7); Kondor
and Vault launch-day checks (M-9, L-20, W1-04, W1-05, L-22); purge the old ledger in
bawcejawn/audit-bot (commit 7fd7a7b11bf9539b767ed7891918af3e5c1995e1) via GitHub Support and
remove SwarmTales specifics from its CHANGELOG.md and references/attack-playbook.md sections 8-9.

## Fix order (one commit per item: `fix(audit-<ID>): <summary>`)

1. H-1 + L-16 + I-15 (multisig)
2. H-2, the H-1 tool check, M-C (deploy tool, admin page)
3. H-3 + L-18 + I-2 (token pins)
4. M-A + L-17 + L-13 + I-22 (sponsor)
5. M-D, L-4, L-5 (Shop); L-1, L-2 (Stories)
6. L-7, L-8, L-9, L-10, L-11, L-3, I-10, I-11, I-12, I-21 (deploy tool)
7. L-19, L-20, L-21, L-22, I-17, I-18 (website)
8. M-B, L-12, I-13, I-14 (checker)
9. Remaining Infos, docs, new release hashes in AUDIT_SCOPE.md, final verification and report

## Decisions (owner)

1. M-A: (a) allow-list + ~1 mana per transaction + alert [recommended]; (b) also reserve part
   of each day for wallets that already hold Ink; (c) lower caps + alert only, no contract change.
2. M-B: (a) apply looks up the book date itself [recommended]; (b) no automatic hides for book
   matches (left for a human).
3. L-16: new signers must sign the change [recommended yes]; refuse threshold = number of
   signers [recommended yes].
4. L-12: (a) commit a hash-checked ABI file now, minimal signer later [recommended]; (b) build
   the minimal Node-built-ins signer now.
5. L-22: fix as the audit says [recommended], confirmed on launch day.
