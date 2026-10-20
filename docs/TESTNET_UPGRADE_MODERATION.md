# Testnet upgrade: moderation, 10,000-character parts, writing between parts (Windows PowerShell)

This replaces **only the Stories contract**. Your Ink and Shop contracts from the 19 October
rehearsal stay as they are, so memberships, Ink balances and the Shop keep working. The old
Stories contract is retired in the same step: the Shop moves to the new one, and the old one
loses its right to burn or mint Ink.

Stories written in the old contract stay readable on the chain, but the website will show
the new contract's stories only (it's the testnet, so that's expected).

Every step was run end to end on 20 October 2026 with throwaway wallets before this guide
was written. The mana numbers are what those runs used. You sign everything yourself; the
script never saves or prints a key, and nothing is sent until you type `SEND`.

---

## Step 0. One new wallet, and some tKOIN

In Kondor (testnet), create **one new wallet** named `ST-Stories-v3`. On Koinos the wallet
that uploads a contract becomes the contract's address.

From your admin wallet (`18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`), send **15 tKOIN** to
`ST-Stories-v3` (the upload uses about 10.7 mana).

If Kondor's Send screen loops on "Refresh check", use the site's test wallet instead, or send
from the deploy tool; tell me and I'll give you that command.

## Step 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout feat/moderation
git pull
cd stories
npx.cmd yarn@1.22.22 install
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..
```

**Expect:** four Stories test summaries that add up to **128 pass**, 0 fail.

### Check you built the exact bytes that were tested

```powershell
Get-FileHash stories\build\release\contract.wasm
```

**Expect:**

```
5114F89A9A64290F887221954B71DC53A191D41764EB9DB0481BB6958903E502
```

If it differs, stop and send me the output.

## Step 2. Addresses

```powershell
$ADMIN       = "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6"
$INK         = "1EbuyYK1kso7GbZamHCU2LRhXaEyePkXpf"
$SHOP        = "14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD"
$OLD_STORIES = "15YAvNkBACg7PpiEkCYVN95fnajbp1EkwZ"
$STORIES     = "PASTE-ST-Stories-v3-ADDRESS"
```

## Step 3. Upload Stories and hand it to the admin

```powershell
node deploy/deploy.js upload stories --expect $STORIES                       # key: ST-Stories-v3
node deploy/deploy.js set-admin stories --contract $STORIES --admin $ADMIN   # key: ST-Stories-v3
```

If the second command says the wallet's mana **is held for a recent transaction**, that's the
node keeping the upload's mana aside for about a minute. Wait a minute and run it again.

## Step 4. Wire it in and retire the old Stories (admin key)

```powershell
node deploy/deploy.js wire-stories --admin $ADMIN --ink $INK --shop $SHOP --stories $STORIES --replace-stories $OLD_STORIES
```

**Expect** the line `Retiring the old Stories contract 15YAvN…: its Ink burn and mint rights are
removed`, then a dry run of about 0.47 mana. One transaction does all of it, including the 11
categories.

## Step 5. Publish the Terms of Use, version 1 (admin key)

```powershell
node deploy/deploy.js set-terms --admin $ADMIN --stories $STORIES --version 1 --file web/public/terms/v1.md --uri https://bawcejawn.github.io/Swarmtales/terms/v1.md
```

**Expect:** `sha256 9950e8fdbd40005b7cd42cffe3e80703704a00a7169983234a559e28423ae369`. The Terms
page on the site checks its text against this fingerprint.

## Step 6. The moderator key for the copy checker

```powershell
node deploy/deploy.js new-moderator-key
```

It prints a **moderator address** and a **private key**, once. Then:

1. In GitHub, open https://github.com/bawcejawn/Swarmtales/settings/secrets/actions
2. **Secrets** tab → **New repository secret** → Name `MODERATOR_WIF`, Secret: the private key → **Add secret**.
3. **Variables** tab → **New repository variable** → Name `STORIES_ADDRESS`, Value: your new `$STORIES` address → **Add variable**.
4. Clear the PowerShell window (`cls`). Don't paste the key anywhere else.
5. From your admin wallet, send the **moderator address** **3 tKOIN** (its mana pays for hiding parts; hiding uses about 0.05).

Then tell Stories who the moderator is (admin key):

```powershell
$MODERATOR = "PASTE-MODERATOR-ADDRESS"
node deploy/deploy.js set-moderation --admin $ADMIN --stories $STORIES --moderator $MODERATOR --threshold 3 --strikes 3
```

## Step 7. Check

```powershell
node deploy/deploy.js status --ink $INK --shop $SHOP --admin $ADMIN --stories $STORIES
```

**Expect** in `stories.get_config`: `"contribution_cap":10000`, `"terms_version":1`,
`"moderator":"<your moderator address>"`, `"report_threshold":3`, `"strike_limit":3`.
**Expect** `ink burner flag for Stories (want true): {"value":true}` and
`shop points at Stories (want <new>)` showing the new address.

**Send me:** the new Stories address and the moderator address. I'll point the website at
them, and you merge that PR.

## Step 8. Try it on the website (after that PR is merged)

1. Connect the test wallet (it already has a Writer month and Ink from the old setup; both live
   in the Shop and Ink contracts, which didn't change).
2. **Open a story:** the form now requires "I wrote this myself…".
3. **Write:** up to 10,000 characters per part. Longer text is split into parts with one
   confirmation (up to 30,000 characters at once).
4. **"+ Add text here"** under any part: your text appears right below it.
5. **Edit / Remove** (you're the opener): edit a part lightly, remove one.
6. **Listen:** reads the story aloud. "Listen from here" starts at any part.
7. **Report** a part from a second wallet.
8. **Membership:** Ink packs (Small, Medium, Large) for active Writers.
9. **Copy checker:** on GitHub, open **Actions → Copy checker → Run workflow**. Its summary lists
   anything it hid. After that it runs every hour by itself.

## Optional: search books and the web for copied text (free)

Brave dropped its free plan in 2026, so the checker now works with free services instead.
See `docs/COPY_CHECKER_SEARCH.md`: Google Books (searches inside books) and Tavily (web).
Both are free with no card. Without any key, the checker compares with everything on
SwarmTales only.
