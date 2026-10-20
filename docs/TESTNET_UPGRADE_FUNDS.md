# Testnet upgrade: writers' pools, gifted Writer months, open-ended stories (Windows PowerShell)

This upgrade **replaces the code of your existing Shop and Stories contracts at the same addresses**.
Everything stored in them stays: your stories 1–3, memberships, prices, Ink packs, the
moderator, the Terms. There are no new wallets, no new addresses, and no wiring. The
website keeps the addresses it already has.

Every step below was run end to end on 20 October 2026 with throwaway testnet wallets
before this guide was written. The mana numbers are what those runs used. You sign
everything yourself. The script never saves or prints a key, and nothing is sent until you
type `SEND`.

**Order matters:** do Steps 1–5 first, then merge the website pull request (Step 6). The new
website talks to the new contract code.

## What changes

- **"Unlisted" and "Private" are merged into one option: Private.** A private story isn't
  listed in Discover, and only the opener, editors, and invited wallets can write in it. Your
  existing unlisted story 2 now shows as Private and works the same way.
- **Writers' pool.** Opening a private story requires Ink for the pool: at
  least 10,000 for a short story, or 100,000 for a book. While the pool has enough Ink,
  everyone's parts are paid from it. After that, writers pay with their own Ink.
  - The opener can add more Ink to the pool at any time.
  - Refunds for shortened or removed parts go back into the pool.
  - Whatever is left returns to the opener when the story is finished or archived.
- **Writer month.** Everyone except the opener needs an active Writer month to write in an
  private story. Editors need one too, and trials don't count. The opener can
  pay for someone's month from the story's Share & invite panel: the month and its Ink go
  to that person.
- **No fixed length.** New stories can be closed once they reach 10,000 characters (a book:
  100,000). A short story can grow to 99,999 characters, and a book to 1,000,000.
- **Open price.** Your first 3 open projects cost the normal price. The 4th costs 2× and the
  5th costs 4×. Every one after that stays at 4×, up to 10 open projects.
  - You can change both numbers later with `stories-limits`.
  - Finishing or archiving a story frees its slot.
- **"edited" note.** It's now a small "edited" link under the part. Tap it to see who
  edited the part and when.

**Your existing stories 2 and 3 have no pool.** They become invite-only,
and writers pay with their own Ink until you add Ink to the pool on the story's page.

---

## Step 0. A little tKOIN on the two contract wallets

Uploading code uses mana from the contract's own wallet. The test run used **1.0 mana for
Shop** and **2.3 mana for Stories**.

In Kondor (testnet), check the balances of:

- `ST-Shop-v2` (address `14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD`)
- `ST-Stories-v3` (address `1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ`)

If either has less than **5 tKOIN**, send it 5 tKOIN from your admin wallet
(`18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`).

## Step 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout feat/story-funds
git pull
cd shop
npx.cmd yarn@1.22.22 install
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..\stories
npx.cmd yarn@1.22.22 install
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..
```

**Expect:**

- Shop: **68 pass**, 0 fail.
- Stories: five test summaries that add up to **141 pass**, 0 fail.

### Check you built the exact bytes that were tested

```powershell
Get-FileHash shop\build\release\contract.wasm
Get-FileHash stories\build\release\contract.wasm
```

**Expect:**

```
B8B3BACF5CF1C0A82199AE28B3C328998B6696AB1DDEF08B35708D02D870C5E4   (shop)
E202E7AB46E71BDD13491249491211CCBBBADA243912238AA9FA1BB993D51524   (stories)
```

If either one differs, stop and send me the output.

## Step 2. Addresses

```powershell
$ADMIN   = "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6"
$INK     = "1EbuyYK1kso7GbZamHCU2LRhXaEyePkXpf"
$SHOP    = "14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD"
$STORIES = "1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ"
```

## Step 3. Upgrade the Shop (key: `ST-Shop-v2`)

```powershell
node deploy/deploy.js upload shop --expect $SHOP --upgrade
```

At the hidden prompt, paste the **ST-Shop-v2** private key, the same way you did for its
first upload. Nothing shows while you paste.

**Expect:**

- `UPGRADE (testnet): the code at 14zbNP… will be replaced. Its stored data is kept.`
- A dry run of about **1.0 mana**.
- Type `SEND`.

Then send me the transaction id.

## Step 4. Upgrade Stories (key: `ST-Stories-v3`)

```powershell
node deploy/deploy.js upload stories --expect $STORIES --upgrade
```

Paste the **ST-Stories-v3** private key.

**Expect** the same `UPGRADE (testnet)` line and a dry run of about **2.3 mana**. Type `SEND`.

## Step 5. Turn on the new open-project rules (key: your admin wallet)

The contract still holds your old limit of 3 open projects. This raises it to 10. The first
3 projects stay at the normal price, and the price stops doubling at 4×.

```powershell
node deploy/deploy.js stories-limits --admin $ADMIN --stories $STORIES --open-limit 10 --full-price 3 --price-ceiling 4
```

**Expect** `"open_limit":10,"full_price_projects":3,"max_price_multiplier":4` in the summary
line, about **0.05 mana**. Type `SEND`.

### Check

```powershell
node deploy/deploy.js status --ink $INK --shop $SHOP --admin $ADMIN --stories $STORIES --story 3
```

**Expect:**

- `stories.get_config` shows `"open_limit":10`, `"full_price_projects":3` and
  `"max_price_multiplier":4`.
- Your `"terms_version":2` and `"moderator":"112LsjvgYPLDw5xep3P2Yi2TSThxebaekU"` are still there.
- `story 3:` still shows your private book, now with `"fund":"0"`.

## Step 6. Merge the website pull request

Open the pull request link I send you → **Merge pull request** → **Confirm merge**. The
site updates on its own in about two minutes.

## Step 7. Try it on the website

1. **Open a private short story.**
   - Choose **Private: not listed, invited writers only**. A **Writers' pool** box appears,
     set to 10,000 Ink.
   - The line under the box adds up the Ink you need: the first part plus the pool. Opening
     a short story gives you 10,000 starter Ink.
   - The price card shows your price. You already have 3 open projects, so the 4th is
     **2×** the normal price.
2. **Share & invite panel** (on the story page):
   - **Writers' pool:** shows the Ink left. Add some with **Add to the pool**.
   - **Give a Writer month:** paste a second wallet's address and click
     **Pay for their Writer month**. Its month and Ink go to that wallet.
   - **Invite writers:** create an invite link for the people you want to write with.
3. **Write as an invited wallet.** The writing box says "Paid from the writers' pool". After
   you sign, that wallet's own Ink balance doesn't change, and the pool goes down.
4. **Progress:** the bar now reads, for example, "182 characters · 9,818 more until it can be
   finished". Once it reaches 10,000, the opener can close the story whenever they like.
5. **Edit a part** (as the opener). A small *edited* link appears under it. Tap it to see who
   edited it and when.
