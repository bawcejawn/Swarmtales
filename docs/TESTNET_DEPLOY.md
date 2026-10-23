# SwarmTales fresh testnet deploy (Windows PowerShell)

This puts **brand-new** Ink, Shop and Stories contracts on the Koinos Foundation testnet, from
your own PC, with the 2026-10 audit fixes. The old testnet contracts are left alone and the
website moves to the new ones. Testnet coins (tKOIN) are play money.

Every step was run end to end on 23 October 2026 with throwaway wallets before this guide was
written; the mana numbers are what those runs used. You sign everything yourself. The tool never
saves or prints a key, and nothing is sent until you type `SEND`.

> **Never reuse these contract wallets on mainnet**, and never use a mainnet key here. The tool
> refuses an address it knows from the other network.

## What you need first

| Thing | How to check | If missing |
|---|---|---|
| Git for Windows | `git --version` | https://git-scm.com/download/win (defaults are fine) |
| Node.js 22 LTS | `node -v` prints `v22.x` | https://nodejs.org (the LTS) |
| Kondor, set to **testnet** | the network name in Kondor | Kondor settings → Network |
| Your admin wallet `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6` with at least 10 tKOIN | Kondor | the faucet bot: https://t.me/KoinosTestnetFaucetBot |

Open **PowerShell** and paste each block, one at a time.

**Pasting a key:** only at the tool's hidden prompt (right-click or Ctrl+V, then Enter; nothing
shows). Afterwards clear the clipboard: Win+V → "Clear all". Never paste a key anywhere else.

---

## Step 1. Three new wallets

In Kondor (testnet), create **three new accounts** and name them:

- `ST-Ink-2610`
- `ST-Shop-2610`
- `ST-Stories-2610`

On Koinos the wallet that uploads a contract **becomes** the contract's address, so each contract
gets its own wallet. Write each one's recovery phrase on paper.

From your admin wallet, send with Kondor:

| Wallet | Send | Why (measured mana) |
|---|---|---|
| `ST-Ink-2610` | **10 tKOIN** | upload 3.4 + handover 0.04 |
| `ST-Shop-2610` | **15 tKOIN** | upload 6.3 + handover 0.05 |
| `ST-Stories-2610` | **35 tKOIN** | upload 13.9 + handover 0.06. The node holds the upload's mana for a while, so the extra lets the next step run right away |

Copy each new address. In the blocks below, replace the three `<...>` placeholders **once**:

```powershell
$ADMIN   = "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6"
$INK     = "<ST-Ink-2610 address>"
$SHOP    = "<ST-Shop-2610 address>"
$STORIES = "<ST-Stories-2610 address>"
```

(If you close PowerShell, paste this block again before continuing.)

## Step 2. Get the code and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout audit-2026-10-fixes
git pull
npx.cmd yarn@1.22.22 install --frozen-lockfile
npx.cmd yarn@1.22.22 build:release
cd shop
npx.cmd yarn@1.22.22 install --frozen-lockfile
npx.cmd yarn@1.22.22 build:release
cd ..\stories
npx.cmd yarn@1.22.22 install --frozen-lockfile
npx.cmd yarn@1.22.22 build:release
cd ..
cd web
npm.cmd ci
npm.cmd test
cd ..
```

**Expect:** each `build:release` ends with `Done`, and the web tests end with `# fail 0`.
(The full contract tests take about an hour; they were run before this guide. You can run them
later with `npx.cmd yarn@1.22.22 test` in each folder.)

Check that you built the same bytes that were tested:

```powershell
Get-FileHash build\release\contract.wasm
Get-FileHash shop\build\release\contract.wasm
Get-FileHash stories\build\release\contract.wasm
```

**Expect** the three hashes listed in `AUDIT_SCOPE.md` ("Expected release sha256"). If one
differs, stop and send me the output.

## Step 3. Upload the three contracts

Each asks for that contract wallet's key at the hidden prompt.

```powershell
node deploy/deploy.js upload ink --expect $INK
```
Paste the **ST-Ink-2610** key. **Expect** a dry run of about **3.4 mana**. Type `SEND`.

```powershell
node deploy/deploy.js upload shop --expect $SHOP
```
Paste the **ST-Shop-2610** key. About **6.3 mana**. Type `SEND`.

```powershell
node deploy/deploy.js upload stories --expect $STORIES
```
Paste the **ST-Stories-2610** key. About **13.9 mana**. Type `SEND`.

## Step 4. Hand each contract to your admin wallet (two steps each)

Propose (contract wallet's key), then accept (admin key):

```powershell
node deploy/deploy.js set-admin ink --contract $INK --admin $ADMIN
node deploy/deploy.js accept-admin ink --contract $INK --admin $ADMIN
node deploy/deploy.js set-admin shop --contract $SHOP --admin $ADMIN
node deploy/deploy.js accept-admin shop --contract $SHOP --admin $ADMIN
node deploy/deploy.js set-admin stories --contract $STORIES --admin $ADMIN
node deploy/deploy.js accept-admin stories --contract $STORIES --admin $ADMIN
```

`set-admin` asks for the **contract wallet** key (Ink, Shop, Stories in turn); `accept-admin`
asks for the **admin** key. Each is about 0.05 mana.

If a step says *"All of this wallet's mana is held for a recent transaction"*, wait 5 minutes
and run the same line again.

## Step 5. Wire everything (admin key)

```powershell
node deploy/deploy.js wire --admin $ADMIN --ink $INK --shop $SHOP --treasury $ADMIN --founder $ADMIN
node deploy/deploy.js wire-stories --admin $ADMIN --ink $INK --shop $SHOP --stories $STORIES
```

About 0.08 and 0.5 mana. `wire-stories` also adds the 11 categories. (On testnet the tool notes
that the release hashes aren't pinned yet; that's expected until mainnet.)

## Step 6. Payment token, Terms and moderator (admin key)

```powershell
node deploy/deploy.js test-asset --admin $ADMIN --shop $SHOP
node deploy/deploy.js set-terms --admin $ADMIN --stories $STORIES --version 2 --file web/public/terms/v2.md --uri https://bawcejawn.github.io/Swarmtales/terms/
node deploy/deploy.js set-moderation --admin $ADMIN --stories $STORIES --moderator 112LsjvgYPLDw5xep3P2Yi2TSThxebaekU
```

**Expect:**
- `test-asset` says *"The Shop has made no sale yet, so it can be used at once"* (the 7-day wait
  only applies to tokens enabled after the first sale).
- `set-terms` shows sha256 `2f2877f0…e516` for version 2.
- `set-moderation` keeps 3 reports and 5 strikes (shown as "unchanged").

## Step 7. Check

```powershell
node deploy/deploy.js status --admin $ADMIN --ink $INK --shop $SHOP --stories $STORIES
```

**Expect:** Ink minter mask for Shop **30**; Shop's `ink` and `stories` are your new addresses;
the tKOIN asset `"enabled":true`; `stories.get_config` shows `"contribution_cap":6000`,
`"terms_version":2` and the moderator; Ink burner for Stories **true** and minter mask **32**.

## Step 8. Send me the three addresses

Send the three new contract addresses (public addresses only). I switch the website to them in
the pull request. You then also update one GitHub setting:

1. https://github.com/bawcejawn/Swarmtales/settings/variables/actions
2. Edit the variable **`STORIES_ADDRESS`** → the new Stories address → **Update variable**.

## Step 9. Try it on the website (after the website update is merged)

1. Open a Short Story (Open a story). The price card says the starter Ink "or nothing is charged".
2. With a second wallet: buy a Writer month (Membership), write a part, then **Edit** your part:
   the edit panel now asks you to tick "I wrote this myself" too.
3. Try editing your part to the exact text of another part: the page refuses ("already in this
   story").
4. Press **Bookmark** on a part, then **Save to my wallet**: one confirmation saves your places.

## If something goes wrong

| Message | What to do |
|---|---|
| "mana is held for a recent transaction" | Wait 5 minutes, run the same line again |
| "Dry run failed" | Nothing was sent. Send me the whole message |
| A hash in Step 2 differs | Stop. Send me the `Get-FileHash` output |
| "insufficient pending account resources" | The wallet's mana is still reserved by the last transaction; wait 5 minutes |
