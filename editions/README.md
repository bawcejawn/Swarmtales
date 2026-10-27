# SwarmTales Editions

Keepsake editions of **finished** books, as NFTs that wallets can show (the Koinos KCS-5 read
interface). Written for Wave 3 (October 2026); see `assembly/proto/editions.proto` for the full
rules.

| Edition | Who | Price | Can be moved |
|---|---|---|---|
| First Edition | the story's opener | free | no |
| Contributor Edition | each writer whose surviving text reaches the story's `contributor_edition_min` (at least 1) | free | no |
| Collector's Edition | any reader | fixed, per payment token (the opener may choose inside the admin's range) | yes, by its holder |

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
