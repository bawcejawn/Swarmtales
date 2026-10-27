# Wave 2: what other platforms get right and wrong, and what SwarmTales does about it

Wave 1 (website only, PR #28) is live. Wave 2 adds contract features, so it ships as one reviewed
release: Stories changes here, then a short follow-up review, then testnet, then mainnet.

## Built in this branch

| Problem elsewhere | Who has it | What SwarmTales does now |
|---|---|---|
| Co-writers overwrite each other, or "drafts" pile up and need manual merging | Google Docs, Ellipsus | **Suggest a change** (`suggest_change`): anyone who may write proposes new wording for someone else's part, free. The writer sees a word-by-word diff and accepts (as their own edit; the part stays theirs) or declines with a reply. A suggestion based on an older version can't be accepted, so nothing is silently undone. |
| Editors' changes carry no credit; or credit is all-or-nothing | most collaborative editors | An accepted suggestion is kept as its own version naming who suggested it, and that wallet counts as having changed the part (so takedown strikes stay fair). Their AI label and citation carry over. |
| Paid changes are the only way to touch someone else's words | SwarmTales before | Suggestions are the free, polite path; paid changes (`revise_part`) stay for when a writer has gone quiet. |
| Spam suggestions bury a writer | comment systems | At most 5 waiting suggestions per part and one per wallet; a part keeps 20 at most and reuses closed slots, so nobody can use a part up. Moderation can clear any suggestion and wipe its text. |
| No place for the shared "bible" (characters, world, tone) | Docs, Ellipsus, Reedsy collaboration | **Notes for writers** in the story guide (up to 3,000 characters), kept by the opener and editors. |
| Finding co-writers happens off-site (Discord, Reddit) | all of them | **Looking for…** line (up to 140 characters). Stories that set it appear under **Seeking writers** in Discover, with the line on their card. |
| Writing games ("exquisite corpse") need a separate app | — | **Blind round**: the opener switches it on; while the story is open the site shows only the newest part, so each writer continues from it alone. The whole story is one click away and shown in full once finished. |
| Vague or one-sided Terms; unclear copyright process | Wattpad, Reedsy complaints | **Terms of Use version 3** (`web/public/terms/v3.md`): plain-English summary per section, the permission writers give (and what it does not cover: AI training), a full DMCA notice and counter-notice process, a stated repeat-infringer rule, collectibles and support payments, limits of liability, disputes. |

The sponsor now also pays for `suggest_change` and `accept_suggestion` (12 sponsored calls).

## Before the Terms go on chain (owner)

`web/public/terms/v3.md` has four blanks the deploy tool won't publish without:

- `{{OPERATOR}}`: the legal name of the company that runs SwarmTales. A dedicated LLC is best (it keeps you personally out of the Terms, the DMCA filing and any dispute). Some states (for example Wyoming, New Mexico, Delaware) don't publish owners' names; a registered-agent service gives the company a public address that isn't yours.
- `{{STATE}}`: the state whose law governs, normally the state where that LLC is formed.
- `{{CONTACT_EMAIL}}`: the address for notices, also used as `SITE.copyrightEmail`.
- `{{DMCA_AGENT}}`: the designated agent's name or title and postal address as registered with the U.S. Copyright Office (the $6 filing; a registered agent's address works).

Then have a lawyer read it once (this draft is careful but isn't legal advice), and publish it with
`node deploy/deploy.js set-terms --admin <admin> --stories <stories> --version 3 --file web/public/terms/v3.md --uri <site>/terms/v3.md`.
Writers accept version 3 the next time they write.

## Next in Wave 2 (not built yet)

1. **Book editions (the planned Books NFT).** A small separate contract that reads a finished
   story's `surviving_totals`: a First Edition for the opener and a Contributor Edition for each
   writer above the story's `contributor_edition_min`, claimable after `finalize`. Open decisions:
   free to claim or a small fee; transferable or not; a public collector's edition for readers
   (a gentle way to support the writers, with a share going to them).
2. **Timed prompts and events.** Promo campaigns already exist; a "prompt of the week" story
   opened by the admin, with its own promo link, needs no contract change.
3. **Profiles and display names.** Wallet addresses are hard to recognise. A name chosen by the
   writer (set on chain, moderated like the summary) would make credits read like a book's.

## Testing

- Stories contract: `Stories.wave2.spec.ts` (21 tests: suggesting, accepting, the stale check,
  limits, declining, withdrawing, closing stale ones, moderation, takedown wipe, private stories,
  AI label and citation, and the story guide) plus the whole existing suite.
- Website: `web/test/wave2.test.js` (the ABI and who may do what with a suggestion).
- Deploy tool: Terms with blanks or a wrong version number are refused.

Stories release build of this branch (sha256 of `stories/build/release/contract.wasm`): `7b38df3c49e539b0a9fa76e3a821a26d19600b3c5eb6eb06d81ae03e84e117a9`. It replaces the audited `d0337155…35cf` only after the follow-up review.
