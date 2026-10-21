# Testnet upgrade: paid changes to other writers' parts, story summary (Windows PowerShell)

This updates the code of your **Stories** contract. The address stays the same and all data
is kept. Run it **before** you merge the website pull request.

## 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout feat/revise-and-book
git pull
cd stories
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..
Get-FileHash stories\build\release\contract.wasm
```

**Expect:**

- Seven test summaries that add up to **154 pass**, 0 fail.
- This fingerprint:

```
3BF25A77DEE6F862C88A9F5DB1A3EC85AE91E517C13B4B342305C71E3235D3EF
```

The "INFO AS210" lines are harmless compiler notes. If the fingerprint is different, stop and
send me the output.

## 2. Upgrade Stories (key: `ST-Stories-v3`)

```powershell
node deploy/deploy.js upload stories --expect 1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ --upgrade
```

**Expect** a dry run of about 2.2 mana. Type `SEND`. If it says the wallet's mana is too low,
send `ST-Stories-v3` 3 tKOIN and try again.

## 3. Merge the website pull request

**Merge pull request** → **Confirm merge**. The site updates in about two minutes.
