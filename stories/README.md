# SwarmTales Stories

This folder is the Stories contract: the books and short stories themselves. It is where Ink is **spent**. Ink lives in the parent folder and Shop in `../shop`. The full design, with Carl's decisions, is in `../docs/STORIES_DESIGN.md`.

**Unaudited. Not uploaded to testnet or mainnet yet.**

From this folder:

```bash
yarn install
yarn build:release
yarn test
```

On Windows PowerShell use `npx.cmd yarn@1.22.22 install --frozen-lockfile`, then `npx.cmd yarn@1.22.22 build:release`, then `npx.cmd yarn@1.22.22 test`, one line at a time. Build before testing: the tests import generated files. Success means `build/release/contract.wasm` exists and the test report ends with **61 pass** and **0 fail**. The tests run in a mock chain and do not need tokens.

## What it does

- **Open** a Book (100,000 to 1,000,000 characters) or a Short Story (10,000 to 99,999). Shop takes the open fee and mints the starter Ink; the opening text is then paid in Ink. All in one transaction.
- **Write.** Each submission burns exactly its cost from the writer: 1 Ink per UTF-16 code unit. Most emoji cost 2, ⭐ costs 1, 👍🏽 and 🇺🇸 cost 4, 👨‍👩‍👧 costs 8. The website sends `expected_ink`; any mismatch is refused before Ink moves. A submission is at most 2,000 to start (admin-adjustable, 100 to 4,000).
- **Who may write:** the opener and up to 10 editors; an active Writer (read from Shop); or a promo-claimed wallet for a 1,000-character lifetime trial. Private stories also need the allow-list, which the opener or an editor fills directly or through invite codes (use limit plus expiry, only the hash is stored).
- **Edit and remove your own part** (while open). Rewording is free; letters beyond the part's current length cost 1 Ink each, paid by the writer (a private story's pool pays only for new parts). Shortening is always allowed and refunds the cut Ink to whoever paid it (writer or pool), but once someone else changed the part a cut refunds nothing, because the contract cannot tell whose letters were cut; removing the part still refunds what the writer paid. Refunds are Ink mint reason REFUND.
- **Change someone else's part** with `revise_part`: `max(10, letters added + removed) × 2`, doubling with each paid change (at most 60), always paid by the changer. A writer never uses it on their own part. Every change to a part's text is kept as a version naming who made it (at most 100 per part); a takedown wipes them all.
- **Close** (opener pays the close fee, also when the story auto-filled), the **final edit** in ordered batches, and **finalize** with a PDF link and hash. The admin can take over if the opener asks or has been inactive for 30 days (no fee).
- **Archive** after 60 quiet days (anyone can call it); one free revive. At most 3 open projects per opener.

## Safety rules in the code

- Every admin action uses `requireAdmin`. Until `set_admin`, the contract's own address is the admin.
- Every call to Ink or Shop must exit with code 0 **and** must not answer `false`. Otherwise the whole transaction is undone.
- Burns use reason 1 (`BURN_CONTRIBUTION`) only. Refund mints use reason 5 only; Ink should give Stories mask **32** and nothing else.
- State is written before any outside call, and a reentrancy lock is held for the whole call.
- No sponsor or Mana-paying code. Sponsorship, if wanted, is a separate later contract, OFF by default.

## Wiring

See `../docs/TESTNET_DEPLOY.md`, Step 13. In short: `upload stories`, `set-admin stories`, then `wire-stories`, which reads Shop's treasury and founder from the chain and sends them back unchanged (`shop.set_addresses` replaces all four addresses).
