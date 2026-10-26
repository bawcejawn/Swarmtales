# Key custody checklist (before mainnet)

Who can do what is listed in [ADMIN_POWERS.md](ADMIN_POWERS.md). This checklist is how those keys are kept. Work through it before the mainnet upload, and again whenever a key changes hands.

## 1. Make the keys

- [ ] Each of these is a **separate** key, never reused for anything else, and never reused across networks (a testnet contract key is never a mainnet one; the deploy tool refuses):
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
- [ ] The release sha256 of each contract is reproduced by two people from the same commit and written into `deploy/release-hashes.json` (reviewed like code). Never copy a hash the tool or a build printed.
- [ ] Every upload uses that release build: `node deploy/deploy.js upload <name> --expect <addr>`. On mainnet the tool refuses a build that doesn't match `release-hashes.json`.
- [ ] After each mainnet upload, its address is written into `MAINNET_PINNED` in `deploy/lib.js` (one line, reviewed); the payment token goes in `TOKEN_PINS.mainnet` with its code hash. On mainnet the tool then refuses any other Ink, Shop, Stories, sponsor, multisig, admin or token address, and `wire` / `wire-stories` check each contract's code hash on chain. The override, `--i-understand-this-address-is-not-pinned=<role>`, lets through only the role it names (audit L-8).

## 3. Admin

- [ ] Admin is handed over in **two steps**: the current admin runs `set-admin` (proposes), then the new admin runs `accept-admin` with its own key. Check `status` shows the new admin before putting the old key away.
- [ ] Make the admin a **multisig wallet, 2 of 3**, set up before mainnet: two hardware keys held by different people, and **one spare key kept offline** (on paper or a hardware wallet in a separate place, never used day to day). Losing any one key then loses nothing. Admin checks ask the admin address to authorize, so a multisig smart-contract wallet works. Rehearse it on testnet first: a full admin action, the two-step handover to the multisig, and replacing one lost signer with the spare.
- [ ] The admin key is not the treasury or founder key.
- [ ] Admin actions are signed only through the deploy script, which checks the chain id and only talks to listed mainnet nodes.
- [ ] **Multisig signing with the deploy tool** (any number of signers, each on their own computer):
  1. Anyone runs the admin command with `--prepare tx.json` (for example `node deploy/deploy.js pause stories --contract <addr> --admin <multisig> --prepare pause.json`). No key is asked; the unsigned transaction is written to the file. Add `--payer <addr>` if a separate wallet pays the mana.
  2. Each signer runs `node deploy/deploy.js cosign pause.json` on their own computer. It decodes and shows every operation from that computer's own copy of the contracts, refuses anything that doesn't match, asks them to type SIGN, and adds one signature at the hidden key prompt.
  3. Anyone runs `node deploy/deploy.js submit pause.json [other signed copies...]`. It joins the signatures, dry-runs and sends after SEND.
  **What the prepared file takes from the node** (audit I-19, I-20): when it is prepared, the multisig's signer list and threshold (the `needs` shown to every signer, a guide; the chain decides), the payer's next nonce (`submit` reads it again, L-11), and for `promo-new` the next campaign id (if someone else takes that id first, `submit`'s dry run fails and nothing is sent; prepare it again). Prepare through your own node.
  **Final edits** with the multisig as finalizer: each batch of up to 50 parts is its own cosigned transaction (audit I-9).
  **Takedowns:** hide the part with the moderator key first (`node deploy/deploy.js hide --actor <moderator> ...`), then prepare `takedown`. A hidden part can't be edited, so its writer can't make the prepared takedown fail by editing it before the quorum signs (audit L-3).
  A signed file never expires on its own: whoever holds it can send it until its nonce is used. **To cancel one**, send any other transaction from the account whose nonce it uses (the payee if the file names one, else the payer; for the multisig, any small multisig transaction cosigned by the quorum, such as a pause and unpause prepared together). Submit through your own node at once; `submit` reads the account's next nonce again and refuses a file whose nonce is not it (audit L-11). The multisig's own `set_signers` additionally needs every new signer's signature (audit L-16), and `submit` refuses a contract wallet other than the multisig as payer (audit H-1).
- [ ] **Rehearse on testnet with the real multisig before mainnet:** an emergency pause of each contract (once with the multisig paying, once with a separate mana payer), the two-step handover to the multisig (`set-admin`, then `accept-admin --prepare`), and replacing a lost signer with the spare.

## 4. Treasury and founder

- [ ] Hardware wallets, separate from the admin.
- [ ] Their addresses are typed into `wire` and `wire-stories` by hand on mainnet (the script requires `--treasury` and `--founder`) and double-checked against a second source.

## 5. Moderator (copy checker)

- [ ] A fresh key from `node deploy/deploy.js new-moderator-key`, used for nothing else (it prints only to a terminal, never into a file or pipe). It can only hide and unhide parts, add notes and clear a story's summary. It can't take a part down or delete a part's text, touch Ink or change settings.
- [ ] Stored only as the `MODERATOR_WIF` **environment secret** of the `copy-checker` environment (Settings > Environments > copy-checker), with "Deployment branches" limited to `main`. Only the checker's apply job runs in that environment; the job that searches the web never has the key. Delete any repository-level `MODERATOR_WIF` secret: every branch can read those.
- [ ] `CHECKER_STATE_KEY` (a random text of at least 32 characters from a password manager) is also an **environment secret** of `copy-checker`. It seals the checker's saved progress; without it the checker only reports and the run fails so GitHub emails you.
- [ ] The search keys (`GOOGLE_BOOKS_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY`) are **repository secrets**, because the search job has no environment.
- [ ] `main` is protected (Settings > Branches): changes only through a pull request, no force pushes, no deletion, and the tests must pass. The moderator key is only as safe as who can push to `main`.
- [ ] Set the `EXPECTED_CHAIN_ID` variable if the checker uses a node other than the Foundation testnet or api.koinos.io.
- [ ] If it leaks: set a new moderator with `set-moderation` (admin), then replace the secret.

## 5b. Mana sponsor

- [ ] A fresh wallet used for nothing else, its recovery phrase on paper (like the contract keys). Per network: never the same sponsor key on testnet and mainnet.
- [ ] Uploaded with `node deploy/deploy.js upload sponsor --expect <addr>`, which turns on only the "decides when this wallet pays" flag. `status --sponsor <addr>` must show `call false, pay true, upload false`.
- [ ] Settings only with `sponsor-config` and that wallet's key. Keep KOIN in it only for mana; it isn't a treasury.
- [ ] If it leaks: move its KOIN out at once (Kondor, like any wallet), switch it off (`sponsor-config ... --disable`), remove its address from `web/src/config.js`, and set up a new one. The leaked key can't touch Ink, Shop or Stories or anyone's tokens.

## 6. If a key is lost or leaks

| Key | Do this |
|---|---|
| Admin | Once a handover has been accepted, the contract key is no longer admin and cannot propose a new one: every admin check, `set-admin` included, needs the current admin's signature. The only way back is a **code re-upload with the contract key**: upload a reviewed recovery build that lets a new admin be set, have the new admin accept, then upload the normal release build again with its recorded sha256. If the contract key is also gone, admin cannot be recovered. This is why the admin should be a 2-of-3 multisig with a spare key offline (section 3): a lost signer is replaced by the other two, with no upload |
| Contract key | Nobody else can upload, so the code stays as it is. Plan a migration to a new contract address if an upgrade is ever needed |
| Contract key leaked | Treat as critical: the holder can replace the code. Pause the contract with its admin (`node deploy/deploy.js pause ink\|shop\|stories --contract <addr> --admin <addr>`), warn users publicly, and stop sending payments to it |
| Treasury or founder | The Shop admin points payments at new addresses with `set_addresses` |
| Moderator | The Stories admin sets a new moderator |
| Shop or Ink must move to a new address | Not an admin action: Stories' Shop address and Shop's Ink address are set once (AB-050). It needs a reviewed code upload of the contract that points at it, with its contract key, as below |

### Replacing contract code on mainnet (the re-upload above, or a reviewed fix after launch)

The contract key is the only key that can do this, and the stored data (stories, memberships, balances, settings) is kept.

1. Build the reviewed code (`npx yarn@1.22.22 build:release` in the contract's folder) and record its sha256. Have a second person build the same commit and compare the hash.
2. Pause the contract with its admin first, if the admin still works: `node deploy/deploy.js pause ink|shop|stories --contract <contract address> --admin <admin address>` (with the mainnet flags).
3. Run, from the repository root:
   `node deploy/deploy.js upload ink|shop|stories --expect <contract address> --upgrade --network mainnet --i-understand-this-is-mainnet --i-understand-this-replaces-mainnet-code`
   (record the reviewed hash in `deploy/release-hashes.json` first; the tool refuses a build that doesn't match)
   The script stops on a sha256 mismatch, on an unlisted node, without both mainnet flags, or when the node can't say whether a contract is already there. It runs a dry run, then waits for you to type SEND.
4. For a lost admin: the recovery build lets a new admin be proposed. Propose and accept it (`set-admin`, `accept-admin`), then upload the normal release build again the same way, with its own recorded sha256.
5. Check `status`, unpause (`deploy.js unpause ...`), and publish what changed and why.

## 7. Before the mainnet upload

- [ ] Every box above is ticked.
- [x] [ADMIN_POWERS.md](ADMIN_POWERS.md) is published and linked from the site footer.
- [ ] `deploy/release-hashes.json` holds the reviewed release hashes, and `MAINNET_PINNED` the uploaded addresses.
- [ ] The mainnet payment token is checked before it is enabled: does it let Shop's transfer go through on the buyer's signature alone, or does it need an earlier approval? Either works with Shop; record which. Enable it before launch: after the Shop's first sale, a newly enabled token waits 7 days.
- [ ] A full rehearsal on testnet used the same key setup (hardware wallets, multisig admin, two-step admin handover).
