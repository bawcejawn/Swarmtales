# SwarmTales Stories contract: design reference

Status: current as of the 2026-10 mainnet audit fixes (branch `audit-2026-10-fixes`). This page describes the contract as built. Who can do what is in [ADMIN_POWERS.md](ADMIN_POWERS.md), including the table of what works at each stage of a story. The code is `stories/assembly/`: `Stories.ts` (reads, opening, writing, the final edit, archive), `StoriesAdmin.ts` (moderation and settings), `StoriesBase.ts` (storage and shared helpers) and `lib/` (fixed rules, keys, text checks).

Every rule below has a short "why".

---

## 1. Purpose

Stories holds the books and short stories, and it is where Ink gets **spent**.

- Opening a story collects the open fee through Shop, and Shop mints the opener's starter Ink.
- Writing burns the writer's Ink: one Ink per UTF-16 text unit (section 6).
- It records **who wrote what, when, and for how much Ink**, permanently and publicly.
- It enforces the rules: sizes, open-project limits and price doubling, private stories with invites and a writers' pool, the promo trial, paid changes, refunds, moderation, the final edit, archiving and the admin-finalize rule.
- It never holds money. Stablecoin payments go through Shop.

*Why one contract for all stories:* a contract per book would cost far more Mana and scatter the history.

## 2. How it fits with Ink and Shop

```
 Writer's wallet signs ONE transaction
        │
        ▼
   ┌─────────┐  pay_open_fee (max_price, min_ink)  ┌──────┐  stablecoin transfer  ┌────────────┐
   │ Stories │ ──────────────────────────────────► │ Shop │ ────────────────────► │ stablecoin │
   │         │  get_membership / get_promo_claimed │      │ ──mint STARTER──┐     └────────────┘
   │         │ ◄────────────────────────────────── │      │                 ▼
   │         │ ── burn (CONTRIBUTION) ───────────────────────────────► ┌───────┐
   │         │ ── mint (REFUND only) ────────────────────────────────► │  Ink  │
   └─────────┘                                                         └───────┘
```

| Call | Entry point id | Arguments |
|---|---|---|
| `Ink.burn` | `0x859facc5` | `from` = the signer, `value`, reason 1, memo `s:`/`e:`/`c:<story>:<seq>` or `fund:<story>` |
| `Ink.mint` (refund) | `0xdc6f17bb` | `to` = the part's writer or the opener (pool), reason 5, memo `r:<story>:<seq>` or `fund-back:<story>` |
| `Shop.pay_open_fee` | `0x20a2e01e` | payer, kind, token, price multiplier, `max_price`, `min_ink` |
| `Shop.get_membership` | `0x7701bbeb` | account |
| `Shop.get_promo_claimed` | `0x280e7ef7` | account |

- Every outgoing call must exit with code 0 and must not answer a protobuf `false` (`08 00`), or the whole transaction fails.
- State is written before Ink and Shop are called, and a reentrancy lock is held for the whole call.
- Every outgoing call is recorded in an `external_call_event` with the exact bytes sent.
- Every entry point must be called directly by a transaction, never through another contract (fix H1).
- The Ink and Shop addresses are each set once (AB-037, AB-050).

**Wiring** (`deploy.js wire-stories`, one transaction, after `set-admin`): `stories.set_addresses(ink, shop)`, `ink.set_burner(Stories, true)`, `ink.set_minter(Stories, 32)` (REFUND only), `shop.set_addresses(treasury, founder, ink, Stories)` (Shop's Stories address is set once too), and the starting categories. The tool checks each contract's code hash against `deploy/release-hashes.json` first.

## 3. Stored data

### 3.1 Story
`kind` (Book 1, Short 2, Poem 3), `opener`, `title` (1–100), two categories, `visibility` (Public 1, Private 3; Unlisted 2 is retired), `status`, `max_chars`, `used_chars`, `total_burned` / `total_refunded` (refunds can never pass burns, per story), counters, `free_chapters` (a website soft gate), `contributor_edition_min`, `created_at`, `last_activity_at` and `opener_last_active` (on the activity clock, section 4), `locked_at`, `admin_finalize_requested`, `finalizer_is_admin`, `final_cursor`, `running_hash`, `revived`, `pdf_uri` / `pdf_hash` (the book page link and the text hash), `editor_count`, `next_invite_id`, `hidden_count` (blocks finalizing while above 0), `needs_new_pdf`, the private-story pool (`fund`, `fund_added`), and the summary ("the story so far", up to 1,500 characters).

### 3.2 Part (segment, key story id + sequence number)
`author`, `text`, `text_hash`, `original_cost`, `charged` (what the writer or pool paid and hasn't had back), `current_cost`, status (Active, Removed), chapter and AI flags, timestamps, final-edit fields, moderation fields (`hidden`, `hidden_by` 1 reports / 2 checker / 3 admin, `taken_down`, reason, `report_count`, `restored`, `refund_forfeited`), the writer's rights confirmation and Terms version, `insert_after`, `fund_paid` and `own_paid`, `citation` and the checker's `source_note`, `version_count`, `edited_by_others`, `paid_changes`.

### 3.3 Other storage
Editors (at most 10 per story), the allow-list and the wallets an opener or editor removed from it, invites (only the public address of each link key), contributor and surviving totals, live parts per writer, trial use, open-project counts, the append-only lists for the website (by opener, category, author, reading places), categories, reports, the per-story list of text hashes, Terms acceptance, account status (strikes, blocked), kept versions, and the changers of each part.

### 3.4 Settings and their fixed bounds
| Setting | Default | Bounds (code) |
|---|---|---|
| Per-part size cap | 6,000 | 100–6,000 |
| Promo trial per wallet | 1,000 | 0–5,000 |
| Open projects per wallet | 10 | 1–10 |
| Normal-price projects, price ceiling | 3, 4× | 1–10, 1–1,024× |
| Shortest new text | 20 | 1–200 |
| Archive after inactivity | 60 days | 30–365 |
| Admin-finalize inactivity | 30 days | 30–365 |
| Writer reports that hide a part, strike limit | 3, 5 | 1–20, 1–20 |

**Fixed in code:** Book 100,000–1,000,000 characters, Short Story 10,000–99,999, Poem 50–25,000 (0 at opening means up to the kind's maximum). A story within 100 characters of its own maximum (10 for a Poem) may close below the kind minimum. A private story's writers' pool must be at least the kind minimum (50 Ink for a Poem). Each kind has its own open price (Shop items 6, 7 and 10) and starter Ink. *Why:* openers sign up for these; changing them needs a published upgrade.

*Why 6,000:* a part, its versions and a page of reads stay well inside a node's read limit even in a three-byte script (audit M-5).

## 4. Life of a story

```
open_story ──► OPEN ──(used_chars reaches max_chars)──► LOCKED
                │  ▲                                       │
                │  └─ revive (opener, once, free)          │
                ▼                                          │
            ARCHIVED (text and opener quiet for 60 days)    │
OPEN with the close minimum met ──close_story (free)──┐    │
LOCKED ───────────────────────────close_story (free)──┤ ◄──┘
admin rule ───────────────────────admin_take_over─────┤
                                                      ▼
                                                   EDITING ──finalize──► FINALIZED
```

- **Close minimum:** the kind's minimum length, or within 100 characters of the story's own `max_chars` (10 for a Poem). *Why:* a Book at 99,998 of 100,000 could otherwise never close.
- **A locked story reopens only after a takedown frees space.**
- **The activity clock.** `last_activity_at` and `opener_last_active` are wall time minus every second Stories spent paused (`config.paused_seconds`, plus the current pause). It stands still while paused. *Why:* a long pause must never make stories archivable or open to an admin take-over (audit M-1).
- **Archiving** needs both the text and the opener to have been quiet for the archive period. *Why:* a story its opener still manages stays open (audit S2-06). The pool goes back to the opener; writers' Ink stays spent.
- **Revive** is free, once, only while the opener's next project would still be at the normal price (audit S2-03). A story archived a second time stays archived.
- **Admin take-over:** the opener asked, or has been inactive for the inactivity period, and the story is LOCKED, close-ready, or in the opener's final edit. Not while paused.

## 5. Entry points

Every action takes the acting wallet as an argument and requires its signature. Where each works by stage, and while paused, is in the table in ADMIN_POWERS.md.

### 5.1 Opening and settings
| Entry point | Who | Cost | Rules |
|---|---|---|---|
| `open_story` | anyone not blocked | open fee (through Shop, × the price multiplier) plus Ink for the opening text, plus the pool for a private story | Checks everything first, then Shop takes the fee within `max_price` and mints at least `min_ink` starter Ink, then the opening text is burned, then the pool. One transaction. |
| `update_story` | opener | free | Title, categories, visibility, free chapters. Public → Private needs the pool minimum. |
| `set_editor` | opener | free | At most 10 editors. |
| `set_allowed` | opener or editor | free | Up to 20 wallets per call. A removed wallet can't rejoin with an invite. |
| `create_invite`, `revoke_invite` | opener | free | Only the public address of a per-link key is stored (fix H2). |
| `join_with_invite` | the wallet the link signature names | free | Not revoked, not expired, uses left, not blocked. |
| `top_up_fund` | opener | Ink | Private stories only, while open. |

### 5.2 Writing and changing text (story OPEN)
| Entry point | Who | Cost | Rules |
|---|---|---|---|
| `contribute` | public: Writer month, opener/editor, or the promo trial; private: opener, editor or invited wallet, with a Writer month (not the opener) | Ink = the text's cost (from the pool in a private story while it has enough) | Cost equals `expected_ink`; at most the cap; fits the space; at least the minimum length unless it fills the story; rights confirmation and current Terms; optional `insert_after` or `after_my_last`. |
| `edit_segment` | the part's writer (not blocked, part not hidden, still on a private story's list) | rewording free; added letters cost Ink (the writer pays) | Rights confirmation and current Terms (F-04). The cap stops growth only (S2-05). Growth price at most `max_ink` (AB-049). A cut refunds `charged − new cost` (AB-035, AB-044). Kept as a version. |
| `remove_segment` | the part's writer (even blocked or removed from the list); the opener or an editor only for a report-hidden part | free | Refunds `charged` unless the admin or the checker hid it (AB-012) or a restored checker hide gave up the refund (AB-062). The removed text stays as a version (F-06). |
| `revise_part` | anyone who may write there, except the part's writer | `max(10, letters added + removed) × 2^(paid changes + 1)`, paid by the changer, never the pool | Up to 60 paid changes; empty text removes the part and refunds its writer. The part stays its writer's. A used-up promo trial can't make paid cuts. |
| `set_citation` | writer, opener or editor | free | Up to 200 characters. Someone else's citation counts as a change for strikes. A blocked wallet, or a writer taken off a private story's list, may only clear one (audit L-1). Allowed on a hidden part: it is the writer's appeal against a checker hide. |
| `set_story_summary` | opener, editor, or a writer with a live part (on the list in a private story) | free | Up to 1,500 characters. Admin and moderator may clear it. |
| `set_reading_place` | any wallet | free | The reader's bookmark. The website keeps places in the browser and writes them on request. |

**The same exact text goes into a story once** (F-03): every new text is checked against the story's list of text hashes, which records the part that first had each text. A new part may not repeat any text the story ever had (edited away, removed and taken-down text included), and an edit, paid change or final edit may not copy another part's text. A part may go back to its own earlier wording, so a paid change can restore a part's original. *Why:* stops re-posting the same text to reset its history.

**Versions.** Every change to a part's text is kept as a version naming who made it: the original, the writer's edits (from version 99 on, an edit replaces the writer's own newest version), each paid change, a removal, and the final edit. A part has at most 220 versions, so a takedown can always wipe them in one call. `get_versions` returns at most 5 per call and stops at about 64 KB.

### 5.2b Suggestions and the story guide (Wave 2, October 2026)
| Entry point | Who | Cost | Rules |
|---|---|---|---|
| `suggest_change` | anyone who may write in the story (checked like new text), not blocked, not the part's writer | free | Story OPEN, part active and not hidden; rules and cap of new text; rights confirmation and current Terms; at most 5 waiting suggestions per part (one per wallet) and 20 ever, so a takedown can always wipe them in one call. Stores the part's `text_hash` and `version_count`. |
| `accept_suggestion` | the part's writer | as the writer's own edit: added letters cost the writer Ink (at most `max_ink`), cuts refund as for an edit | Refused if the part changed since the suggestion (hash or version count). Kept as version kind 6 with `by` = the proposer, who is recorded as a changer (strikes, AB-028); their AI label and citation carry over. Needs a version slot within the writer's room (`WRITER_VERSION_ROOM`), so the version bound holds. |
| `decline_suggestion` | the writer (declines, with a note), the proposer (withdraws), anyone once it is stale (part changed, removed, or story not open), the admin or moderator (clears it and wipes its text, also while paused) | free | Frees a waiting slot. |
| `get_suggestions` | read | | 5 per call, about 64 KB, `next`; empty for a part that was taken down. |
| `set_story_guide` | opener or editor; only the opener changes `blind` | free | Notes up to 3,000 characters, the looking-for line up to 140 (lists the story under Seeking writers), the blind round flag. Open, locked or in final edit. The admin or moderator clears notes and wanted (also while paused). |

A takedown also wipes every suggestion on the part. Suggested text is not checked by the copy checker until it is accepted (it then is the part's text), and moderation can clear any suggestion at once.

### 5.3 Closing and the final edit
| Entry point | Who | Rules |
|---|---|---|
| `close_story` | opener | Free. OPEN with the close minimum, or LOCKED → EDITING. |
| `request_admin_finalize` | opener | Sets or clears the flag. |
| `admin_take_over` | admin | Section 4. |
| `submit_final_batch` | finalizer | Up to 20 items and 20,000 units of new text, in order. UNCHANGED, EDITED (within the light-edit allowance `max(original ÷ 10, min(20, original))`, measured from the part's live length) or REMOVED. Hidden parts can only be removed. A blocked finalizer may only remove hidden parts (F-08). |
| `advance_final_cursor` | anyone | Folds up to 50 removed parts into the final hash. |
| `finalize` | finalizer | Every part processed, nothing hidden. Stores the book link and text hash. The pool goes back to the opener. |

### 5.4 Moderation (StoriesAdmin.ts)
`set_segment_hidden` (admin or moderator), `set_source_note` (admin or moderator), `restore_segment` (opener or editor, not an admin hide, not in a finished book), `takedown_segment` (admin; bound to the reviewed `text_hash` and `version_count`; strike rules in ADMIN_POWERS.md), `report_segment` (any wallet once per part, not on finished books; reports from wallets that have written count), `replace_pdf` (admin, after a takedown in a finished book).

### 5.5 Admin settings (StoriesAdmin.ts)
`set_addresses`, `set_limits`, `set_min_contribution`, `add_category`, `set_category_active`, `set_paused` (keeps `paused_at` and `paused_seconds`), `set_moderation`, `set_blocked`, `set_terms`, `set_admin` / `accept_admin` (two steps).

### 5.6 Reads
`get_config`, `get_story`, `get_segment`, `get_segments` (up to 10 parts and about 64 KB, with `next`), `get_versions`, `get_changers`, totals, editor/allow-list/invite reads, trial use, open count and the next price multiplier, categories, the list reads (up to 50), reports, account status, Terms acceptance, reading places, and `quote_cost(text)`.

## 6. Character counting

**Ink cost = the number of UTF-16 code units** (JavaScript `text.length`). Decided 19 October 2026.

| Text | Ink |
|---|---|
| `a`, `é`, `中` | 1 |
| 😀 (most emoji), ❤️ | 2 |
| ⭐ (an older emoji) | 1 |
| 👍🏽, 🇺🇸 | 4 |
| 👨‍👩‍👧 | 8 |

*Why:* the website and the contract both store UTF-16, so they count identically with no Unicode tables in the contract. The browser normalizes to NFC and sends `expected_ink`; any mismatch fails before Ink moves.

**Refused on-chain:** control characters other than newline, invisible and direction-control characters (U+200B, U+FEFF, U+2028/2029, U+2060–2064, U+202A–202E, U+2066–2069), lone surrogates, U+FFFD, more than 3 newlines in a row, and text with nothing visible. Titles, categories, notes and citations refuse line breaks; links are plain ASCII. The joiners U+200C and U+200D stay allowed.

## 7. Limits and anti-spam (summary)

- The open fee is the main junk filter; promo Ink can't open a story. Open-project limit and price doubling (separate wallets avoid the doubling; that is accepted).
- Promo trial: 1,000 characters per wallet, ever; refunds don't give trial back.
- Per-part cap 6,000; a long chapter is several parts.
- Editors: at most 10. Allow-list calls: at most 20 wallets.
- Final-edit batches: at most 20 parts and 20,000 units.
- Reports from wallets that have written count; enough of them hide a part until the opener, the checker or the admin acts.

## 8. Security notes

| Risk | Mitigation |
|---|---|
| The Stories contract key can replace the code, and Stories may mint REFUND Ink | Key kept offline (KEY_CUSTODY.md); release hashes pinned; the Ink admin can remove Stories as a minter in one call; every refund is public |
| A bug refunds more than was burned | Per story, `total_refunded ≤ total_burned`; a part refunds only what its writer or pool paid and hasn't had back |
| Taking someone's Ink | Ink burns only with the owner's signature; Stories always burns from the signer |
| Re-entry, calls from other contracts | Reentrancy lock for the whole call; direct calls only |
| Spoofed text | Character rules (section 6) |
| A long pause used against openers | Activity clock; take-over and archiving refused while paused |
| A takedown racing an edit | Bound to the reviewed text hash and version count |
| Hidden text | Left out of the site and the book, but readable on-chain until taken down |
| A pending part's text taken first (audit I-4) | Anyone watching the mempool can post the same text first and become its first writer under F-03; the website shows each part's writer and time, reports and the checker still apply, and a writer can repost reworded text. Not prevented on chain. |

**Known limits (documented, not changed):**
- **Poems with refrains or short lines** (audit I-6): F-03 refuses a part that repeats any text the story ever had, and every new part needs the minimum length (20 characters by default, `set_min_contribution`). A refrain must therefore be varied, or written into one part together with its verse; very short lines go together in one part. The open page's Poem text says so.
- **Invite links keep their own clock** (audit I-8): an invite's expiry is wall time, so it runs out during a pause like any other time; the opener makes a new invite after a long pause.
- **An old caller of `set_ink_amounts`** that doesn't send `starter_poem` sets it to 0 (audit I-1): no starter Ink for a Poem, which fails closed (nothing extra is minted). The deploy tool and the admin page always send it.

## 9. Deliberately left out

- NFTs and Contributor Editions: a later Books contract reads `surviving_totals`.
- Sponsored Mana: a separate Sponsor contract later, OFF by default. *Why:* code that pays Mana should never sit next to the refund mint.
- Transferring the opener role, co-openers, deleting a story.
- Keepsakes and tips: a later Shop upgrade.
- Close fees: closing has been free since October 2026.

## 10. History (short)

- **Wave 2 (October 2026):** suggested changes (`suggest_change`, `accept_suggestion`, `decline_suggestion`, `get_suggestions`) and the story guide (`set_story_guide`: notes, looking-for, blind round). Needs a short follow-up review before mainnet.

- **19 October 2026:** design decisions (UTF-16 counting, invites as signed links, Sponsor contract separate).
- **October 2026 security review:** direct calls only (H1), signed invite links (H2), bounded final-edit skips (M2).
- **October 2026 audit fix rounds (AB-001 to AB-083):** moderation and strikes, versions, paid changes (`revise_part`), set-once Ink and Shop, the writers' pool, reading places, summaries and citations.
- **2026-10 mainnet audit:** the activity clock (M-1), minimum Ink on opening (M-2), no reports on finished books (M-3), the allow-list on edits (M-4), byte-limited reads and the 6,000 cap (M-5), F-03 to F-09, S2-03, S2-05, S2-06, takedowns bound to the review, Unlisted retired, and the old-testnet migration code removed (testnet was reset).
