# What the SwarmTales admins and keys can do

SwarmTales runs on three Koinos contracts: **Ink** (the writing allowance), **Shop** (payments, memberships, promos) and **Stories** (the books and stories). This page lists, in plain words, everything a privileged key can do. It is meant to be public: if a power is not on this page, no key has it.

Last checked against the code: October 2026 (audit fixes AB-001 to AB-018).

## The keys

| Key | Held by | What it is |
|---|---|---|
| Ink contract key | Founder, offline | The key of the address Ink was uploaded to |
| Shop contract key | Founder, offline | The key of the address Shop was uploaded to |
| Stories contract key | Founder, offline | The key of the address Stories was uploaded to |
| Admin (one per contract) | Founder | Runs day-to-day settings. Can be a multisig wallet |
| Moderator | The automated copy checker | Can only hide, unhide and add source notes |
| Treasury, founder | Founder | Only receive payments. They have no powers in the contracts |

## Contract keys: the strongest power

Each contract key can **upload new code to its contract's address**. New code can do anything that code can do, including changing balances. This is how Koinos contracts are upgraded; there is no proxy and no delay.

- Strangers cannot upload: the upload overrides are off, so only that address's own key can replace the code.
- Handing admin to another wallet does **not** take this power away.
- Every upload is a public transaction. Released builds are listed with their sha256 so anyone can compare.

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
- **Promo campaigns:** turn promos on or off, create campaigns of **any size**, change their budget, daily cap and end time, and add single-use link keys. Promo Ink is free Ink for whoever holds a link the admin made.
- Set the **Ink and Stories contract addresses** Shop works with.
- **Pause** purchases, claims, promos and story fees.
- **Propose a new admin** (two steps, as above).

The Shop admin **cannot** take back a payment that has already been split, or send the stablecoin anywhere except the buyer's own payment to the treasury and founder.

## Stories admin

- **Moderation:**
  - Hide or unhide any part, at any stage.
  - **Take a part down for good:** its text is cleared from contract storage and no Ink is refunded. Each takedown is a strike against whoever wrote the live text: the writer, or the opener, editor or finalizer who last added or replaced words in the part. An edit that only deletes text does not move the strike. The admin may name the other wallet instead, but only the part's writer or that current owner. At the strike limit the wallet is blocked.
  - Block or unblock a wallet from opening, writing and reporting.
  - Set the moderator key, how many writer reports hide a part (1 to 20) and the strike limit. The strike limit starts at 5; the admin can change it from 1 to 20 at any time with `set-moderation`. The testnet contract has 3 saved, so after its next upgrade run `set-moderation` with `--strikes 5`.
- **Terms of Use:** publish a new version. Every new part must then accept it.
- **Finishing a book:** take over the final edit when the opener asked, or has been inactive for the set number of days. In that final edit the admin can lightly edit text (within the same small allowance any finalizer has; the change is recorded on the part) and remove parts. After a takedown in a finished book, publish a replacement PDF.
- **Settings:** categories, the per-part size cap, the open-project limit and price doubling, the shortest new text, archive and inactivity days. Each has fixed bounds in the code.
- Set the **Ink and Shop contract addresses** Stories works with.
- **Pause** every write except admin settings.
- **Propose a new admin** (two steps, as above).

The Stories admin **cannot** mint or burn Ink, refund outside the rules, or finalize a story outside the admin-finalize rule.

**For openers and editors:** When you remove a writer, revoke the invite link they used and send a new one to everyone else.

## The moderator (copy checker)

The moderator key can hide and unhide parts and add a public "this text also appears in…" note. It cannot remove text, touch Ink, or change any setting. It runs in GitHub Actions and signs only for the chain id it expects.

## How you can check

- Every admin action is a transaction on the public Koinos chain, and most emit a public event (prices, addresses and fee changes are visible in the contract's stored config).
- The source for all three contracts is in this repository. Compare a deployed contract's wasm sha256 with the release build.
