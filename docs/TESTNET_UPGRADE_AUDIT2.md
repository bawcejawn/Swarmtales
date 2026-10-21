# Testnet upgrade: audit fixes 2 (Windows PowerShell)

This updates the code of your **Stories** and **Shop** contracts. Their addresses stay the same
and all data is kept. Run it **before** you merge the pull request, so the website and the
contracts change together.

What changes for people using the site:

- **Your own part:** rewording is free; letters beyond its current length cost 1 Ink each (you
  pay, never a story's pool). You can always shorten it, and a cut gives back the Ink you (or the
  pool) paid for the cut letters, also after someone else changed the part. Letters someone else
  paid for are never refunded to you. The page sends the price it showed; if the part changed
  meanwhile and the edit would cost more, it is refused and you reload.
- **Someone else's part:** the same price as before (2× the letters added and removed, at least
  10, doubling per change), but the changer always pays, never the pool, and a writer can no
  longer use "Change" on their own part.
- Every change to a part's text is kept in its history, naming who made it. A takedown wipes the
  history, even for a part that was already removed. Your own edits never use up the room
  others' paid changes need (a part now keeps up to 220 versions).
- Blocked wallets can't edit, set a citation (they can still clear one), restore a hidden part
  or rename a story; a hidden part can't be edited; the story summary follows pause and
  membership, and the admin or moderator can clear it (`deploy.js clear-summary`).
- An opener or editor can't restore a part the **admin** hid (only the admin or the moderator can
  unhide it). Parts the copy checker or reports hid can still be restored.
- Saving a part or a citation unchanged no longer counts as changing it.
- **Promos:** each wallet may claim each campaign once (it was once ever).
- Stories' Ink **and Shop** addresses, and Shop's Ink address, can't be changed any more. They are
  already set on testnet, so nothing to do. `wire --replace-shop` is gone: moving to a new Shop
  now needs a code upload with the contract key.

### Parts changed before this upgrade (testnet only)

The new code reads three new segment fields that are 0 on every part written before it:
`paid_changes`, `hidden_by` and the changer list. What that means for old parts:

- **Price:** their next paid change costs ×2 again (the doubling restarts from zero).
- **Strikes:** a part someone else revised before `edited_by_others` existed is still treated as
  changed: the takedown looks at its kept versions, and the admin can name the wallet a version
  shows. So it never gets an automatic strike against its writer for someone else's words.
- **Refunds:** cuts refund what the writer paid beyond the new length, like every part now. An
  old part never refunds more than its `charged`, so nobody can get back more than they paid.
- **Hidden parts:** a part the admin hid before the upgrade has `hidden_by` 0, so its opener could
  still restore it. Unhide it and hide it again with the admin key to lock it.
- **Takedown tool:** for old parts it lists changers from the versions and `last_edited_by`; it
  can't see a citation-only changer from before the upgrade and says so.

**One-off check before the upgrade (read only, nothing is signed).** For each story on testnet:

```powershell
node deploy/deploy.js legacy-parts --stories 1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ --story <id>
```

It prints the parts someone else revised before `edited_by_others` existed (the strike rule
above covers them) and the hidden parts that reports did not hide (re-hide the admin's after the
upgrade). Send me its output.

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

**Expect:** Stories **315 pass**, Shop **89 pass**, 0 fail. On the build this branch was made
with, the fingerprints were:

```
Stories  DF132991DAD92C472DBAEF3F64B624854D85F230F2E7291D6F8A95DF35E063C3
Shop     4EDF015169C85E2F3460ABEF85AAB0DDCBE279C58B074B5B0E208580E54846C6
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
