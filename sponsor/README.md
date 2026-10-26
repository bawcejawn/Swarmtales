# SwarmTales mana sponsor

A small contract that lets one wallet pay the **mana** for SwarmTales transactions, so readers and
writers don't need KOIN of their own for mana. It is a stand-in until the full mana station.

It is uploaded onto a fresh wallet (the sponsor address) with **only** the "transaction
application" authority flag on. From then on, when a transaction names the sponsor as payer, the
chain asks this contract, and it says yes only when:

- the sponsor is switched on;
- the transaction is signed by the payee (the user);
- every operation is a call to Ink, Shop or Stories at an entry point on the settings' `calls`
  allow-list (what new users need; audit M-A), or a payment-token `approve` with spender = Shop
  and owner = the payee;
- the transaction's mana limit is within the per-transaction cap, and today's total for that user
  and for everyone stays within the caps (UTC days, counted by mana limit, not mana used).

A transaction signed by the sponsor wallet's own key is always paid: that is the owner changing
settings or moving KOIN out. `set_config` takes effect only when called straight from the
transaction (audit L-17), so no contract code inside a transaction the key signed can change it. Calls and code uploads are **not** overridden, so they stay with the
sponsor wallet's key, like any wallet.

The website asks the sponsor first when it would say yes, and falls back to the user's own mana
when it says no. KOIN Vault chooses its own payer, so Vault users always pay their own mana.

## Build and test

```bash
npx yarn@1.22.22 install --frozen-lockfile
npx yarn@1.22.22 build:release
npx yarn@1.22.22 test
```

Tests: 39 pass. The tests use real secp256k1 signatures from `scripts/make-test-fixtures.js`
(test-only keys derived from public labels; never fund them).

## Set it up (deploy tool, from the repository folder)

```powershell
node deploy/deploy.js upload sponsor --expect <sponsor wallet address>
node deploy/deploy.js sponsor-config --sponsor <sponsor> --ink <ink> --shop <shop> --stories <stories> --tokens <payment token> --per-tx 1 --per-account 20 --per-day 300
node deploy/deploy.js status --sponsor <sponsor>
```

`sponsor-config` always writes the allow-list of sponsored calls from `deploy/lib.js`
(`SPONSORED_CALLS`: `shop.buy_membership`, `buy_pack`, `claim_writer_ink`, `claim_promo`;
`stories.open_story`, `contribute`, `edit_segment`, `remove_segment`, `join_with_invite`,
`set_reading_place`), and the caps default to 1 / 20 / 300 mana. Changing that list is a reviewed
change to `deploy/lib.js`. The website's admin page shows the settings and the exact
`sponsor-config` command; it never asks a wallet for the sponsor key.

Then put the sponsor address in `web/src/config.js` (`sponsor`). Switch it off with
`sponsor-config ... --disable`; move KOIN out with the sponsor wallet in Kondor, like any wallet.

Sizing: the largest part (6,000 CJK characters) uses about 1.8 mana; a bookmark or a purchase
under 0.2. The site asks for about 0.8 mana plus 0.00015 per byte, so a per-transaction cap of 1
covers every action except parts over about 1,300 bytes, which users then pay with their own mana.
A low cap keeps each throwaway transaction cheap for the sponsor (audit M-A). The sponsor's mana is its KOIN balance and refills over about five days; while
a transaction waits for a block, the node holds its mana limit, so a busy sponsor needs headroom.

## Limits to know

- Daily caps count each transaction's mana *limit* when it is applied. The chain runs the payer's
  authorize before the operations and keeps its writes even when an operation then reverts, so a
  reverted transaction still counts at its full limit: the count is never too low, only higher
  than the mana really used.
- Anyone can make new wallets, so a determined spammer can still use up the day's budget
  (`--per-day`) with listed actions. After that everyone pays their own mana until the next UTC
  day. Nothing else is at risk: the sponsor never signs or moves anything for users. On mainnet,
  the hourly `.github/workflows/sponsor-alert.yml` fails (GitHub emails the owner) when the day's
  use passes 80% of the cap, or the sponsor's mana falls below 5 times the cap.
- Sponsored mana can pay for other code inside a sponsored transaction: a contract wallet's own
  authorize, or a listed payment token's code (audit L-13). The per-transaction cap bounds it.
- The node does not count sponsored transactions still waiting for a block, so a burst can hold
  the sponsor's free mana for about two minutes (audit L-14). Keep its KOIN well above 5 times the
  daily cap; the website retries with the user's own mana when the sponsor refuses.
