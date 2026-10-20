# Testnet rehearsal of the security fixes (Windows PowerShell)

This deploys **fresh** copies of the fixed Ink, Shop and Stories contracts to the Koinos
Foundation testnet and walks the real user flows: open a private story → contribute →
claim a signed promo link → join with a signed invite link → write as the invited user.
It also shows the contract refusing a copied signature, a too-short text, and a write
before joining.

Every step below was run end to end on 19 October 2026 with throwaway wallets before this
guide was written. The mana numbers are what those runs used.

Testnet coins are play money. You sign every transaction yourself. The script never saves
or prints a wallet key, and nothing is sent until you type `SEND`.

> Why fresh addresses? The fixes change how the contracts store data, so they cannot be
> uploaded over the old ones. The old testnet contracts are left as they are.

---

## Step 0. Wallets

Create **three new wallets** in Kondor (set Kondor to the testnet). Name them so you can tell
them apart, for example `ST-Ink-v2`, `ST-Shop-v2`, `ST-Stories-v2`. On Koinos the wallet that
uploads a contract **becomes** that contract's address, so each contract gets its own wallet.
You will paste each one's private key (WIF) at a hidden prompt when the step asks for it.

From your admin wallet (`18MhKF…RF6`), send tKOIN with Kondor:

| Wallet | Send | Why (measured mana) |
|---|---|---|
| `ST-Ink-v2` | **10 tKOIN** | upload 3.24 + set-admin 0.04 |
| `ST-Shop-v2` | **15 tKOIN** | upload 5.74 + set-admin 0.05 |
| `ST-Stories-v2` | **25 tKOIN** | upload 8.88 + set-admin 0.05 |

Your test user (`12SVw6…15Ww`) is the story **opener**. It needs at least **2 tKOIN** (the open
price is 0.5 tKOIN plus a little mana). Your admin wallet plays the second user, **"Bob"**.

## Step 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git remote set-url origin https://github.com/bawcejawn/Swarmtales.git
git fetch origin
git checkout security/authorization-and-signed-links
git pull
```

```powershell
npx.cmd yarn@1.22.22 install
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
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

**Expect:** Ink **49 pass**, Shop **64 pass**, Stories three summaries that add up to **98 pass**, 0 fail.

### Check you built the exact bytes that were tested

```powershell
Get-FileHash build\release\contract.wasm, shop\build\release\contract.wasm, stories\build\release\contract.wasm
```

**Expect** (SHA256, in that order):

```
A4BF1E9515017D7D4B94B5F2E82446FFFE0CDEB1CFA18C1401CC470C36A8836B
D86C098F7371C7068F866607CFFFB506FB293B847B4F39B2DF7453AA2BB31783
ACB466337C9A8AFFD075AE8C84170582FC969AC29771CBC729AFBFDF2C2BCB79
```

If any line differs, stop and send the output. This is the same check anyone can later run
against the mainnet contracts ("published wasm hashes").

## Step 2. Set your addresses (fill in the three new ones)

```powershell
$ADMIN   = "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6"
$OPENER  = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww"
$INK     = "PASTE-ST-Ink-v2-ADDRESS"
$SHOP    = "PASTE-ST-Shop-v2-ADDRESS"
$STORIES = "PASTE-ST-Stories-v2-ADDRESS"
node deploy/deploy.js status --ink $INK --shop $SHOP --admin $ADMIN --user $OPENER --stories $STORIES
```

**Expect:** chain id verified, mana about 10 / 15 / 25 on the three new wallets, and the
contract lines say they are not readable yet. That is correct before uploading.

## Step 3. Upload and hand over Ink and Shop

Each command asks for one wallet's key at a hidden prompt, runs a dry run, then waits for `SEND`.

```powershell
node deploy/deploy.js upload ink --expect $INK                       # key: ST-Ink-v2
node deploy/deploy.js set-admin ink --contract $INK --admin $ADMIN    # key: ST-Ink-v2
node deploy/deploy.js upload shop --expect $SHOP                      # key: ST-Shop-v2
node deploy/deploy.js set-admin shop --contract $SHOP --admin $ADMIN  # key: ST-Shop-v2
```

## Step 4. Wire them and turn on the test payment token (admin key)

```powershell
node deploy/deploy.js wire --admin $ADMIN --ink $INK --shop $SHOP --treasury $ADMIN --founder $ADMIN
node deploy/deploy.js test-asset --admin $ADMIN --shop $SHOP
```

Treasury and founder are the same wallet here on purpose: it exercises the new
"payment must actually arrive" check on its same-wallet path.

## Step 5. Upload, hand over and wire Stories

```powershell
node deploy/deploy.js upload stories --expect $STORIES                         # key: ST-Stories-v2
node deploy/deploy.js set-admin stories --contract $STORIES --admin $ADMIN     # key: ST-Stories-v2
node deploy/deploy.js wire-stories --admin $ADMIN --ink $INK --shop $SHOP --stories $STORIES   # key: admin
```

## Step 6. The opener opens a PRIVATE story (opener key)

```powershell
node deploy/deploy.js test-open --user $OPENER --shop $SHOP --stories $STORIES --private
```

**What it proves:** the opener pays 0.5 tKOIN, and Shop checks the money really arrived (fix M1)
before minting 10,000 starter Ink. The 42-character opening line burns 42.

## Step 7. Write, and see a too-short text refused (opener key)

```powershell
node deploy/deploy.js test-write --user $OPENER --ink $INK --stories $STORIES --story 1 --size 100
node deploy/deploy.js test-write --user $OPENER --ink $INK --stories $STORIES --story 1 --text "Nineteen characters"
```

**Expect:** the first sends. The second must stop at the dry run with
`STORIES: text is shorter than the minimum`. Nothing is sent.

## Step 8. Signed promo link (admin creates, Bob claims)

```powershell
node deploy/deploy.js test-promo --admin $ADMIN --shop $SHOP
```

It prints `Campaign id: 1` and a line `Promo link key (...): <WIF>`. That key belongs to the
link, not to any wallet. Copy it:

```powershell
$PROMOKEY = "PASTE-THE-PROMO-LINK-KEY"
```

First a copied signature, which **must be refused** (Bob submits a claim signed for the opener):

```powershell
node deploy/deploy.js claim-promo --account $ADMIN --shop $SHOP --campaign 1 --link-key $PROMOKEY --sign-for $OPENER
```

**Expect:** `STOPPED: Dry run failed ... SHOP: promo link rejected`. Then the honest claim:

```powershell
node deploy/deploy.js claim-promo --account $ADMIN --shop $SHOP --campaign 1 --link-key $PROMOKEY
```

**Expect:** it sends. Bob now has 500 promo Ink and a 1,000-character trial.

## Step 9. Signed invite link (opener creates, Bob joins and writes)

```powershell
node deploy/deploy.js test-invite --opener $OPENER --stories $STORIES --story 1
```

It prints `Invite id: 1` and `Invite link key (...): <WIF>`. Copy it:

```powershell
$INVITEKEY = "PASTE-THE-INVITE-LINK-KEY"
```

Three checks as Bob (admin key). The first two **must be refused**:

```powershell
node deploy/deploy.js test-write --user $ADMIN --ink $INK --stories $STORIES --story 1 --size 50 --not-opener
node deploy/deploy.js join-invite --account $ADMIN --stories $STORIES --story 1 --invite 1 --link-key $INVITEKEY --sign-for $OPENER
```

**Expect:** `STORIES: this story is private`, then `STORIES: invite link rejected`.
Now the honest join and a write on Bob's trial:

```powershell
node deploy/deploy.js join-invite --account $ADMIN --stories $STORIES --story 1 --invite 1 --link-key $INVITEKEY
node deploy/deploy.js test-write --user $ADMIN --ink $INK --stories $STORIES --story 1 --size 100 --not-opener
```

**Expect:** both send.

## Step 10. The negative security suite (dry runs only, opener key)

```powershell
node deploy/deploy.js user-checks --user $OPENER --ink $INK --shop $SHOP --admin $ADMIN --campaign 1
```

**Expect:** 10 lines of `[PASS]` and `All checks rejected as expected.`

## Step 11. Final status

```powershell
node deploy/deploy.js status --ink $INK --shop $SHOP --admin $ADMIN --user $OPENER --stories $STORIES --story 1
```

**Expect:** `story 1` shows `"visibility":3`, `"used_chars":"242"`, `"segment_count":"3"`,
`"contributor_count":"2"`, and `stories.get_config` shows `"min_contribution":20`.

**Send back:** the output of steps 10 and 11, and any step that did not match "Expect".

## What this rehearsal does and does not cover

- **Covered on chain:** paying with a real token and the balance check (M1), direct-call
  user flows, the 20-character minimum, signed promo links (H3) and signed invite links (H2),
  including refusing a copied signature for each.
- **Covered by unit tests only:** another contract calling in a user's name (H1). The tests
  set a contract as the caller and show every action refusing it.
- **Not covered here:** key management and a third-party audit. Both stay hard requirements
  before mainnet.
