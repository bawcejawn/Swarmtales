# Key custody checklist (before mainnet)

Who can do what is listed in [ADMIN_POWERS.md](ADMIN_POWERS.md). This checklist is how those keys are kept. Work through it before the mainnet upload, and again whenever a key changes hands.

## 1. Make the keys

- [ ] Each of these is a **separate** key, never reused for anything else:
  - Ink contract key, Shop contract key, Stories contract key (the three upload addresses)
  - Admin (one wallet for all three contracts, or one per contract)
  - Treasury, founder
  - Moderator (the copy checker's key)
- [ ] The three contract keys and the admin are made on **hardware wallets**, or on an offline machine that never goes online again.
- [ ] Each hardware wallet's recovery phrase is written on paper, and stored in **two** places that do not share a risk (not the same building).
- [ ] Nobody types a recovery phrase into a computer, a website or a chat.

## 2. Contract keys (upload power)

These keys can replace a contract's code, so they are the most valuable keys.

- [ ] Used only to **upload** a contract and to make the **first** admin proposal (`set-admin`). After that, they go back offline.
- [ ] The upload overrides stay **off** (the deploy script always uploads with `false false false`). This keeps upload power with the key alone.
- [ ] A contract key cannot be made multisig without adding a reviewed `authorize` function to the contract, so it stays a single hardware-held key. Do not turn the overrides on to get multisig.
- [ ] Every upload uses a release build with a recorded sha256: `node deploy/deploy.js upload <name> --expect <addr> --expect-sha256 <hex>`. The script refuses mainnet without it.
- [ ] The release sha256 of each contract is published (README or release notes) at the same time as the upload.

## 3. Admin

- [ ] Admin is handed over in **two steps**: the current admin runs `set-admin` (proposes), then the new admin runs `accept-admin` with its own key. Check `status` shows the new admin before putting the old key away.
- [ ] Prefer a **multisig wallet** as the admin (for example 2 of 3 hardware keys held by different people). Admin checks ask the admin address to authorize, so a multisig smart-contract wallet works. Rehearse a full admin action with it on testnet before mainnet.
- [ ] The admin key is not the treasury or founder key.
- [ ] Admin actions are signed only through the deploy script, which checks the chain id and only talks to listed mainnet nodes.

## 4. Treasury and founder

- [ ] Hardware wallets, separate from the admin.
- [ ] Their addresses are typed into `wire` and `wire-stories` by hand on mainnet (the script requires `--treasury` and `--founder`) and double-checked against a second source.

## 5. Moderator (copy checker)

- [ ] A fresh key from `node deploy/deploy.js new-moderator-key`, used for nothing else. It can only hide, unhide and add notes.
- [ ] Stored only as the `MODERATOR_WIF` secret in GitHub. Ideally in a protected `copy-checker` environment limited to the `main` branch.
- [ ] Set the `EXPECTED_CHAIN_ID` variable if the checker uses a node other than the Foundation testnet or api.koinos.io.
- [ ] If it leaks: set a new moderator with `set-moderation` (admin), then replace the secret.

## 6. If a key is lost or leaks

| Key | Do this |
|---|---|
| Admin | The contract key proposes a new admin; the new admin accepts. If the contract key is also gone, admin cannot be recovered |
| Contract key | Nobody else can upload, so the code stays as it is. Plan a migration to a new contract address if an upgrade is ever needed |
| Contract key leaked | Treat as critical: the holder can replace the code. Pause the contract (admin), warn users publicly, and stop sending payments to it |
| Treasury or founder | The Shop admin points payments at new addresses with `set_addresses` |
| Moderator | The Stories admin sets a new moderator |

## 7. Before the mainnet upload

- [ ] Every box above is ticked.
- [ ] [ADMIN_POWERS.md](ADMIN_POWERS.md) is published and linked from the site.
- [ ] A full rehearsal on testnet used the same key setup (hardware wallets, multisig admin, two-step admin handover).
