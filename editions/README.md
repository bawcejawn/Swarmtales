# SwarmTales Editions

Keepsake editions of **finished** books, as NFTs that wallets can show (the Koinos KCS-5 read
interface). Written for Wave 3 (October 2026); see `assembly/proto/editions.proto` for the full
rules.

| Edition | Who | Price | Can be moved |
|---|---|---|---|
| First Edition | the story's opener | free | no |
| Contributor Edition | each writer whose surviving text reaches the story's `contributor_edition_min` (at least 1) | free | no |
| Collector's Edition | any reader | fixed, per payment token (the opener may choose inside the admin's range) | yes: its holder sends it to another wallet (a gift or a private sale). Marketplaces aren't supported (no approvals) |

**A sale** moves the price from the buyer inside the buyer's own transaction: `platform_bps`
(20% at launch, never above 30%) to the treasury, the rest to this contract for the book's writers.
The contract checks the balances before and after, as Shop does.

**Writers' earnings** from a book in a token are `received × their surviving ÷ the book's
surviving_sum` (both read from Stories), minus what they were already paid, and never more than
the book's pot still holds. Anyone may call `claim_earnings` for a writer; the tokens always go to
that writer. It works while paused. There is no admin withdraw and no authority override: the
contract moves its own tokens only through the token's rule that a contract may move what it
holds (KCS-4: "the contract caller is the owner"). **Check that rule on testnet with a small
claim for every payment token before turning it on for editions.**

**Not offered:** approvals and operators, royalties, auctions, random rarity. Collectibles are
keepsakes, not investments, and give no copyright in the book (Terms of Use §13).

**Payment tokens** must be on in Shop and past Shop's 7-day wait, and on here with a price range
(`set_payment_token`). Stories and Shop addresses are set once.

Build and test:

```
yarn install --frozen-lockfile
yarn build:release
npx asp --file=Editions
```

## Notes for review

- **Only books whose whole final edit ran on the Wave 3 Stories code are sold** (`story.sum_tracked`,
  set when the final edit starts with nothing processed yet). A book finished earlier, or one in the
  middle of its final edit when Stories is upgraded, never sells, so `surviving_sum` always matches
  the writers' totals for a book on sale. If the two reads ever disagree (a writer's total above the
  sum), that writer is owed nothing until they agree.
- **Claims stop while a book waits for republishing after a takedown** (`needs_new_pdf`), so a
  takedown under way can't be raced. A writer who collected before a later takedown keeps what they
  collected; the book's pot can never pay out more than it received.
- **No sweep.** Money nobody can claim (rounding dust, a book whose every part was later taken down,
  tokens sent straight to the contract) stays in the contract. This is deliberate: there is no path
  by which anyone but a writer receives the writers' money.
- **Payment tokens** turned off leave `payment_tokens` (their pots stay claimable), so the list of
  four never fills up for good.
- **Errors on chain:** a failing call into Stories, Shop or a token reverts the whole transaction
  with that contract's own message, so the `res.code` checks here only matter in the mock VM.
- **Code uploads:** "set once" covers stored addresses, not code. Each contract key (Editions,
  Stories, Shop, the token's issuer) can replace its own code; see docs/ADMIN_POWERS.md and
  docs/KEY_CUSTODY.md.
