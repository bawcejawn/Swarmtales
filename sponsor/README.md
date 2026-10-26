# SwarmTales mana sponsor

A small contract that lets one wallet pay the **mana** for SwarmTales transactions, so readers and
writers don't need KOIN of their own for mana. It is a stand-in until the full mana station.

It is uploaded onto a fresh wallet (the sponsor address) with **only** the "transaction
application" authority flag on. From then on, when a transaction names the sponsor as payer, the
chain asks this contract, and it says yes only when:

- the sponsor is switched on;
- the transaction is signed by the payee (the user);
- every operation calls Ink, Shop or Stories, or is a payment-token `approve` with spender = Shop
  and owner = the payee;
- the transaction's mana limit is within the per-transaction cap, and today's total for that user
  and for everyone stays within the caps (UTC days, counted by mana limit, not mana used).

A transaction signed by the sponsor wallet's own key is always paid: that is the owner changing
settings or moving KOIN out. Calls and code uploads are **not** overridden, so they stay with the
sponsor wallet's key, like any wallet.

The website asks the sponsor first when it would say yes, and falls back to the user's own mana
when it says no. KOIN Vault chooses its own payer, so Vault users always pay their own mana.

## Build and test

```bash
npx yarn@1.22.22 install --frozen-lockfile
npx yarn@1.22.22 build:release
npx yarn@1.22.22 test
```

Tests: 33 pass. The tests use real secp256k1 signatures from `scripts/make-test-fixtures.js`
(test-only keys derived from public labels; never fund them).

## Set it up (deploy tool, from the repository folder)

```powershell
node deploy/deploy.js upload sponsor --expect <sponsor wallet address>
node deploy/deploy.js sponsor-config --sponsor <sponsor> --ink <ink> --shop <shop> --stories <stories> --tokens <payment token> --per-tx 4 --per-account 20 --per-day 300
node deploy/deploy.js status --sponsor <sponsor>
```

Then put the sponsor address in `web/src/config.js` (`sponsor`). Switch it off with
`sponsor-config ... --disable`; move KOIN out with the sponsor wallet in Kondor, like any wallet.

Sizing: the largest part (6,000 CJK characters) uses about 1.8 mana; a bookmark or a purchase
under 0.2. The site asks for about 0.8 mana plus 0.00015 per byte, so a per-transaction cap of 4
covers every action. The sponsor's mana is its KOIN balance and refills over about five days; while
a transaction waits for a block, the node holds its mana limit, so a busy sponsor needs headroom.

## Limits to know

- Daily caps count each transaction's mana *limit* when it is applied; a reverted transaction's
  count may be rolled back with it, so the caps bound spending per day but are not exact.
- Anyone can make new wallets, so a determined spammer can use up the day's budget (`--per-day`).
  After that everyone pays their own mana until the next UTC day. Nothing else is at risk: the
  sponsor never signs or moves anything for users.
