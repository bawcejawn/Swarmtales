# Testnet upgrade: audit fixes 2 (Windows PowerShell)

This updates the code of your **Stories** and **Shop** contracts. Their addresses stay the same
and all data is kept. Run it **before** you merge the pull request, so the website and the
contracts change together.

What changes for people using the site:

- **Your own part:** rewording is free; letters beyond its current length cost 1 Ink each (you
  pay, never a story's pool). You can always shorten it. The Ink comes back to you, unless
  someone else has changed the part; then removing the whole part returns what you paid.
- **Someone else's part:** the same price as before (2× the letters added and removed, at least
  10, doubling per change), but the changer always pays, never the pool, and a writer can no
  longer use "Change" on their own part.
- Every change to a part's text is kept in its history, naming who made it. A takedown wipes the
  history, even for a part that was already removed.
- Blocked wallets can't edit; a hidden part can't be edited; the story summary follows pause and
  membership, and the admin or moderator can clear it (`deploy.js clear-summary`).
- **Promos:** each wallet may claim each campaign once (it was once ever).
- Stories' Ink address can't be changed any more. It is already set on testnet, so nothing to do.

Parts changed before this upgrade start counting paid changes from zero, so their next change
costs ×2 again. That only affects testnet.

## 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout audit-fixes-2
git pull
cd stories
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..\shop
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..
Get-FileHash stories\build\release\contract.wasm
Get-FileHash shop\build\release\contract.wasm
```

**Expect:** Stories **260 pass**, Shop **78 pass**, 0 fail. On the build this branch was made
with, the fingerprints were:

```
Stories  E7424B1C823DC13814391BDBBA4A25803784560076195266E02BC0629DB9A748
Shop     F9B3ADF65A18E7FDCC67E39A4C215CF8655ED08E1305FCBE66BB54DFEA044BB9
```

If yours differ, stop and send me the output (a later commit on the branch changes them too).

## 2. Upgrade Stories (the Stories contract wallet's key)

```powershell
node deploy/deploy.js upload stories --expect 1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ --upgrade
```

**Expect** a dry run, then type `SEND`.

## 3. Upgrade Shop (the Shop contract wallet's key)

```powershell
node deploy/deploy.js upload shop --expect 14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD --upgrade
```

**Expect** a dry run, then type `SEND`. Promo claims made before the upgrade still count: a wallet
can't claim the campaign it already claimed, but it can claim a new one.

## 4. Move the moderator key into the protected environment

1. GitHub → **Settings** → **Environments** → **New environment**, name it `copy-checker`.
2. **Deployment branches and tags** → **Selected branches and tags** → add `main`.
3. In that environment, **Add environment secret** `MODERATOR_WIF` with the moderator key.
4. **Settings** → **Secrets and variables** → **Actions**: delete the repository secret
   `MODERATOR_WIF`.

After the merge, run **Actions → Copy checker → Run workflow** on `main` once and check it still
says it can hide.

## 5. Try the promo commands (optional)

```powershell
node deploy/deploy.js promo-new --admin $ADMIN --shop 14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD --budget 1000 --end 2026-12-31
node deploy/deploy.js promo-end <campaign id> --admin $ADMIN --shop 14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD
```

`promo-new` prints the share link once. Don't paste it into an issue or a log.

## 6. Merge the pull request

Only after Audit Bot has checked it. The site updates in about two minutes.
