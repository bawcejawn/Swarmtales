# SwarmTales testnet deploy guide (Windows PowerShell)

This guide puts Ink and Shop on the **Koinos testnet** from your own PC.
You sign every transaction yourself. Your private keys stay on your PC:
nobody else needs them, and the script never saves or prints them.

Everything here is free. Testnet coins (tKOIN) have no value.

## What you need first

| Thing | How to check | If missing |
|---|---|---|
| Git for Windows | `git --version` prints a version | Install from https://git-scm.com/download/win (defaults are fine) |
| Node.js 22 LTS | `node -v` prints `v22.x` (v20 and v24 also work) | Install the 22 LTS from https://nodejs.org. Node 24 has been seen working for install, build, and test. |
| Four testnet wallets | You have the addresses | See "Wallets" below |

Open **PowerShell** (Start menu, type PowerShell). Every command below is typed or
pasted there, one block at a time.

> Why `npx.cmd` and not `npx`? PowerShell sometimes blocks `npx` with
> "running scripts is disabled on this system". `npx.cmd` is the same tool and is not blocked.

## Wallets

| Role | Address | Funded with | Signs |
|---|---|---|---|
| Ink contract | `195trftAvPnqeoPmHeGmxtwNYVUVdghm5x` | 50 tKOIN | Ink upload, Ink set_admin |
| Shop contract | `1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth` | 950 tKOIN | Shop upload, Shop set_admin |
| Admin (your main testnet wallet) | `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6` | 1000 tKOIN | wire, test-asset |
| Test user (a normal reader/writer) | `12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww` | 100 tKOIN | test-buy, claim-promo, user-checks |

On Koinos, the wallet that uploads a contract **becomes** the contract address. That is why
Ink and Shop each have their own wallet.

Mana is what pays for transactions. Each wallet's mana equals its tKOIN balance and
refills over about 5 days after use.

## How the script keeps you safe

`deploy/deploy.js` does this on every write:

1. Checks the network's chain id. If the node is not the testnet, it stops.
2. Asks for the private key at a **hidden prompt**. Nothing shows while you paste.
   It refuses keys on the command line, and it refuses seed phrases.
3. Works out the address from the key. If it is not the address you named, it stops
   before signing anything.
4. Runs a **dry run**: the node tests the transaction and reports the mana, but it is not
   put in a block.
5. Waits for you to type `SEND` in capitals. Anything else stops with nothing sent.
6. Sends it, then prints the **transaction id** and block number.

Mainnet is refused unless you add two separate mainnet flags. This guide never uses them.

**Pasting the key:** right-click in the PowerShell window (or Ctrl+V), then press Enter.
After each step, clear your clipboard: press Win+V and choose "Clear all".
Never paste a key into chat, email, a file, or a GitHub issue.

---

## Step 1. Get the code (folder: `C:\`)

First time:

```powershell
cd C:\
git clone https://github.com/bawcejawn/Swarmtales.git C:\swarmtales
cd C:\swarmtales
```

Already have it:

```powershell
cd C:\swarmtales
git pull
```

**Expect:** no errors. `git log -1 --oneline` shows the latest commit.
**Send back:** the line `git log -1 --oneline` prints.

All later steps run in **`C:\swarmtales`** unless a step says otherwise.

## Step 2. Install the tools (folder: `C:\swarmtales`)

```powershell
cd C:\swarmtales
npx.cmd --yes yarn@1.22.22 install --frozen-lockfile
cd shop
npx.cmd --yes yarn@1.22.22 install --frozen-lockfile
cd ..
```

`--frozen-lockfile` installs exactly the versions in `yarn.lock`, nothing newer. (This repo uses
a yarn lock file, so this is the same idea as `npm ci`.)

**Expect:** each ends with `Done in ...s`. Warnings about "unmet peer dependency" are normal.

## Step 3. Build both contracts (folder: `C:\swarmtales`)

Build **before** the tests. The tests import generated files under `assembly/proto/*.ts`, and those files do not exist until `build:release` has run. Testing first fails with `File 'assembly/proto/ink.ts' not found`.

Paste **one line at a time**. After each line, read the prompt before you paste the next one. It must say `PS C:\swarmtales>` when the note below says you are in the Ink folder. After `cd shop` it says `PS C:\swarmtales\shop>`. If a later line is meant for `C:\swarmtales` and the prompt still shows `\shop>`, run `cd ..` and check again.

Ink, from `C:\swarmtales`:

```powershell
cd C:\swarmtales
```

```powershell
npx.cmd yarn@1.22.22 build:release
```

Shop, from `C:\swarmtales\shop`:

```powershell
cd shop
```

```powershell
npx.cmd yarn@1.22.22 build:release
```

Back to `C:\swarmtales` (prompt must show `PS C:\swarmtales>`):

```powershell
cd ..
```

```powershell
Get-Item build\release\contract.wasm, shop\build\release\contract.wasm | Select-Object FullName, Length
```

**Expect:** two files. Ink is 38459 bytes. Shop is 65086 bytes.
(Ink was 38420 bytes before 19 October 2026. The 39 extra bytes are the new mainnet description, "1 INK per text unit; most emoji cost 2". The Ink already on testnet keeps the old text and is **not** re-uploaded.)
**Send back:** the two lengths.

## Step 4. Run the tests (folder: `C:\swarmtales`)

Same rule as Step 3: paste **one line at a time**, and check the prompt. Ink and the deploy script run from `PS C:\swarmtales>`. Shop tests run from `PS C:\swarmtales\shop>`.

Ink:

```powershell
cd C:\swarmtales
```

```powershell
npx.cmd yarn@1.22.22 test
```

Deploy script (still in `C:\swarmtales`):

```powershell
npx.cmd yarn@1.22.22 test:deploy
```

Shop:

```powershell
cd shop
```

```powershell
npx.cmd yarn@1.22.22 test
```

Back to `C:\swarmtales`:

```powershell
cd ..
```

**Expect:**
- Ink: `[Summary]: 48 pass, 0 fail`
- Deploy script: `# pass 25` and `# fail 0`
- Shop: `[Summary]: 51 pass, 0 fail`

**Send back:** the three pass/fail lines. Stop here if anything fails.

## Step 5. Check the network and your wallets (no key needed)

```powershell
cd C:\swarmtales
node deploy/deploy.js status --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6 --ink 195trftAvPnqeoPmHeGmxtwNYVUVdghm5x --shop 1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth
```

**Expect:** `(chain id verified)`, then mana about 1000 / 50 / 950. The contract lines say
`not readable yet: contract does not exist`. That is correct before the upload.

## Step 6. Upload Ink (signed by the Ink wallet)

```powershell
cd C:\swarmtales
node deploy/deploy.js upload ink --expect 195trftAvPnqeoPmHeGmxtwNYVUVdghm5x
```

Paste the **Ink wallet's** private key at the prompt and press Enter.
**Expect:** `Key matches ...`, `Dry run OK. Mana it used: about 3 to 6`, then the SEND question.
Type `SEND` and press Enter. Then you see `Transaction id: 0x...` and `included in block ...`.
**Send back:** the transaction id and block number.

## Step 7. Make your main wallet the Ink admin (signed by the Ink wallet)

```powershell
node deploy/deploy.js set-admin ink --contract 195trftAvPnqeoPmHeGmxtwNYVUVdghm5x --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6
```

Paste the **Ink wallet's** key again, then type `SEND`.
After this, Ink admin actions are signed by your main wallet, not the Ink wallet.
**Send back:** the transaction id.

## Step 8. Upload Shop and make your main wallet its admin (signed by the Shop wallet)

```powershell
node deploy/deploy.js upload shop --expect 1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth
node deploy/deploy.js set-admin shop --contract 1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6
```

Both use the **Shop wallet's** key. The Shop upload uses about 5 to 8 mana.
**Send back:** both transaction ids.

## Step 9. Connect Shop to Ink (signed by your main wallet)

```powershell
node deploy/deploy.js wire --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6 --ink 195trftAvPnqeoPmHeGmxtwNYVUVdghm5x --shop 1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth --treasury 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6 --founder 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6
```

Paste your **main wallet's** key (`18Mh...`). One transaction does three things:

- `ink.set_minter(Shop, 30)`: Shop may mint Ink for purchases, memberships, starters and promos. It may **not** mint refunds.
- `shop.set_addresses`: on testnet, treasury and founder are both your main wallet. Ink is set. Stories stays empty until that contract exists.
- `shop.set_ink_amounts`: Writer month 15000, packs 5000 / 15000 / 45000, starter book 20000, starter short 10000.

**Send back:** the transaction id.

## Step 10. Turn on a test payment token (signed by your main wallet)

There is no known stablecoin on this testnet. The Shop accepts any KCS-4 token the admin turns
on, so for testing it uses **tKOIN**, which has 8 decimals. Prices are small test values
(Writer month = 2 tKOIN). These are **not** launch prices.

```powershell
node deploy/deploy.js test-asset --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6 --shop 1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth
```

**Send back:** the transaction id.

## Step 11. Check everything

```powershell
node deploy/deploy.js status --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6 --ink 195trftAvPnqeoPmHeGmxtwNYVUVdghm5x --shop 1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth
```

**Expect:**
- Both contracts show `[contract uploaded]`.
- `ink.get_config` admin = `18Mh...`.
- `ink minter mask for Shop` = `{"value":30}`.
- `shop.get_config` shows admin, treasury, founder and ink, and `fee_bps` 100.
- The tKOIN asset is `enabled: true`.

**Send back:** the whole output.

## Step 12. Act as a normal user (test user wallet `12SV...`, folder `C:\swarmtales`)

In this phase the test user wallet behaves like a normal reader or writer. It is not the
treasury, founder, or admin, so its payments really move between wallets. You sign with the
**test user wallet's** key unless a step says the admin.

Set these once in the PowerShell window so the commands stay short. These are public addresses
only. Never put a key in a variable like this.

```powershell
cd C:\swarmtales
$INK  = "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x"
$SHOP = "1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth"
$ADMIN = "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6"
$USER = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww"
```

(If you close PowerShell, run that block again.)

### 12a. Security checks: things a normal user must NOT be able to do (dry runs only)

```powershell
node deploy/deploy.js user-checks --user $USER --ink $INK --shop $SHOP --admin $ADMIN
```

Paste the **test user's** key. The script tries each of these as a dry run, and each one should
be refused. **Nothing is ever sent, and no mana is used.**

- mint Ink to itself
- burn Ink directly
- burn with the removed reason 2
- **transfer Ink to another wallet** (Ink is non-transferable)
- make itself an Ink minter
- set the Shop fee to 0
- take over Shop admin
- buy a membership charged to the admin's wallet
- claim Writer Ink early

**Expect:** every line `[PASS]`, then `All checks rejected as expected.`
A `[FAIL]` means a protection did not work. Stop and send it back.
`[INCONCLUSIVE]` means a network or mana problem, not a contract result.
**Send back:** the whole output.

### 12b. Buy a Writer month with tKOIN (user signs)

```powershell
node deploy/deploy.js test-buy --user $USER --shop $SHOP
node deploy/deploy.js status --ink $INK --shop $SHOP --user $USER
```

One transaction approves the Shop for exactly 2 tKOIN, then buys a Writer month. 1.98 tKOIN
goes to treasury and 0.02 (1%) to founder. Both are `18Mh...` on testnet. Shop mints
**15000 Ink** to the user.

**Expect** in status:
- `ink balance of user` = `{"value":"15000"}`
- membership `tier` = 2 (Writer) and a `paid_until` about 30 days ahead, in seconds

**Send back:** the transaction id and the status output.

### 12c. Edge case: Reader cannot replace an active Writer (dry run only)

```powershell
node deploy/deploy.js test-buy --user $USER --shop $SHOP --tier reader
```

**Expect:** `Dry run failed ... an active Writer membership cannot be replaced by Reader`.
Nothing is sent. If it instead asks you to type SEND, type anything else and send me the output.

### 12d. Promo code grant (admin creates it, user claims it)

The admin creates a test campaign: code `SWARMTEST`, 500 Ink per wallet, 5000 Ink budget,
open for 7 days. Sign with the **admin** key:

```powershell
node deploy/deploy.js test-promo --admin $ADMIN --shop $SHOP
```

It prints `Campaign id: 1`. Use that number below. Then claim it with the **test user's** key:

```powershell
node deploy/deploy.js claim-promo --account $USER --shop $SHOP --campaign 1
node deploy/deploy.js status --ink $INK --shop $SHOP --user $USER
```

**Expect:** the Ink balance goes from 15000 to **15500**, and `promo claimed by user` = `{"value":"1"}`.

Then run the security checks again, this time with the promo checks added:

```powershell
node deploy/deploy.js user-checks --user $USER --ink $INK --shop $SHOP --admin $ADMIN --campaign 1
```

**Expect:** `[PASS]` on all of them, including "claims a promo a second time" (one claim per
wallet, ever) and "wrong code".
**Send back:** the transaction ids and both outputs.

### 12e. Spending Ink on writing: the Stories contract

Story text costs **1 Ink per text unit** (UTF-16 code unit). Most emoji cost 2, a few older
ones such as ⭐ cost 1, skin tones and flags such as 👍🏽 and 🇺🇸 cost 4, and a family such as
👨‍👩‍👧 costs 8. Stories counts this itself and refuses the text if the website's number
disagrees, so nobody is charged a surprise amount.

The steps below are in **section 13**. The Stories contract is already on testnet at `1JHakWJRXpAExjEuBik1posc8PXYYpugeN`.

---

## Step 13. Stories on testnet (folder: `C:\swarmtales`)

Testnet coins are play money. Nothing in this step uses real money. Each signed step is a dry run
first, and nothing is sent until you type `SEND`.

These are the addresses in use on testnet now (19 October 2026):

| Role | Address |
|---|---|
| Ink (already uploaded) | `195trftAvPnqeoPmHeGmxtwNYVUVdghm5x` |
| Shop (already uploaded) | `1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth` |
| Admin, treasury and founder | `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6` |
| Test user | `12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww` |
| Stories | `1JHakWJRXpAExjEuBik1posc8PXYYpugeN` |

Set them once in the PowerShell window (public addresses only, never a key):

```powershell
$INK = "195trftAvPnqeoPmHeGmxtwNYVUVdghm5x"
```

```powershell
$SHOP = "1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth"
```

```powershell
$ADMIN = "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6"
```

```powershell
$USER = "12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww"
```

```powershell
$STORIES = "1JHakWJRXpAExjEuBik1posc8PXYYpugeN"
```

### 13a. Build and test Stories

```powershell
cd stories
```

```powershell
npx.cmd yarn@1.22.22 install --frozen-lockfile
```

```powershell
npx.cmd yarn@1.22.22 build:release
```

```powershell
npx.cmd yarn@1.22.22 test
```

```powershell
cd ..
```

**Expect:** `[Summary]: 86 pass, 0 fail`, and `stories\build\release\contract.wasm` is 100832 bytes.

### 13b. Upload Stories (signed by the Stories wallet)

```powershell
node deploy/deploy.js upload stories --expect $STORIES
```

### 13c. Make the admin wallet the Stories admin (signed by the Stories wallet)

```powershell
node deploy/deploy.js set-admin stories --contract $STORIES --admin $ADMIN
```

After this, put the Stories wallet's key away. Everything below is signed by the admin or the test user.

### 13d. Wire Stories to Ink and Shop (signed by the admin wallet, one transaction)

```powershell
node deploy/deploy.js wire-stories --admin $ADMIN --ink $INK --shop $SHOP --stories $STORIES --treasury $ADMIN --founder $ADMIN
```

This does, in one transaction: `stories.set_addresses`, `ink.set_burner(Stories, true)`,
`ink.set_minter(Stories, 32)` (refunds only), `shop.set_addresses`, and the 11 categories.
`shop.set_addresses` replaces **all four** Shop addresses, so the script **reads the current
treasury and founder from the Shop on chain** and sends them back unchanged. It stops if they
don't match the `--treasury` / `--founder` you typed, or if Shop already points at another Stories.

### 13e. Check the wiring (no key needed)

```powershell
node deploy/deploy.js status --admin $ADMIN --ink $INK --shop $SHOP --stories $STORIES --user $USER
```

**Expect:** burner flag `true`, minter mask `32`, Shop points at `$STORIES`, category 1 is Fantasy.

### 13f. Open a test Short Story (signed by the test user)

The test user needs tKOIN for the Short Story open price (0.5 tKOIN with the test prices). The
Shop mints 10,000 starter Ink to the opener in the same transaction.

```powershell
node deploy/deploy.js test-open --user $USER --shop $SHOP --stories $STORIES
```

### 13g. Measure mana per submission size (dry runs only, nothing is sent)

```powershell
node deploy/deploy.js measure --user $USER --ink $INK --stories $STORIES --story 1
```

```powershell
node deploy/deploy.js measure --user $USER --ink $INK --stories $STORIES --story 1 --emoji
```

This prints the mana for 100, 500, 1000, 2000 and 4000-character contributions. Sizes above the
current cap show as "skipped".

After the 19 October 2026 mana measure, the live testnet `contribution_cap` was left at **4000**.
A plain 4,000-character contribution was about 0.5006 mana, and the same length in emoji was about 0.5779 mana.

An admin can change the cap again:

```powershell
node deploy/deploy.js stories-limits --admin $ADMIN --stories $STORIES --cap 4000
```

Set it back afterwards to the number you choose (for example `--cap 2000`).

**Send back:** the transaction ids from 13b, 13c, 13d, 13f, and both `measure` tables.

---

## If something goes wrong

| Message | Meaning |
|---|---|
| `Wrong key. This key controls X but ... is Y` | You pasted the key for a different wallet. Nothing was signed. |
| `Chain id mismatch` | The node is not the testnet. Nothing was signed. |
| `already has a contract on this network` | That address already holds a contract. The script will not overwrite it. |
| `Dry run failed` / `Dry run reverted` | The node rejected it. Nothing was sent. Send back the full message. |
| `payer does not have the rc` / `no mana` | Top up that wallet from the faucet or from `18Mh...`, wait a minute, retry. |
| `running scripts is disabled` | You typed `npx`; use `npx.cmd`. |
| `The hidden key prompt needs a real terminal window` | Run it in a normal PowerShell window, not inside another program. |

Advanced: instead of the prompt, the script can read a key from `$env:SWARMTALES_DEPLOY_SECRET`
that you set in the same window. The prompt is safer, because a command you type can end up in
PowerShell's history file. If you use the variable, remove it afterwards:
`Remove-Item Env:SWARMTALES_DEPLOY_SECRET`.

## Network facts (checked 19 October 2026)

- RPC: `https://testnet.koinosfoundation.org`
- Chain id: `EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==` (the script checks it every run)
- tKOIN contract: `1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju`
- Older guides mention Harbinger (`harbinger-api.koinos.io`). That is a different testnet with a different chain id. Your wallets are funded on the Koinos Foundation testnet above.
