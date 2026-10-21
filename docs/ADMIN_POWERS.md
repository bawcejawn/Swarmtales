# What the SwarmTales admins and keys can do

SwarmTales runs on three Koinos contracts: **Ink** (the writing allowance), **Shop** (payments, memberships, promos) and **Stories** (the books and stories). This page lists, in plain words, everything a privileged key can do. It is meant to be public: if a power is not on this page, no key has it.

Last checked against the code: October 2026 (audit fixes AB-001 to AB-058).

## The keys

| Key | Held by | What it is |
|---|---|---|
| Ink contract key | Founder, offline | The key of the address Ink was uploaded to |
| Shop contract key | Founder, offline | The key of the address Shop was uploaded to |
| Stories contract key | Founder, offline | The key of the address Stories was uploaded to |
| Admin (one per contract) | Founder | Runs day-to-day settings. Can be a multisig wallet |
| Moderator | The automated copy checker | Can only hide and unhide parts, add source notes and clear a story's summary |
| Treasury, founder | Founder | Only receive payments. They have no powers in the contracts |

## Contract keys: the strongest power

Each contract key can **upload new code to its contract's address**. New code can do anything that code can do, including changing balances. This is how Koinos contracts are upgraded; there is no proxy and no delay.

- Strangers cannot upload: the upload overrides are off, so only that address's own key can replace the code.
- Handing admin to another wallet does **not** take this power away.
- Every upload is a public transaction. Released builds are listed with their sha256 so anyone can compare.
- It is also the only way to move to a new Shop or Ink: those addresses are set once (below), so a move means uploading reviewed code that changes them, with the contract key.

## Ink admin

- Approve or remove **minters** (contracts that may create Ink) and the reasons each may use. Shop may mint for purchases, memberships, starter Ink and promos; Stories may mint refunds only.
  - Because the admin can approve **any** contract as a minter, including one it wrote, the Ink admin can in effect create any amount of Ink.
- Approve or remove **burners** (contracts that may use up Ink). A burn also needs the Ink owner's own signature.
- **Pause** all minting and burning.
- **Propose a new admin.** The new admin must accept with its own signature before anything changes.

The Ink admin **cannot** move or burn anyone's Ink directly. Ink cannot be transferred by anyone.

## Shop admin

- Set **prices** for each item and payment token. A buyer's purchase names the most they agreed to pay; a higher price is refused, so a price change never surprises someone mid-purchase.
- Turn **payment tokens** on or off.
- Set the **treasury and founder addresses** that receive payments, and the **founder fee** (0% to 5%, checked again on every payment). Neither address can be the Shop itself.
- Set the **Ink amounts** for a Writer month, packs and starter Ink.
- **Promo campaigns:** turn promos on or off, create campaigns of **any size**, change their budget, daily cap and end time, switch a campaign off, and add single-use link keys. Each wallet may claim each campaign once. Promo Ink is free Ink for whoever holds a link the admin made. On mainnet the admin uses `deploy.js promo-new`, `promo-on`, `promo-off` and `promo-end`, which run the same dry run and SEND confirmation as every other admin command.
- Set the **Stories contract address** Shop works with.
- The **Ink address is set once**, when Shop is wired, and can never be changed or cleared afterwards. Every purchase calls Ink inside the buyer's own signed transaction, so an "Ink" the admin swapped in would act with the buyer's signature. Moving to a new Ink needs a reviewed code upload with the Shop contract key.
- **Pause** purchases, claims, promos and story fees (`deploy.js pause shop`).
- **Propose a new admin** (two steps, as above).

The Shop admin **cannot** take back a payment that has already been split, or send the stablecoin anywhere except the buyer's own payment to the treasury and founder.

## Stories admin

- **Moderation:**
  - Hide or unhide any part, at any stage. A part the admin hid can be unhidden only by the admin or the moderator. The story's opener or an editor can restore a part the copy checker or writer reports hid, but not one the admin hid. Removing a part the admin or the checker hid refunds nothing.
  - **Take a part down for good:** its text is cleared from contract storage and no Ink is refunded. A takedown also wipes every kept version of the part, whether the part was still live or already removed, and its history can no longer be read. A part nobody else changed is a strike against its writer. Once anyone else changed it (a paid change with `revise_part`, the finalizer's edit, or a citation someone else set; saving the text or the citation unchanged is not a change), even by one letter or only by cutting words, the contract does not pick: the admin must name who gets the strike (the writer or any wallet that changed the part) or choose no strike. Every change to a part's text, the writer's own edits included, is kept as a version naming who made it. `deploy.js takedown` prints the writer, who last edited the part, every wallet the contract recorded as changing it (citation-only ones too), the live text and every kept version in full first, and stops until `--strike` or `--no-strike` is given. The admin cannot strike a wallet that never changed the part. At the strike limit the wallet is blocked.
  - Block or unblock a wallet from opening, writing, editing, changing and reporting, setting a citation (it may still clear one), restoring a hidden part and renaming a story it opened, and from making text changes in a final edit.
  - Clear a story's summary ("the story so far"), with `deploy.js clear-summary`. The moderator can too. This works while Stories is paused.
  - Set the moderator key, how many writer reports hide a part (1 to 20) and the strike limit. The strike limit starts at 5; the admin can change it from 1 to 20 at any time with `set-moderation`. The testnet contract has 3 saved, so after its next upgrade run `set-moderation` with `--strikes 5`.
- **Terms of Use:** publish a new version. Every new part must then accept it.
- **Finishing a book:** take over the final edit when the opener asked, or has been inactive for the set number of days. In that final edit the admin can lightly edit text (within the same small allowance any finalizer has; the change is kept as a version and recorded on the part, so the admin can be named for a strike like any other wallet that changed it) and remove parts. After a takedown in a finished book, publish a replacement PDF.
- **Settings:** categories, the per-part size cap, the open-project limit and price doubling, the shortest new text, archive and inactivity days. Each has fixed bounds in the code.
- The **Ink and Shop addresses are set once**, when Stories is wired, and can never be changed afterwards. Pointing Stories at another Ink contract and back would let refunds create real Ink. Stories calls the Shop inside openers' and writers' own signed transactions, so a Shop the admin swapped in would act with their signatures. A future Shop move means a reviewed code upload with the Stories contract key; `deploy.js wire` can't do it.
- **Pause** every write except admin settings and moderation (hiding, takedowns, clearing a summary), with `deploy.js pause stories`. Summaries, citations and an opener's restore of a hidden part stop too.
- **Propose a new admin** (two steps, as above).

The Stories admin **cannot** mint or burn Ink, refund outside the rules, or finalize a story outside the admin-finalize rule.

**For openers and editors:** When you remove a writer, revoke the invite link they used and send a new one to everyone else.

## The moderator (copy checker)

The moderator key can hide and unhide parts, add a public "this text also appears in…" note, and clear any story's summary ("the story so far"), even while Stories is paused. It can't take a part down or delete a part's text, write a summary of its own, touch Ink, or change any setting. It runs in GitHub Actions and signs only for the chain id it expects.

## How you can check

- Every admin action is a transaction on the public Koinos chain, and most emit a public event (prices, addresses and fee changes are visible in the contract's stored config).
- The source for all three contracts is in this repository. Compare a deployed contract's wasm sha256 with the release build.
