# Wave 3: editions, the Reader's Cut and weekly prompts

Wave 3 builds on Wave 2 (PR #29). It adds one new contract (**Editions**), one small Stories change
(`surviving_sum`) and website features. Like Wave 2, the contract work needs the follow-up review and a
testnet run before mainnet.

## What other platforms get wrong, and what SwarmTales does

| Problem elsewhere | What SwarmTales does |
|---|---|
| Collaborative writers get no lasting credit or proof they wrote a book | **First Edition** (opener) and **Contributor Edition** (each writer whose surviving text reaches the story's minimum): free keepsakes in the writer's wallet that can't be sold or moved |
| Writers of shared works rarely see money from them, or see it only through opaque payouts | **Collector's Editions** for readers. The split happens on the blockchain at the moment of sale: 80% to the book's writers by surviving text, 20% to SwarmTales. Writers collect their share whenever they like (anyone can trigger it for them). Nobody, the admin included, can take it |
| NFT projects push scarcity, auctions, random rarity and resale royalties, and talk about value | Fixed price ($3 by default; the opener can choose $1 to $20), numbered, no cap, no auctions, no rarity, no resale royalty, no approvals for marketplaces, and clear wording: a keepsake, not an investment, and no copyright |
| An edit war overwrites someone's words for good | Every version is kept; paid overwrites stay possible (and get dearer each time), and readers can make a **Reader's Cut** from any versions they like, including parts the final edit left out |
| Prompts and writing events live on other sites | **This week's prompt**: SwarmTales opens a story from a prompt each week and features it on the home page and in Discover |

## Built in this branch

### Editions contract (`editions/`)
See `editions/README.md` and `editions/assembly/proto/editions.proto`. Key rules:
- Only finished books. Sales pause while a book waits for republishing after a takedown.
- A Collector's Edition costs the book's price in a payment token that is on in Shop (and past Shop's 7-day wait) and on in Editions with a price range. The buyer signs the most they agree to pay.
- Writers' earnings: `received × your surviving ÷ the book's surviving_sum`, minus what you were paid, and never more than the book's pot still holds. Works while paused.
- KCS-5 reads so wallets can show editions; metadata is on chain (`metadata_of`).
- Admin can: set Stories and Shop once, the treasury, payment tokens and their price range, the treasury share (at most 30%), the website link, pause sales and claims of writers' editions, hand over admin in two steps. Admin can't: move anyone's edition, take the writers' money, mint editions.

### Stories
`story.surviving_sum` (field 43): filled by the final edit, lowered by a later takedown. Test: `Stories.wave3.spec.ts`.

### Website
- **Reader's Cut** on finished books (`pages/readersCut.js`, `lib/readersCut.js`): choose any kept version of each part or bring back a removed one; download as EPUB, Word, Markdown or HTML, credited to whoever wrote the chosen words. Choices stay in the browser.
- **Editions panel** (`pages/editions.js`): claim, buy, collect earnings, and the opener's price. Hidden until `TESTNET_ADDRESSES.editions` (and later the mainnet address) is set in `web/src/config.js`.
- **This week's prompt** (`web/src/spotlight.js`, `pages/spotlight.js`).
- Terms v3: the licence covers the Reader's Cut, and §13 explains how editions and their sales work.

### Deploy tool
`upload editions`, `wire-editions`, `editions-token`, `editions-share`, `status --editions`; Editions is a pinned role with a release hash.

## Testnet steps (owner, after PR #29 is merged and this one is reviewed)

1. Upgrade testnet Stories with this branch's build (it adds `surviving_sum`), as in the Wave 2 step.
2. Make a fresh wallet for Editions in Kondor (testnet), send it a few tKOIN for mana, then:
   ```powershell
   node deploy/deploy.js upload editions --expect <editions wallet>
   node deploy/deploy.js wire-editions --admin <editions wallet> --editions <editions wallet> --stories 1Ebsy7ERirZWZwAio8Jz1zueuxQwNfKisR --shop 13i2g8x9CxKXhuo3EiPbUE6P5G5QDRgqwQ --treasury 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6 --site https://bawcejawn.github.io/Swarmtales
   node deploy/deploy.js editions-token --admin <editions wallet> --editions <editions wallet> --token 1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju --default 3 --min 1 --max 20
   node deploy/deploy.js set-admin editions --contract <editions wallet> --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6
   node deploy/deploy.js accept-admin editions --contract <editions wallet> --admin 18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6
   ```
   (On testnet the prices are in tKOIN, so "3" means 3 tKOIN.)
3. Send me the Editions address; I set it in `web/src/config.js`.
4. Finish a short test story, buy one Collector's Edition, claim the writer editions, and collect earnings once. This proves the payment token lets a contract pay out what it holds.

## Weekly prompts (owner)

Open each prompt story from a SwarmTales wallet on the site (the prompt is the first part). Send me the story numbers and start dates; I add them to `web/src/spotlight.js`. Openings can be done a month at a time.

## Still open

- **Display names** (waiting for Carl's answer in the checklist).
- The mana sponsor doesn't pay for Editions calls (its contract only knows Ink, Shop and Stories). Readers buying an edition pay their own small mana fee. A later sponsor update can add Editions.
- A collectible Reader's Cut (an edition of a reader's own cut) is possible later.
