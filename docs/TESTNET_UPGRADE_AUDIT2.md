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
  others' paid changes need (a part now keeps up to 220 versions). The history is read up to 5
  versions at a time, fewer when they are long (at most about 64 KB of text per read), so a long
  one still loads, and a takedown never reads it: free edits can't make a part impossible to take
  down.
- Blocked wallets can't edit, set a citation (they can still clear one), restore a hidden part
  or rename a story; a hidden part can't be edited; the story summary follows pause and
  membership, and the admin or moderator can clear it (`deploy.js clear-summary`).
- An opener or editor can't restore a part the **admin** hid, and only the admin can unhide it
  (the copy checker's moderator key can't). The admin can hide a part that is already hidden: it
  becomes an admin hide in one transaction. Parts the copy checker or reports hid can still be
  restored, but a part restored after a **checker** hide gives no Ink back when cut or removed. If
  the checker unhides its own hide (the writer cited the source), the part is refundable again.
  Someone else's paid removal of such a part gives no Ink back either.
- The copy checker checks a part again whenever its text or citation changes, so rewording a part
  after its check doesn't get copied text past it. It also checks parts that writer reports hid:
  a copy writers reported as copied becomes the checker's hide in place (no refund on removal;
  restoring it gives up the refund); one reported for anything else stays the reports' hide, and
  a citation never lifts it. A part whose checker hide its opener restored is never hidden again
  for the same text. It dates matching text by when its words were first written, not by the last
  edit, and a long part it couldn't search (no searches left, or the service failed) waits for the
  next run instead of passing unsearched.
- Blocked openers and editors can't create invites or remove other writers' hidden parts.
- Blocked wallets also can't add editors or change a story's allow-list.
- Only someone with a live part of their own (or the opener or an editor) can update the story
  summary; changing someone else's part no longer counts.
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
- **Strikes, after more edits:** when the writer's own edits take such a part past 61 versions, the
  edit that makes version 62 reads its versions once and records every other wallet it finds, so
  the takedown still asks who gets the strike and the admin can name that wallet. That one edit
  costs more mana than usual (it reads up to 60 versions); it happens at most once per part.
- **Hidden parts:** a part hidden before the upgrade other than by reports has `hidden_by` 0. Its
  opener can't restore it and the moderator can't unhide it (it may be an admin hide); only the
  admin can. To make it an admin hide on the record, run `deploy.js hide` on it again with the
  admin key: one transaction, the part stays hidden throughout.
- **Summary:** a wallet that wrote before the upgrade keeps its summary right by its Ink total, as
  now, also after it writes new parts (its old parts were never counted, so removing a new one no
  longer takes the right away while an old one is live).
- **Copy checker:** it now only brings back parts it hid itself (`hidden_by` 2), so it forgets the
  parts it hid before the upgrade (they stay hidden until the admin unhides them). Its saved state
  gains each part's text key: on the first run after the merge, parts it already checked and
  nobody edited count as checked; parts edited since they were written, parts it found hidden,
  and parts with a citation (it kept no record of the ones it brought back on a citation) are
  checked once (web search included, within the usual search budget).
- **Takedown tool:** for old parts it lists changers from the versions and `last_edited_by`; it
  can't see a citation-only changer from before the upgrade and says so.

**One-off check before the upgrade (read only, nothing is signed).** For each story on testnet:

```powershell
node deploy/deploy.js legacy-parts --stories 1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ --story <id>
```

It prints the parts someone else revised before `edited_by_others` existed (the strike rule
above covers them) and the hidden parts that reports did not hide (re-hide the admin's after the
upgrade with `deploy.js hide` and the admin key). Send me its output.

**Contribution cap.** Keep `contribution_cap` at or below 4,000 until the Audit Bot local-chain
takedown test (`tests/chain/Swarmtales.audit-ab047-takedown.chain.test.js`) has passed on this
build. On **mainnet**, keep it at **6,000 or lower** until someone measures `get_versions` on a
node with this build: the fourth fix check measured the read limit only on a local node with the
chain's default limits, where a version page failed above about 6,000 three-byte characters per
version (AB-070). This build stops a page at about 64 KB of text, which reads there even at
10,000, but public nodes' limits weren't measured.

### For the next contract upgrade (not in this build)

These need a change to the Stories contract. This build is final for this upgrade, so they wait:

- **AB-079 (Low):** a wallet that wrote before the upgrade keeps the summary right by its Ink
  total, and that total includes Ink it paid to change other writers' parts. So it keeps the right
  after removing all its own parts. Fix: don't add `revise_part`'s added letters to the by-total
  figure of a pre-upgrade writer (or drop the flag once its last pre-upgrade part is gone). Test:
  OW-3 in the fifth fix check's `Stories.audit-fc5-attacks.spec.ts`, and `rt5-ins-oldtotal`.
- **AB-081 (Low):** invite links an opener made before the admin blocked them still add wallets
  to the allow-list. Fix: `requireNotBlocked(opener)` in `join_with_invite`. Until then, such
  links keep working until they expire or run out of uses (only the opener can revoke them).
  Test: `rt5-sab-blockedinvite`.

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

**Expect:** Stories **381 pass**, Shop **89 pass**, 0 fail. On the build this branch was made
with, the fingerprints were:

```
Stories  26DF39A915AE84C898A988E53A663C457841F3807F8FA3B1AE8AD1FA6A84F0D6
Shop     4EDF015169C85E2F3460ABEF85AAB0DDCBE279C58B074B5B0E208580E54846C6
Ink      537F523396C1E195C0262E10DD574C28492B269D247A6025A10F30461B2308DC
```

Ink is not upgraded here; its line is for checking. To build it, run the same two commands in
`C:\swarmtales` itself (Ink **53 pass**) and `Get-FileHash build\release\contract.wasm`.

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
