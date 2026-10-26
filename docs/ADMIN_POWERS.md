# What the SwarmTales admins and keys can do

SwarmTales runs on three Koinos contracts: **Ink** (the writing allowance), **Shop** (payments, memberships, promos) and **Stories** (the books and stories). This page lists, in plain words, everything a privileged key can do. It is public on purpose: if a power is not on this page, no key has it.

Last checked against the code: October 2026, after the 2026-10 mainnet audit fixes. The table in "What works at each stage" is mirrored by `stories/assembly/__tests__/Stories.status-table.spec.ts`: if the code and this page ever disagree, that test fails.

## The keys

| Key | Held by | What it is |
|---|---|---|
| Ink contract key | Founder, offline | The key of the address Ink was uploaded to |
| Shop contract key | Founder, offline | The key of the address Shop was uploaded to |
| Stories contract key | Founder, offline | The key of the address Stories was uploaded to |
| Admin (one per contract) | 2-of-3 multisig wallet on mainnet | Runs day-to-day settings |
| Moderator | The automated copy checker | Hides parts, unhides parts the admin didn't hide, writes source notes, clears summaries (details below) |
| Treasury, founder | Founder | Only receive payments. They have no powers in the contracts |
| Mana sponsor | Founder, offline | The wallet that pays users' mana (details below). It has no powers in Ink, Shop or Stories. Its settings change only with the deploy tool's `sponsor-config` on the computer that holds it; the website's admin page only shows that command and never asks a wallet for this key (audit L-17) |

One key per contract **per network**: a contract key used on testnet is never used on mainnet. The deploy tool refuses to reuse one.

## Contract keys: the strongest power

Each contract key can **upload new code to its contract's address**. New code can do anything code can do, including changing balances. This is how Koinos contracts are upgraded; there is no proxy and no delay.

- Strangers cannot upload: the upload overrides are off, so only that address's own key can replace the code.
- Handing admin to another wallet does **not** take this power away.
- Every upload is a public transaction. Release builds are pinned with their sha256 in `deploy/release-hashes.json`, and the deploy tool refuses a mainnet upload or wiring that doesn't match.
- It is the only way to move to a new Ink, Shop or Stories: those addresses are set once (below).

## Ink admin

- Approve or remove **minters** (contracts that may create Ink) and the reasons each may use. Shop may mint for purchases, memberships, starter Ink and promos; Stories may mint refunds only.
  - Because the admin can approve **any** contract as a minter, including one it wrote, the Ink admin can in effect create any amount of Ink.
- Approve or remove **burners** (contracts that may use up Ink). A burn also needs the Ink owner's signature on the transaction. Precisely: an approved burner can burn a wallet's Ink in any transaction that wallet signed and that reaches the burner. Today the only burner is Stories, which can only be called directly by a transaction, so another app's transaction can't reach it.
- **Pause** all minting and burning.
- **Propose a new admin.** The new admin must accept with its own signature before anything changes.

The Ink admin **cannot** move or burn anyone's Ink directly. Ink cannot be transferred by anyone.

## Shop admin

- Set **prices** for each item and payment token. Every purchase carries the buyer's two limits: the **most they pay** and the **least Ink they get**. If a price went up or an Ink amount went down after they looked, nothing is charged.
- Turn **payment tokens** on or off. Once the Shop has made its first sale, a token that is turned on can't be used for **7 days**, and the change is a public event, so anyone can check the token first. (Tokens set up before the first sale work at once; no buyer is exposed yet.) Turning a token off works at once. An enabled token's decimals and symbol can't be changed (turn it off first, which restarts the 7 days). A token that is turned off can be **removed** (`remove_asset`), which deletes its record and its prices and frees one of the 10 token slots (audit L-5).
- Set the **treasury and founder addresses** that receive payments, and the **founder fee** (0% to 5%, checked again on every payment). Neither can be the Shop itself.
- Set the **Ink amounts** for a Writer month, packs and starter Ink. Each change is a public event. A Writer term keeps the amount it started with.
- **Promo campaigns:** turn promos on or off, create campaigns of **any size**, change their budget, daily cap and end time, switch a campaign off, and add single-use link keys. Each wallet may claim each campaign once. Promo Ink is free Ink for whoever holds a link the admin made.
- The **Ink and Stories addresses are each set once**, when Shop is wired, and can never be changed or cleared afterwards. Both act inside buyers' and openers' own signed transactions, so a contract swapped in by the admin key would act with their signatures.
- **Pause** purchases, Writer Ink claims, promos and the open fee.
- **Propose a new admin** (two steps).

The Shop admin **cannot** take back a payment that has already been split, or send the stablecoin anywhere except the buyer's own payment to the treasury and founder. This holds **for an honest token**: the Shop calls the payment token's own code inside every buyer's signed purchase, and it checks the payment by asking that same token for balances, so a token's code is trusted, not checked. A Writer month that isn't claimed before the Writer term ends is forfeited; nobody can claim it later.

**Payment-token issuers are a trust assumption (audit H-3, L-6).** Whoever holds a listed token's upload key (for vUSDT, its issuer) can give that token new code at any time, at the same address. The Shop's 7-day wait protects the Shop's *record* of a token, not the token's code. New token code would run inside every purchase a buyer signs and could, for example, move the buyer's KOIN (KOIN accepts the buyer's signature at any call depth) or report a payment that never happened. What limits this:

- The website and the deploy tool only use tokens **pinned** with their address, symbol, decimals and **code hash** (`web/src/config.js` `PAYMENT_TOKENS`, `deploy/lib.js` `TOKEN_PINS`). Before showing a price or building a purchase the site reads the token's code hash from the chain and refuses a token whose code differs from its pin. The tool refuses to enable an address with no contract, or a token whose code differs from its pin; on mainnet it refuses any token that is not pinned.
- When an issuer upgrades a pinned token, purchases with it stop on the site until its new code is reviewed and the pin updated (a reviewed one-line change).
- SwarmTales launches with **one** payment token.

## Stories admin

- **Moderation:**
  - Hide or unhide any part, at any stage. A part the admin hid can be unhidden only by the admin. The admin can also take over a hide the checker or writer reports made, in one transaction.
  - **Take a part down for good:** its text and every kept version are cleared from contract storage and no Ink is refunded. The takedown names the text and version count the admin reviewed; if the part changed since, nothing happens. So with the multisig admin, the moderator key **hides the part first** (hidden parts can't be edited), then the signers review and sign the takedown; otherwise the writer could make each prepared takedown fail by editing the part (audit L-3). The deploy tool says so when the part isn't hidden. A part nobody else changed is a strike against its writer. Once anyone else changed it (a paid change, the finalizer's edit, or a citation someone else set), the admin must name who gets the strike (the writer or a wallet that changed it) or choose no strike. At the strike limit the wallet is blocked.
  - After a takedown in a finished book, publish a replacement book link and text hash. The contract does not recompute the hash; `deploy.js replace-pdf` computes it from the chain and shows it before signing.
  - **Block or unblock** a wallet. A blocked wallet can't open, write, edit, change or report text, join with an invite, revive a story, set a citation (it may clear one), restore a hidden part, rename its story, change editors or the allow-list, create invites, or make text changes or remove visible parts in a final edit. It may still remove its own parts, and a blocked finalizer may still remove hidden parts so the book can be finished.
  - Clear a story's summary. The moderator can too. This works while paused.
  - Set the moderator key, how many writer reports hide a part (1 to 20) and the strike limit (1 to 20, starts at 5).
- **Terms of Use:** publish a new version. Every new part, and every rewrite of one's own part, must then accept it.
- **Finishing a book:** take over the final edit when the opener asked, or has been inactive for the set number of days. Paused time doesn't count, and a take-over is refused while paused. In that final edit the admin can lightly edit text (the same small allowance any finalizer has, kept as a version, so the admin can be named for a strike like anyone else who changed it) and remove parts. With the multisig admin, **each** final-edit batch (at most 50 parts) is its own transaction needing the quorum, so a long Book takes many cosigned batches (audit I-9); plan the signers' time for it, or leave finishing to the opener where possible.
- **Settings**, each inside fixed bounds in the code: categories; the per-part size cap (100 to 6,000); the promo trial limit (0 to 5,000 characters per wallet); the open-project limit (1 to 10) and the price doubling (normal price for the first 1 to 10 projects, ceiling 1x to 1,024x); the shortest new text (1 to 200); archive days and inactivity days (30 to 365).
- The **Ink and Shop addresses are set once**, when Stories is wired.
- **Pause:** every user write stops, including bookmarks, and so do archiving and admin take-overs. The inactivity clocks stop too: paused time never makes a story archivable or open to a take-over. Moderation (hide, unhide, takedown, source notes, clearing a summary) and admin settings still work.
- **Propose a new admin** (two steps).

The Stories admin **cannot** mint or burn Ink, refund outside the rules, or finalize a story outside the admin-finalize rule.

**One text, once.** A new part can't repeat any text the story ever had, even text that was edited away, removed or taken down, and an edit or a paid change can't copy another part's text. A part may go back to its own earlier wording (for example its original, after a paid change).

**Hidden is not erased.** A hidden part is left out of the site and the book, but its text stays readable on the public chain until it is taken down. Text removed by its writer also stays readable in the part's kept versions.

**For openers and editors:** only the opener creates and revokes invite links. When you remove a writer, revoke the invite link they used and send a new one to everyone else. A removed writer can no longer edit their parts in your story, only remove them.

## The moderator (copy checker)

The moderator key can hide parts, take over a hide writer reports made for copying (it then counts as the checker's hide: removing the part refunds nothing and restoring it gives up the refund), unhide any part the admin didn't hide, add, replace or clear a part's public "this text also appears in…" note, and clear any story's summary, even while paused. It can't take a part down, delete text, touch Ink, or change any setting.

How the checker uses it: it hides a part only when a book that is provably older than the part contains its text; matches found only on the web get a note, never a hide. It never hides a part its opener restored. It signs in a separate step that re-checks every action on the chain; the step that searches the web never holds the key. It runs in GitHub Actions and signs only for the chain id it expects.

## The admin page

`#/admin` on the site lists every admin control in one place. It has no powers of its own: it only builds the same calls this page describes, and either asks the connected wallet to sign them or writes a prepared file for the multisig signers to check with `node deploy/deploy.js cosign` and send with `submit`. The contracts check every permission again.

## The mana sponsor

The sponsor wallet holds KOIN, and its mana pays for users' SwarmTales transactions (`sponsor/`). Its contract decides only one thing: whether this wallet pays for a given transaction. It pays only when the user signed it, every call is one of the listed Ink, Shop or Stories actions new users need (buying a membership or pack, claiming Writer or promo Ink, opening a story, writing, editing or removing one's own part, joining with an invite, saving a bookmark; audit M-A), or approves the Shop to take the user's own payment tokens, the transaction's mana limit is within the per-transaction cap (about 1 mana by default), and the daily caps aren't used up. It can't sign anything for a user, move anyone's tokens or Ink, or change anything in the three contracts. Its key can change its settings (on/off, caps, which contracts, actions and tokens) and move its own KOIN, like any wallet; settings only straight from a transaction it signed, never from contract code running inside one (audit L-17). If it is switched off or empty, everyone simply pays their own mana again.

What the sponsor's mana can still pay for, within the caps (audit L-13, L-14):

- **Other code in a sponsored transaction.** A user whose wallet is a contract wallet runs its own authorize code, and a listed payment token runs its own code, inside a transaction the sponsor pays for. The per-transaction cap (about 1 mana) bounds what that costs.
- **A burst of pending transactions.** The node doesn't count sponsored transactions still waiting for a block against the daily caps, so a burst can tie up the sponsor's free mana for about two minutes. Keep the sponsor's KOIN well above five times the daily cap; the website retries with the user's own mana when a sponsored transaction is refused, and the hourly sponsor alert (`.github/workflows/sponsor-alert.yml`) warns when the day's use passes 80% of the cap or the sponsor's mana falls below five times it.
- **Filling the day's cap.** Anyone can make new wallets, so a determined spammer can still use up the day's budget with listed actions; the alert above says so, and everyone then pays their own mana until 00:00 UTC.

## What works at each stage

Story stages: **Open** (taking new parts), **Locked** (full), **Editing** (the final edit), **Finished**, **Archived**. ✔ = allowed at that stage (other rules still apply), ✘ = refused because of the stage. "Paused" says whether it works while Stories is paused.

| Action | Who | Open | Locked | Editing | Finished | Archived | Paused |
|---|---|---|---|---|---|---|---|
| Write a new part (`contribute`) | writer | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Edit own part (`edit_segment`) | its writer | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Remove a part (`remove_segment`) | its writer; opener/editor for report hides | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Paid change (`revise_part`) | anyone who may write there | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Add to the pool (`top_up_fund`) | opener | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Archive (`archive_if_stale`) | anyone, after the quiet period | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Citation (`set_citation`) | writer, opener, editor | ✔ | ✔ | ✔ | ✘ | ✔ | ✘ |
| Report a part (`report_segment`) | any wallet | ✔ | ✔ | ✔ | ✘ | ✔ | ✘ |
| Restore a hidden part (`restore_segment`) | opener, editor | ✔ | ✔ | ✔ | ✘ | ✔ | ✘ |
| Settings, editors, allow-list (`update_story`, `set_editor`, `set_allowed`) | opener (allow-list: editors too) | ✔ | ✔ | ✔ | ✘ | ✔ | ✘ |
| Summary (`set_story_summary`) | opener, editor, current writer | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ (clearing by admin/moderator: ✔) |
| Create an invite, join with one | opener / invited wallet | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ |
| Revoke an invite | opener | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ |
| Ask the admin to finish (`request_admin_finalize`) | opener | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ |
| Close (`close_story`) | opener | when long enough | ✔ | ✘ | ✘ | ✘ | ✘ |
| Admin take-over (`admin_take_over`) | admin | when long enough | ✔ | ✔ (if the opener is finishing) | ✘ | ✘ | ✘ |
| Final edit, finish (`submit_final_batch`, `advance_final_cursor`, `finalize`) | finalizer (anyone may advance) | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ |
| Revive (`revive`) | opener, once | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ |
| Replace the book link (`replace_pdf`) | admin, after a takedown | ✘ | ✘ | ✘ | ✔ | ✘ | ✔ |
| Hide / unhide, source note | admin, moderator | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Take down | admin | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Save a reading place | any wallet | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ |

## How you can check

- Every admin action is a transaction on the public Koinos chain, and most emit a public event (payment tokens, Ink amounts and Shop addresses included).
- The source for all three contracts is in this repository. Compare each deployed contract's code hash with `deploy/release-hashes.json`.
