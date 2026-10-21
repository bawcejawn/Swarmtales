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
- [ ] Make the admin a **multisig wallet, 2 of 3**, set up before mainnet: two hardware keys held by different people, and **one spare key kept offline** (on paper or a hardware wallet in a separate place, never used day to day). Losing any one key then loses nothing. Admin checks ask the admin address to authorize, so a multisig smart-contract wallet works. Rehearse it on testnet first: a full admin action, the two-step handover to the multisig, and replacing one lost signer with the spare.
- [ ] The admin key is not the treasury or founder key.
- [ ] Admin actions are signed only through the deploy script, which checks the chain id and only talks to listed mainnet nodes.

## 4. Treasury and founder

- [ ] Hardware wallets, separate from the admin.
- [ ] Their addresses are typed into `wire` and `wire-stories` by hand on mainnet (the script requires `--treasury` and `--founder`) and double-checked against a second source.

## 5. Moderator (copy checker)

- [ ] A fresh key from `node deploy/deploy.js new-moderator-key`, used for nothing else. It can only hide, unhide and add notes.
- [ ] Stored only as the `MODERATOR_WIF` secret of the `copy-checker` environment (Settings > Environments > copy-checker), with "Deployment branches" limited to `main`. The workflow's `check` job runs in that environment, so a run dispatched on any other branch never gets the key. Delete any repository-level `MODERATOR_WIF` secret: every branch can read those.
- [ ] Set the `EXPECTED_CHAIN_ID` variable if the checker uses a node other than the Foundation testnet or api.koinos.io.
- [ ] If it leaks: set a new moderator with `set-moderation` (admin), then replace the secret.

## 6. If a key is lost or leaks

| Key | Do this |
|---|---|
| Admin | Once a handover has been accepted, the contract key is no longer admin and cannot propose a new one: every admin check, `set-admin` included, needs the current admin's signature. The only way back is a **code re-upload with the contract key**: upload a reviewed recovery build that lets a new admin be set, have the new admin accept, then upload the normal release build again with its recorded sha256. If the contract key is also gone, admin cannot be recovered. This is why the admin should be a 2-of-3 multisig with a spare key offline (section 3): a lost signer is replaced by the other two, with no upload |
| Contract key | Nobody else can upload, so the code stays as it is. Plan a migration to a new contract address if an upgrade is ever needed |
| Contract key leaked | Treat as critical: the holder can replace the code. Pause the contract (admin), warn users publicly, and stop sending payments to it |
| Treasury or founder | The Shop admin points payments at new addresses with `set_addresses` |
| Moderator | The Stories admin sets a new moderator |

### Replacing contract code on mainnet (the re-upload above, or a reviewed fix after launch)

The contract key is the only key that can do this, and the stored data (stories, memberships, balances, settings) is kept.

1. Build the reviewed code (`npx yarn@1.22.22 build:release` in the contract's folder) and record its sha256. Have a second person build the same commit and compare the hash.
2. Pause the contract with its admin first, if the admin still works.
3. Run, from the repository root:
   `node deploy/deploy.js upload ink|shop|stories --expect <contract address> --expect-sha256 <recorded hash> --upgrade --network mainnet --i-understand-this-is-mainnet --i-understand-this-replaces-mainnet-code`
   The script stops on a sha256 mismatch, on an unlisted node, or without both mainnet flags. It runs a dry run, then waits for you to type SEND.
4. For a lost admin: the recovery build lets a new admin be proposed. Propose and accept it (`set-admin`, `accept-admin`), then upload the normal release build again the same way, with its own recorded sha256.
5. Check `status`, unpause, and publish what changed and why.

## 7. Before the mainnet upload

- [ ] Every box above is ticked.
- [ ] [ADMIN_POWERS.md](ADMIN_POWERS.md) is published and linked from the site.
- [ ] A full rehearsal on testnet used the same key setup (hardware wallets, multisig admin, two-step admin handover).
