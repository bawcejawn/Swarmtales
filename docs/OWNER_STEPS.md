# Owner steps after the 2026-10 audit fixes

Each step is done in a browser (GitHub, Kondor) or in PowerShell. Nothing here needs a private key
except where the deploy tool asks for one at its hidden prompt.

Order: **A** (GitHub settings, 10 minutes) → **B** (fresh testnet deploy, `docs/TESTNET_DEPLOY.md`)
→ **C** (live checks on testnet) → **D** (old audit ledger) → **E** (before mainnet).

---

## A. GitHub settings

### A1. The checker's state key (new environment secret)

1. Make a random password of at least 32 characters. Any password manager's "generate" button
   works (choose 40 characters). Don't reuse one.
2. Open https://github.com/bawcejawn/Swarmtales/settings/environments
3. Click **copy-checker**.
4. Under **Environment secrets**, click **Add environment secret**.
5. Name: `CHECKER_STATE_KEY` · Value: the password · **Add secret**.

While you're on that page, check that **Deployment branches and tags** says only `main` is
allowed.

### A1b. The moderator key (`MODERATOR_WIF`)

The checker signs its hides with this key, and it must be an **environment** secret of
`copy-checker`. If it isn't listed there, make a fresh one (testnet is being reset anyway, so the
fresh deploy simply uses the new moderator):

1. In PowerShell, in `C:\swarmtales`:
   ```powershell
   node deploy/deploy.js new-moderator-key
   ```
   It prints a **moderator address** (public, safe to share) and a **private key** once.
2. Copy the **address** into a note: you need it in the testnet deploy (Step 6) and you can send
   it to me.
3. On the `copy-checker` environment page → **Add environment secret** → Name `MODERATOR_WIF`,
   Value: the **private key** → **Add secret**.
4. Close PowerShell and clear the clipboard (Win+V → Clear all). Don't save the key anywhere else:
   if it's ever lost, you make a new one the same way and point the contract at it with
   `set-moderation`.
5. If `MODERATOR_WIF` also exists under **Repository secrets** (A2), delete that copy.

### A2. Search keys must be repository secrets

The search step no longer runs inside the `copy-checker` environment (so it never sees the
moderator key), so it can only read **repository** secrets.

1. Open https://github.com/bawcejawn/Swarmtales/settings/secrets/actions
2. Under **Repository secrets** you should see `GOOGLE_BOOKS_KEY` and `TAVILY_API_KEY` (and
   `BRAVE_API_KEY` only if you have one).
3. If a search key is listed only under the **copy-checker** environment instead: copy the key
   from where you got it (Google Cloud console / Tavily dashboard), add it here with **New
   repository secret** under the same name, then delete the environment copy.
4. If `MODERATOR_WIF` appears under **Repository secrets**, delete it there (keep only the
   environment one).

### A3. Branch protection on `main`

1. Open https://github.com/bawcejawn/Swarmtales/settings/branches
2. **Add classic branch protection rule** (or "Add rule").
3. Branch name pattern: `main`
4. Tick **Require a pull request before merging**. Under it, set **Required approvals** to `0`
   (you're the only maintainer; the rule still forces every change through a pull request).
5. Tick **Require status checks to pass before merging** → search for and add **build** (the
   website/checker test job). Tick **Require branches to be up to date before merging**.
6. Tick **Do not allow bypassing the above settings**.
7. Leave **Allow force pushes** and **Allow deletions** unticked.
8. **Create**.

Why: the moderator key is only released to runs on `main`, so whoever can push to `main`
controls it. With this rule, nothing reaches `main` without a pull request that passes the tests.

---

## B. Fresh testnet deploy

**Done 23 October 2026.** Ink `1JXZiYaymCCG61YtfBF4L5bnbxem11rTFk`, Shop
`13i2g8x9CxKXhuo3EiPbUE6P5G5QDRgqwQ`, Stories `1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR`, moderator
`1AaN68ttQtmhG3HQpGoQr2iuSsYiTxbEsD`; the website now points at them.

On the day pull request #25 is merged, also update the GitHub variable `STORIES_ADDRESS`
(https://github.com/bawcejawn/Swarmtales/settings/variables/actions) to
`1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR`, so the copy checker on `main` and the new contracts
switch together.

---

## C. Live checks on testnet (after B)

The public site only changes once pull request #25 is merged, so run the new site on your own PC:

```powershell
cd C:\swarmtales
git pull
cd web
npm.cmd ci
npm.cmd run build
npm.cmd run preview
```

Open http://127.0.0.1:4173/ in the browser where Kondor is installed. Leave PowerShell open while you test; Ctrl+C
stops it.

### C1. What Kondor shows (audit M-9)
1. In Kondor (testnet), on the local site: **Membership** → buy a Writer month first (2 tKOIN), then
   buy a **Small** pack (0.5 tKOIN).
2. When Kondor's confirm window opens, look at it before approving. It should list **two**
   operations by name: `approve` (spender = the Shop, value) and `buy_pack` with `max_price`
   and `min_ink` shown as readable fields, not just raw bytes.
3. Take a screenshot and send it to me. Approve or reject; either is fine for the check.

**If the Kondor window keeps spinning or asking to refresh (23 Oct 2026: it does):** Kondor's
built-in testnet is the old Harbinger chain. On the Koinos Foundation testnet it has no "mana
meter" contract, and its default "Optimize mana" step fails. In the Kondor window click
**Advanced**, untick **Optimize mana**, then press the refresh icon next to **Events**. If it still
loops, the check moves to mainnet: on launch day, the first small purchase with Kondor is the M-9
check (Kondor's source shows it uses the ABIs the site sends, `optsSend.abis`).

The **Test wallet** signs without asking, by design. It exists only on testnet: on a mainnet build
it is never offered and any saved test key is deleted.

### C2. The mainnet stablecoin (audit C1-01)
vUSDT is `12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh` (confirmed by the owner, 23 Oct 2026; same as the
README). Whether its `transfer` needs an earlier `approve` doesn't matter for the site, which
always sends one. The launch-day test purchase in vUSDT proves Shop can take payment with it.

### C3. Multisig emergency pause (audit M-12) — after you make the signer wallets
Our own multisig contract (`multisig/`, 23 tests) is written; there is no audited ready-made one on
Koinos. When you're ready, make **3 signer wallets** (each on its own seed, one kept offline as the
spare) and **1 fresh wallet** to become the multisig, and send me the four **public** addresses.
I then add the one-transaction upload + setup command and the rehearsal steps: handover of the
testnet Stories admin to the multisig, a pause and unpause with two signers, and replacing a signer.

### C5. Mana sponsor (pays users' mana)
Live on testnet now with a test sponsor wallet (`12eQDZUBAaoScqFTW4zSy4ziAoxctnCxyS`). To see it:
in the local site (C1), use **Create a test wallet** and don't send it any tKOIN; open a story,
press **Bookmark**, then **Save to my wallet**. It works because the sponsor pays the mana.

For mainnet you make your **own** sponsor wallet (a fresh Kondor account, recovery phrase on
paper), then on upload day:
```powershell
node deploy/deploy.js upload sponsor --expect <sponsor address> --network mainnet --i-understand-this-is-mainnet
node deploy/deploy.js sponsor-config --sponsor <sponsor address> --ink <ink> --shop <shop> --stories <stories> --tokens 12VoHz41a4HtfiyhTWbg9RXqGMRbYk6pXh --per-tx 4 --per-account 20 --per-day 300 --network mainnet --i-understand-this-is-mainnet
```
Send it KOIN with Kondor (its mana is its KOIN balance and refills over about 5 days). Switch it
off with the same `sponsor-config` line plus `--disable`. Its key can only change its settings and
move its own KOIN.

### C4. KOIN Vault (audit W1-04, W1-05) — on mainnet, after launch
Rex (KOIN Vault) said Vault should work with the site (23 Oct 2026); the launch-day purchase confirms it. Vault works only on mainnet. On launch day, make one small purchase with Vault on your phone and
tell me whether it said "Done" and whether anything looked odd. If Vault refuses the new POST
status call, the site falls back to the old way by itself.

---

## D. The old audit ledger (audit section 6.7)

The audit says an old Audit Bot commit still shows the earlier audit ledger publicly, but doesn't
give the link, and it isn't in this repository's branches or pull requests. So:

1. Ask the auditor (Repo Lense) for the exact URL of that commit or file when you send the
   re-audit request.
2. Then, depending on where it is:
   - **In a repository you own** (for example an Audit Bot working repo): open it on GitHub →
     Settings → General → Danger Zone → **Change visibility** to private, or **Delete this
     repository** if you don't need it.
   - **A commit inside `bawcejawn/Swarmtales`** (for example from an old pull request): send me the
     commit id. Deleting a branch doesn't remove a commit GitHub still shows by its id; I'll write
     the request to GitHub Support ("remove cached views of a commit"), which you send from
     https://support.github.com.
   - **Someone else's repository:** ask them to remove it.
3. While you're there: delete the merged branch `audit-fixes-2`
   (https://github.com/bawcejawn/Swarmtales/branches → trash icon).

The ledger only lists old, fixed weaknesses, so this is tidy-up, not an emergency.

---

## E. Before mainnet (your own rules, plus the audit's)

Mainnet goes ahead only when **every** box is ticked:

- [ ] **Re-audit done**: the auditor reviewed `audit-2026-10-fixes` and every finding is closed
      (send them `AUDIT_SCOPE.md` and `docs/AUDIT_2026_10_STATUS.md`).
- [ ] The pull request into `main` is merged (after the re-audit passes), and the same day
      `STORIES_ADDRESS` is set to `1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR` (section B).
- [ ] **Separate keys on hardware wallets**: the Ink, Shop and Stories contract keys (new, mainnet
      only), treasury, founder; recovery phrases on paper in two places (`docs/KEY_CUSTODY.md`).
- [ ] **2-of-3 multisig admin**: the multisig contract re-audited, then rehearsed on testnet (C3).
- [ ] **Mana sponsor** re-audited; your mainnet sponsor wallet made and loaded with KOIN (C5).
- [ ] **A working mainnet node** for the site, the deploy tool and the checker (api.koinos.io is
      down): a public node someone else runs, or one of yours behind a tunnel. Send me the URL.
- [ ] **Release fingerprints**: two people build the merged commit and get the same hash for every contract (Ink, Shop, Stories, sponsor, multisig);
      I put them in `deploy/release-hashes.json` and the README (published).
- [ ] **Domain** bought and set up (M-7): DNS, Settings → Pages → custom domain + Enforce HTTPS, then
      `SITE.url` in `web/src/config.js`.
- [ ] **Copyright contact email** on the new domain (for reports on finished books and the DMCA
      agent registration, $6, which you planned before mainnet).
- [ ] **Mainnet payment token** confirmed (vUSDT address, C2).
- [ ] Live checks C1, C3 and C5 done.
- [ ] On upload day (I'll walk you through each command): upload the three contracts, fill
      `MAINNET_PINNED` in `deploy/lib.js`, hand admin to the multisig, wire, enable vUSDT and set
      prices **before** the first sale (so it's usable at once), set Terms and the moderator, then
      compare each contract's code hash with the release hashes and read back every setting.
