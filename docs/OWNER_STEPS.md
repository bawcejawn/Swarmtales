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
allowed, and that `MODERATOR_WIF` is listed there as an environment secret.

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

Follow `docs/TESTNET_DEPLOY.md` (about 30 minutes). Send me the three new contract addresses;
I switch the website to them. Then update the GitHub variable `STORIES_ADDRESS`
(https://github.com/bawcejawn/Swarmtales/settings/variables/actions) to the new Stories address.

---

## C. Live checks on testnet (after B, with the website updated)

### C1. What Kondor shows (audit M-9)
1. In Kondor (testnet), on the site: **Membership** → buy a pack (you need an active Writer month).
2. When Kondor's confirm window opens, look at it before approving. It should list **two**
   operations by name: `approve` (spender = the Shop, value) and `buy_pack` with `max_price`
   and `min_ink` shown as readable fields, not just raw bytes.
3. Take a screenshot and send it to me. Approve or reject; either is fine for the check.

### C2. The mainnet stablecoin's authority rule (audit C1-01)
I'll do the reading part: I check vUSDT's contract on mainnet to see whether its `transfer` accepts
the payer's signature alone or needs an earlier `approve`. The site always sends an approve first,
so both work. Before mainnet you only confirm the address I give you is the vUSDT you intend.

### C3. Multisig emergency pause (audit M-12) — once you've chosen the multisig wallet
1. Create the 2-of-3 multisig wallet on **testnet** first, with the same three signers you'll use on
   mainnet.
2. Make it the admin of the testnet Stories:
   `node deploy/deploy.js set-admin stories --contract $STORIES --admin <multisig address> --from $ADMIN`
   then `node deploy/deploy.js accept-admin stories --contract $STORIES --admin <multisig address> --prepare accept.json`,
   and have two signers each run `node deploy/deploy.js cosign accept.json`, then
   `node deploy/deploy.js submit accept.json`.
3. Rehearse a pause the same way: `pause stories ... --prepare pause.json` → two `cosign` → `submit`.
   Then the unpause.
4. Send me the transaction ids.

### C4. KOIN Vault (audit W1-04, W1-05) — on mainnet, after launch
Vault works only on mainnet. On launch day, make one small purchase with Vault on your phone and
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
- [ ] The pull request into `main` is merged (after the re-audit passes).
- [ ] **Separate keys on hardware wallets**: the Ink, Shop and Stories contract keys (new, mainnet
      only), treasury, founder; recovery phrases on paper in two places (`docs/KEY_CUSTODY.md`).
- [ ] **2-of-3 multisig admin** chosen and rehearsed on testnet (C3).
- [ ] **Release fingerprints**: two people build the merged commit and get the same three hashes;
      I put them in `deploy/release-hashes.json` and the README (published).
- [ ] **Domain** bought and set up (M-7): DNS, Settings → Pages → custom domain + Enforce HTTPS, then
      `SITE.url` in `web/src/config.js`.
- [ ] **Copyright contact email** on the new domain (for reports on finished books and the DMCA
      agent registration, $6, which you planned before mainnet).
- [ ] **Mainnet payment token** confirmed (vUSDT address, C2).
- [ ] Live checks C1 and C3 done.
- [ ] On upload day (I'll walk you through each command): upload the three contracts, fill
      `MAINNET_PINNED` in `deploy/lib.js`, hand admin to the multisig, wire, enable vUSDT and set
      prices **before** the first sale (so it's usable at once), set Terms and the moderator, then
      compare each contract's code hash with the release hashes and read back every setting.
