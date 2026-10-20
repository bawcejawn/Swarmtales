# Testnet upgrade: free finishing, and bookmarks that follow the wallet (Windows PowerShell)

This updates the code of your **Stories** contract. The address stays the same and all data
is kept. Run it before you merge the website pull request.

## 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout feat/finish-and-sync
git pull
cd stories
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..
Get-FileHash stories\build\release\contract.wasm
```

**Expect:**

- Six test summaries that add up to **148 pass**, 0 fail.
- This fingerprint:

```
6FD18EE131C8AF77904E80B008304399C20A42746F3C9B25D047D6F93E2F01C0
```

The "INFO AS210" lines are harmless compiler notes. If the fingerprint is different, stop and
send me the output.

## 2. Upgrade Stories (key: `ST-Stories-v3`)

```powershell
node deploy/deploy.js upload stories --expect 1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ --upgrade
```

**Expect** a dry run of about 2.3 mana. Type `SEND`.

## 3. Merge the website pull request

**Merge pull request** → **Confirm merge**. The site updates in about two minutes.
