# Testnet upgrade: sources (citations), checker notes, restoring hidden parts (Windows PowerShell)

This updates the code of your **Stories** contract. The address stays the same, and all
stories, parts, pools and settings are kept. This upgrade doesn't touch the Shop.

It adds three things:

- **Citations:** writers can name the source of a quote.
- **Source notes:** the copy checker can note where text also appears, without hiding it.
- **Restore:** the story's opener or an editor can bring a hidden part back.

Run it before you merge the website pull request.

## 1. Get the branch and build (folder `C:\swarmtales`)

```powershell
cd C:\swarmtales
git fetch origin
git checkout feat/gentle-checker
git pull
cd stories
npx.cmd yarn@1.22.22 build:release
npx.cmd yarn@1.22.22 test
cd ..
Get-FileHash stories\build\release\contract.wasm
```

**Expect** six test summaries that add up to **146 pass**, 0 fail, and this fingerprint:

```
D6323BF1A8AFBB21076F5C6A3209599B7CE0CE5818A13243B76547247FAA98DF
```

If it differs, stop and send me the output.

## 2. Upgrade Stories (key: `ST-Stories-v3`)

```powershell
node deploy/deploy.js upload stories --expect 1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ --upgrade
```

**Expect:**

1. The line `UPGRADE (testnet)… stored data is kept`.
2. A dry run of about **2.3 mana**.
3. Type `SEND`.

If it says the wallet's mana is held or too low, wait a minute, or send `ST-Stories-v3`
2 tKOIN.

## 3. Merge the website pull request

Open the pull request link → **Merge pull request** → **Confirm merge**.

The website and copy checker both update by themselves.
