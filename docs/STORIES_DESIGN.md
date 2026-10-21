# SwarmTales Stories contract: design spec

Status: **Decisions answered by Carl (19 October 2026). Built and unit-tested in the working copy `/workspace/st-stories` (`stories/`). Not uploaded anywhere, nothing committed or pushed, not audited.**
Based on: the settled design conversation (`storyloom/claude-conversation.md`; Storyloom is the old name of SwarmTales) and the repo at commit `02885a4` (Ink `assembly/Ink.ts`, Shop `shop/assembly/Shop.ts`, both `.proto` files, `README.md`, `docs/TESTNET_DEPLOY.md`).

How to read this: every rule includes a short "why". Section 13 records your answers to the open questions. Section 14 lists places where the conversation and the code disagreed, and what was decided for each. Section 16 lists where the built contract differs from the earlier draft, and why.

---

## 1. Purpose

Stories is the contract that holds the books and short stories. It is where Ink gets **spent**.

- Opening a story (a Book or a Short Story) collects the open fee through Shop, and Shop mints the opener's starter Ink.
- Writing burns the writer's Ink: 1 Ink per character, and a typical emoji costs 2 (see section 6).
- It records **who wrote what, when, and for how much Ink**, permanently and publicly. This is the "accurate, tamper-resistant tracking" requirement.
- It enforces the rules: size ranges, the 3-open-projects limit, private allow-lists, the 1,000-character promo trial, the 60-day archive, editor edits and removals, **automatic Ink refunds** to the original author, the final AI-edit pass, and the admin-finalize rule.
- It does **not** hold money. All stablecoin payments still go through Shop, which splits them 99% treasury / 1% founder.

Why one contract for all stories: deploying a new contract per book would cost far more Mana. It would also scatter the history across many addresses.

---

## 2. How it fits with Ink and Shop

```
 Writer's wallet signs ONE transaction
        │
        ▼
   ┌─────────┐  pay_open_fee / pay_close_fee   ┌──────┐  stablecoin transfer  ┌────────────┐
   │ Stories │ ──────────────────────────────► │ Shop │ ────────────────────► │ vUSDT etc. │
   │         │                                 │      │ ──mint STARTER──┐     └────────────┘
   │         │  get_membership / promo check   │      │                 │
   │         │ ◄────────────────────────────── │      │                 ▼
   │         │                                 └──────┘            ┌───────┐
   │         │ ── burn (CONTRIBUTION) ───────────────────────────► │  Ink  │
   │         │ ── mint (REFUND only) ────────────────────────────► │       │
   └─────────┘                                                     └───────┘
        ▲
        └── Books NFT (later) READS Stories. Stories never calls Books.
```

**Nothing in Ink or Shop has to change for Stories to work.** The current code already has what Stories needs:
- **Ink:** `burn` (approved burner plus the owner's signature), and `mint` with reason `MINT_REFUND` (5).
- **Shop:** `pay_open_fee` and `pay_close_fee` (Stories-only, through `config.stories`), plus the `get_membership` and `get_promo_claimed` reads.

So the current Ink/Shop testnet redeploy can go ahead unchanged.

Why Books reads Stories rather than Stories calling Books: Stories can ship and be tested before Books exists. A Books bug also can never block a story from finalizing.

---

## 3. What is stored

All amounts are whole numbers. All times are **seconds** (the chain gives milliseconds; Stories divides by 1000, same as Shop).

### 3.1 Story record (one per story, ids 1, 2, 3, …)
| Field | Meaning |
|---|---|
| `kind` | BOOK or SHORT_STORY (same numbers as Shop's `story_kind`: 1 and 2) |
| `opener` | Wallet that opened it. Never changes |
| `title` | 1–100 characters, same character rules as story text, no Ink charge (the open fee covers it) |
| `categories` | 1 or 2 category ids from the admin's list |
| `visibility` | PUBLIC, UNLISTED (hidden from the gallery, anyone with the link may write), or PRIVATE (allow-list only) |
| `status` | OPEN → LOCKED → EDITING → FINALIZED, or OPEN → ARCHIVED (section 4) |
| `max_chars` | Chosen at opening within the kind's range. Fixed for this story forever |
| `used_chars` | Current size of all live text, in Ink units |
| `total_burned`, `total_refunded` | Lifetime Ink burned and refunded for this story. Used for an on-chain safety check (section 11) |
| `segment_count`, `chapter_count`, `contributor_count` | Counters for the gallery and credits pages |
| `free_chapters` | How many chapters the website shows to non-members (0–5, default 1; soft gate, UI only) |
| `contributor_edition_min` | Surviving characters needed for a free Contributor Edition later (default 1,000) |
| `created_at`, `last_activity_at`, `opener_last_active`, `locked_at` | Timestamps for the archive and admin-finalize rules |
| `admin_finalize_requested` | The opener's "admin, please finalize" flag |
| `finalizer` | Who runs the final edit: the opener, or the admin under the admin rule |
| `close_fee_paid` | Whether the close fee was collected |
| `final_cursor`, `running_hash` | Progress through the final edit, and the on-chain fingerprint of the final text |
| `revived` | Whether the one free revive has been used |
| `pdf_uri`, `pdf_hash` | Final PDF link (IPFS) and its hash, set at finalize |

### 3.2 Segment (one per contribution: `story id + sequence number`)
| Field | Meaning |
|---|---|
| `author` | Who wrote it. Refunds always go here, never to an editor |
| `text` | The text itself, stored on-chain. Cleared from contract storage on removal (the transaction history still has it) |
| `text_hash` | sha256 of the current text, so anyone can verify it |
| `original_cost` | Ink cost when first submitted. Never changes |
| `charged` | Ink currently "paid in" for this segment. Only ever goes down (through refunds) |
| `status` | ACTIVE or REMOVED |
| `starts_chapter` | Whether this segment starts a new chapter |
| `ai_assisted` | Self-declared by the writer. The chain can't verify it; it's an honesty flag |
| `created_at`, `last_edited_by`, `last_edited_at` | Audit trail |
| `final_mode`, `final_text`, `surviving` | Filled in during the final edit (section 5.4) |

### 3.3 Per-wallet and per-story lookups
- `contributor_totals[story, author]`: live Ink-backed characters before the final edit.
- `surviving_totals[story, author]`: set during the final edit. **This is the only source for credits pages and Contributor Edition eligibility**, as you decided.
- `editors[story, wallet]`: at most 10 editors per story.
- `allowed[story, wallet]`: the private-book allow-list.
- `invites[story, invite_id]`: `{ code_hash, max_uses, uses, expires_at, revoked }`.
- `trial_used[wallet]`: lifetime characters written under the promo trial.
- `open_count[wallet]`: the opener's active projects (OPEN, LOCKED, or EDITING). The limit is 3.
- Append-only lists for the website, so there's no paid indexer: `stories_by_opener[wallet]`, `stories_by_category[cat]`, and `segments_by_author[wallet]` (for "My Contributions").
- `categories[id]`: `{ name, active }`. Admin-managed; starts with the 11 agreed categories.

### 3.4 Config
`admin`, `paused`, `ink` address, `shop` address, and the adjustable limits. Each limit sits inside a hard-coded floor or ceiling, the same idea as Shop's 5% fee cap. That way an admin can't quietly make the rules harsher than the published bounds.

| Setting | Start | Admin may set | Hard bound (code only) | Why bounded |
|---|---|---|---|---|
| Per-contribution cap | 2,000 Ink | 100–4,000 | 4,000 | Transaction size and Mana. Confirm the number on testnet |
| Trial limit (promo writers) | 1,000 | 0–5,000 | 5,000 | Limits what a farmed wallet can spray |
| Open projects per wallet | 3 | 1–10 | 10 | Spam |
| Archive after inactivity | 60 days | 30–365 days | min 30 days | So stories can't be archived out from under people |
| Admin-finalize inactivity | 30 days | 30–365 days | **min 30 days** | So the admin can't shrink it and grab books |

**Fixed in code, not admin settings:** Book 100,000–1,000,000 characters, Short Story 10,000–99,999. These are the rules openers sign up for. Changing them takes a published upgrade, so nobody's goalposts move mid-story. Each story also keeps its own `max_chars` permanently.

---

## 4. Life of a story

```
open_story ──► OPEN ──(used_chars reaches max_chars, automatic)──► LOCKED
                │  ▲                                                 │
                │  └─ revive (opener, once, free)                    │
                ▼                                                    │
            ARCHIVED (no activity for 60 days; anyone may trigger)   │
                                                                     │
OPEN with close minimum met ──close_story (opener pays fee)──┐       │
LOCKED ───────────────────────close_story (opener pays fee)──┤ ◄─────┘
LOCKED / close-ready + admin rule ──admin_take_over (no fee)─┤
                                                             ▼
                                                          EDITING ──finalize──► FINALIZED
```

- **Close minimum:** Book 100,000, Short Story 10,000. There's one extra rule: closing is also allowed once the story is within 100 characters of its own `max_chars`. *Why:* a 100,000-character Book filled to 99,998 can never auto-lock, because no contribution fits the last 2 characters, and it can't meet the 100,000 minimum either. Without this rule it would be stuck forever.
- **LOCKED never reopens.** Edits stop at lock; the final edit is the only change after that.

---

## 5. Entry points (who may call, what it costs)

Every action takes the acting wallet as an argument and requires that wallet's signature (`System.checkAuthority`, same as Shop). Every write fails while Stories is paused. Ink costs below are in Ink units (section 6). "Opener activity" means the call refreshes `opener_last_active` when the opener makes it.

### 5.1 Opening and settings
| Entry point | Who | Costs | What it does |
|---|---|---|---|
| `open_story(opener, kind, title, max_chars, categories[1–2], visibility, free_chapters, contributor_edition_min, opening_text, ai_assisted, expected_ink, token)` | Anyone. **No membership needed** | Stablecoin open fee ($20 Book / $10 Short, through Shop) **plus** Ink for `opening_text` | Checks everything first (range, `open_count < 3`, title, categories, text). Then calls `Shop.pay_open_fee`, which takes the fee and mints the starter Ink (20k / 10k) to the opener. Then it burns Ink for the opening text from that same balance. All of this is **one transaction**: any failure undoes all of it. Promo Ink can't open a story, because the fee is mandatory. |
| `update_story(opener, story, title, category_1, category_2, visibility, free_chapters)` | Opener; not FINALIZED | Free (Mana only) | Settings. Opener activity |
| `set_editor(opener, story, wallet, allowed)` | Opener; not FINALIZED | Free | At most 10 editors |
| `set_allowed(actor, story, wallets[≤20], allowed)` | Opener or editor | Free | Private allow-list |
| `create_invite(story, link_signer, max_uses, expires_at)`, `revoke_invite` | Opener | Free | Stores only the **public address** of a per-link key. The private key lives in the invite link, never on chain (fix H2) |
| `join_with_invite(wallet, story, invite_id, signature)` | Anyone with the link | Free | Adds the caller if the link key's signature over (contract, story, invite, **this wallet**) checks out, and the invite isn't revoked or expired and has uses left. A copied signature can't be reused for another wallet |

The wallet signs the opening as two operations in one transaction, the same pattern Shop already uses: (1) `approve` **Shop** (not Stories) to spend the open fee in the stablecoin, then (2) `Stories.open_story`. Shop is the contract that moves the stablecoin, so Shop is the one that needs the allowance.

### 5.2 Writing
| Entry point | Who | Costs | Rules |
|---|---|---|---|
| `contribute(author, story, text, starts_chapter, ai_assisted, expected_ink)` | See eligibility below | **Ink = cost of `text`** (burned) | Story OPEN. Text passes the character rules (section 6). `cost == expected_ink` (so the wallet can't be charged a surprise amount). `cost ≤ per-contribution cap`. `used_chars + cost ≤ max_chars` (rejected, never cut short). The Ink burn must succeed. If `used_chars` then equals `max_chars`, the story auto-locks. |

**Eligibility to contribute** (all must hold):
1. If the story is PRIVATE: the author is the opener, an editor, or on the allow-list.
2. **And one of:**
   - the opener or an editor of this story (no membership needed, as decided),
   - an **active Writer**, read from Shop (`tier == WRITER` and `paid_until > now`),
   - a **promo claimer** (`Shop.get_promo_claimed != 0`) whose `trial_used + cost ≤ trial limit` (1,000). Trial use counts what was written, not what's left after refunds, so a refund doesn't reset the trial.

Lapsed Writers keep their Ink but fail check 2 until they renew, as decided. Active Writers never use up trial allowance.

### 5.3 Editing before lock (story OPEN)
| Entry point | Who | Costs | Rules |
|---|---|---|---|
| `remove_segment(editor, story, seq)` | The part's writer (the opener or an editor only for a hidden part) | Free | Status → REMOVED; text cleared from storage (hash kept); **refund `charged`**: in a pool-paid part, first what the writer paid themselves (`own_paid`, Ink `mint`, reason REFUND), the rest back to the pool; otherwise all to the writer; `used_chars` drops, so the space reopens. |
| `edit_segment(editor, story, seq, new_text, expected_cost)` | The part's writer only (not blocked; not while the part is hidden) | Rewording is free; letters beyond the current length cost 1 Ink each, paid by the writer (never the pool) | New text passes the character rules and isn't empty (use remove instead). Shortening is always allowed. While nobody else has changed the part, a cut **refunds** `charged − new_cost` (pool-paid parts: `own_paid` to the writer first, the rest to the pool). Once someone else changed it (`paid_changes > 0`) a cut refunds nothing, because the contract can't tell whose letters were cut; `charged` keeps what the writer paid, and removing the part refunds it. Growth must fit within `max_chars`. Every edit is kept as a version (kind 4). |
| `revise_part(writer, story, seq, text, expected_ink, …)` | Anyone who may write in the story, except the part's own writer | `max(10, letters added + removed) × 2^(paid changes + 1)`, paid by the changer, **never the pool** | Up to 60 paid changes per part. Empty text removes the part and refunds `charged`. A cut refunds only while nobody else had changed the part. The changer's citation and AI flag are kept on the version; the copy checker's source note stays. |

**Light-edit allowance** (the final edit only, since October 2026; from "reject edits that grow more than 10% or +20 for short segments"):
`allowance = max(original_cost ÷ 10, min(20, original_cost))`.
It's a fixed number per segment, measured against the **current `charged`**, so repeated edits can't stack it.

*Why this exact shape:* it closes two loopholes in the original wording.
- **(a) Shrink-then-regrow refunds:** shrink a 2,000 segment to 1,000 (refund 1,000), then regrow it to 2,000 for free. With this formula, the regrow is capped at 1,200.
- **(b) Padding tiny segments:** a flat "+20 free" would let a 1-character contribution become 21. With this formula, short segments can at most double.

**Not allowed:** an author editing or deleting their own segment after submitting. You decided "only an editor can remove." An author who wants a change asks the opener or an editor.

### 5.4 Closing and the final edit
| Entry point | Who | Costs | Rules |
|---|---|---|---|
| `close_story(opener, story, token)` | Opener | **Stablecoin close fee** ($5 Book / $2 Short, through `Shop.pay_close_fee`), with the same approve-Shop step as opening | Story OPEN with the close minimum met, or LOCKED. → EDITING, `finalizer = opener` |
| `request_admin_finalize(opener, story, on/off)` | Opener | Free | Sets the flag |
| `admin_take_over(story)` | Stories admin | **No fee** (waived, as decided) | Allowed only if (a) the opener's flag is set, **or** (b) the opener has been inactive ≥ 30 days **and** the story is LOCKED, close-ready, or EDITING with the opener as finalizer. → EDITING, `finalizer = admin` |
| `submit_final_batch(finalizer, story, items[≤20])` | Finalizer only | Free | Items must go in order, starting at `final_cursor`; segments already removed are filled in automatically. Each item is UNCHANGED, EDITED (new text, light-edit rule applies), or REMOVED. Refunds follow the reimbursement rules. `surviving = min(final_cost, charged)`, added to `surviving_totals`. `running_hash = sha256(previous hash ‖ seq ‖ sha256(final text))`. UNCHANGED stores no second copy of the text. |
| `finalize(finalizer, story, pdf_uri, pdf_hash)` | Finalizer only | Free | Every segment is processed (`final_cursor == segment_count`). Stores the PDF link and hash. → FINALIZED; `open_count` drops by 1 |

Every AI suggestion is accepted or rejected by the finalizer **in the browser** before the batch is signed. The contract can't see the AI. It only enforces "light edits only" (the growth limit) and "refunds go to the author."

### 5.5 Archive
| Entry point | Who | Costs | Rules |
|---|---|---|---|
| `archive_if_stale(story)` | Anyone | Free (caller's Mana) | OPEN and no contribution or edit for 60 days. → ARCHIVED, `open_count` drops by 1. Text stays readable by link. **No refunds**: the writing happened. |
| `revive(opener, story)` | Opener, once per story | Free | Needs `open_count < 3`. → OPEN, activity clock reset |

Only OPEN stories can be archived. A LOCKED story with a vanished opener goes down the admin path instead.

### 5.6 Admin
`set_addresses(ink, shop)`, `set_limits(...)` (within the hard bounds), `add_category(name)`, `set_category_active(id, on/off)`, `set_paused`, `set_admin`.
Same admin pattern as Ink and Shop: the contract's own address is admin until `set_admin`, and every admin call needs `System.checkAuthority`.

**The admin cannot:** edit or remove text, change a story's opener, move or burn anyone's Ink, refund outside the rules, or finalize except under the admin rule.

### 5.7 Reads (free)
`get_config`, `get_story`, `get_segment`, `get_segments(story, from, count)`, `get_contributor_total`, `get_surviving_total`, `is_editor`, `is_allowed`, `get_invite`, `get_trial_used`, `get_open_count`, `get_categories`, the list reads (by opener, by category, by author), and `quote_cost(text)`. `quote_cost` returns the exact Ink the contract would charge, so the website's preview can be checked against the chain.

---

## 6. Character counting (and emojis = 2)

**Decided rule: Ink cost = the number of UTF-16 code units in the text.** Carl approved this on 19 October 2026 (question 1). The README, `docs/TESTNET_DEPLOY.md`, Ink's new mainnet description, and this spec all say the same thing: 1 Ink per text unit; most emoji cost 2; a few older ones cost 1; skin tones and flags cost 4; a three-person family costs 8.

*Why this rule:* the website (JavaScript `text.length`) and the contract (AssemblyScript `string.length`) both store text as UTF-16. They count identically by construction, with no Unicode tables inside the contract to bloat it or drift out of date when new emoji come out. "The chain is the referee" stays true and cheap.

What users will see (checked on this box):

| Text | Ink |
|---|---|
| `a`, `é`, `中` | 1 |
| 😀 (most emoji) | **2** |
| ❤️ (heart + color selector) | 2 |
| ⭐ (an older emoji with no color selector) | **1** |
| 👍🏽 (skin tone) and 🇺🇸 (flag) | 4 |
| 👨‍👩‍👧 (family) | 8 |
| `e` + combining accent (decomposed é) | 2 |

So "an emoji costs 2" is true for typical emoji. A few older ones cost 1, and combined ones cost more. The website will say exactly that, and the live counter always shows the real number. The alternative, "every emoji is exactly 2," would need an emoji table inside the contract. That means more code, a bigger contract, and an upgrade every time Unicode adds emoji, so it was not chosen. Every row of the table above is a unit test in `stories/assembly/__tests__/Stories.spec.ts`, and the same rows are checked against the deploy script's own counter in `deploy/__tests__/lib.test.js`.

**How counting is kept reliable:**
1. **The browser normalizes text to Unicode NFC before submitting.** A decomposed `é` becomes one character, so nobody is overcharged by their keyboard. The contract can't normalize (too costly), so it simply charges for what it receives.
2. **The contract counts; the browser only previews.** The browser sends `expected_ink`. If the contract's count differs, the transaction fails before any Ink moves. A mismatch shows up as a clear error, never a surprise charge.
3. **Character rules, rejected on-chain:**
   - control characters other than newline (no tabs),
   - invisible and spoofing characters: zero-width space U+200B, U+2060–2064, U+FEFF, and the bidi overrides and isolates U+202A–202E and U+2066–2069, which can make text display differently from what's stored, including in credits,
   - lone surrogate halves,
   - U+FFFD (the "broken text" marker; it means bad input was silently replaced),
   - more than 3 newlines in a row,
   - text with nothing visible (only spaces, no-break spaces, joiners or variation selectors).

   Titles and category names also refuse line breaks. PDF links are plain ASCII only.

   The zero-width joiner (U+200D, needed for family and profession emoji) and ZWNJ (U+200C, needed for Persian and other scripts) stay allowed.
4. **Capacity uses the same units.** `max_chars`, `used_chars`, the trial limit, the per-contribution cap, and surviving totals are all in Ink units, so there's one number everywhere.

---

## 7. How Stories talks to Ink and Shop

| Call | Entry point id | Arguments |
|---|---|---|
| `Ink.burn` | `0x859facc5` | `from = author`, `value = cost`, `reason = 1` (BURN_CONTRIBUTION), memo `s:<story>:<seq>` (well under Ink's 64-character limit) |
| `Ink.mint` (refund) | `0xdc6f17bb` | `to = original author`, `value`, `reason = 5` (MINT_REFUND), memo `r:<story>:<seq>` |
| `Shop.pay_open_fee` | `0x20a2e01e` | `payer = opener`, `kind`, `token` |
| `Shop.pay_close_fee` | `0xb7a41295` | `payer = opener`, `kind`, `token` |
| `Shop.get_membership` | `0x7701bbeb` | `account` |
| `Shop.get_promo_claimed` | `0x280e7ef7` | `account` |

(The ids are the first 4 bytes of sha256 of the name. They match Shop's existing `transfer` and `mint` constants.)

**How each call's result is handled:**
- Every outgoing call must return exit code 0, or Stories fails the whole transaction.
- Stories also never trusts a call that answers `false`. A result whose bytes are a protobuf bool set to false (`08 00`) fails the whole transaction too, even though the exit code was 0. The unit tests feed both a reverted call and a `false` answer into every write that calls Ink or Shop.
- Stories never moves stablecoins itself, so the "token transfer returned false" problem stays in Shop, which already guards against it.
- Stories also checks the writer's signature **before** calling Ink. Ink checks it again; the early check just gives a clearer error.
- Stories records each outgoing call in an event, as Shop does, so the burn and refund amounts can be checked against the exact call.

**Wiring, after Stories is uploaded.** The deploy script does this in two transactions. First `set-admin stories` (signed by the Stories contract wallet), so the everyday admin wallet signs everything after it and the contract wallet's key can go back on paper. Then `wire-stories` (signed by the admin) does steps 1–4 and 6 in **one** transaction, so a half-wired state can't happen. Verify with `status --stories` afterwards.
1. `stories.set_addresses(ink = <Ink>, shop = <Shop>)`
2. `ink.set_burner(<Stories>, true)`. Note that Ink's burner list is a yes/no flag, not a mask.
3. `ink.set_minter(<Stories>, 32)`: mask 32 is bit 5, **REFUND only**. Shop stays at 30. Stories must never get bits 1–4.
4. `shop.set_addresses(treasury, founder, ink, stories = <Stories>)`. ⚠️ This call **replaces all four addresses**. Treasury and founder must be re-entered exactly as they are now, or payments go to the wrong place. `wire-stories` reads the current values from `shop.get_config` on chain and re-sends them unchanged. It refuses to continue if Shop's Ink is not the `--ink` you gave, if you passed `--treasury`/`--founder` and they differ from the chain, or if Shop already points at a *different* Stories.
5. Confirm Shop's prices for OPEN_BOOK, OPEN_SHORT, CLOSE_BOOK, and CLOSE_SHORT, plus `starter_book` and `starter_short`. `pay_open_fee` refuses to run if any of these are 0.
6. `stories.add_category` ×11 (Fantasy, Sci-Fi, Mystery & Thriller, Romance, Horror, Comedy, Adventure, Drama, Historical, Poetry & Experimental, Other).
7. (Done first, see above.) `stories.set_admin(<admin wallet>)`. **The admin's recovery phrase must be on paper first** (the lesson from this week's lost testnet admin).

Current testnet addresses to wire against (from Carl, 19 October 2026): Ink `195trftAvPnqeoPmHeGmxtwNYVUVdghm5x`, Shop `1JfggxPBqZqmSEe2ECYfxphH2UnKgf6Hth`, admin / treasury / founder `18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6`, test user `12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww`. The Stories address is the new wallet Carl creates for the upload.

Expected checks afterwards: `ink.is_burner(Stories) = true`, `ink.get_minter_reasons(Stories) = 32`, `shop.get_config.stories = Stories`.

---

## 8. Limits and anti-spam (summary)

- **Money filters:** the open fee ($20 / $10) is the main junk filter. Promo Ink can't open a story.
- **3 active projects per opener.** Archived and finalized stories don't count.
- **Promo trial:** 1,000 characters per wallet, ever. Opener and editor rights don't come from promo.
- **Per-contribution cap:** 2,000 Ink to start, admin-adjustable from 100 up to a hard 4,000 (decided, question 3). The final number is set after `deploy.js measure` dry-runs 100, 500, 1,000, 2,000 and 4,000-character submissions on testnet. A long chapter is several submissions.
- **Editors:** at most 10 per story. Allow-list and invite changes take at most 20 wallets per call.
- **Final-edit batches:** at most 20 segments and at most 8,000 Ink units of new text per call, so one batch stays far below a block's limits.
- **Character rules** in section 6.
- **60-day archive,** callable by anyone.
- Ranking, reports, and the "reported" hiding are website or later-contract features (section 12).

---

## 9. Events (public, visible on explorers)

`story_opened`, `story_settings_changed` (title, categories, visibility, free chapters), `editor_changed`, `allow_changed`, `invite_created`, `invite_revoked`, `invite_used`, `contribution_added` (story, seq, author, cost, chapter flag, ai flag, text hash), `segment_edited` (old and new cost, refund), `segment_removed` (refund), `story_locked` (auto), `story_closed` (fee paid), `admin_finalize_requested`, `admin_took_over`, `final_batch` (cursor, running hash), `story_finalized` (pdf uri and hash, final running hash), `story_archived`, `story_revived`, `external_call` (exact bytes sent to Ink or Shop), `category_changed`, `paused`, `admin_changed`, `limits_changed`.

Ink's own `mint_event` and `burn_event` also fire for every burn and refund, with the memo linking them to the story and segment. The Shop `payment_event` for an open has the memo `open:book` or `open:short` but no story id, because Shop doesn't know it. Stories' `story_opened` event links the two.

---

## 10. Edge cases and failure modes

| Situation | What happens |
|---|---|
| Not enough Ink | Ink's burn fails ("not enough Ink"), so the whole contribution is undone |
| Contribution bigger than the space left | Rejected with the remaining space in the message; the website warns first. Never cut short |
| Story at 99,998 of 100,000 | Can't auto-lock, so the "within 100 of max" close rule lets the opener close |
| Website count ≠ contract count | `expected_ink` mismatch: rejected, nothing charged |
| Empty text or only whitespace | Rejected |
| Two writers race for the last space | The first in a block wins; the second is rejected with no charge |
| Ink paused | Contributions, edits, removals, and refunds all fail (refunds are mints). Settings still work. The website shows "writing paused" |
| Shop paused, or a price or starter amount not set | Opening and closing fail; writing still works |
| Writer membership expires mid-draft | The submit fails with "Writer membership is not active"; the draft stays in the browser |
| Removed segment's author has lapsed | The refund still goes to them. Refunds don't need a membership |
| Editor removes the opener's own text | Allowed (the opener chose that editor); the refund goes to the opener |
| Opener loses their wallet (like the testnet admin this week) | The story can't be closed by them. After 30 days of no opener activity, the admin path finalizes it. Opener transfer is deliberately not supported (section 12) |
| Finalizer stops halfway through the final edit | `final_cursor` remembers progress, so the website resumes. If the opener is the finalizer and is inactive 30 days, the admin can take over |
| Story archived while the opener is away | The opener revives it once for free if they're under 3 active projects |
| Category deactivated | Existing stories keep it; new stories can't pick it; the website hides empty categories |
| Wallet with its own authority contract (smart wallet) | Works: Ink and Stories ask the wallet's authority as usual |
| Lists grow huge | They're append-only with paging reads. A free GitHub Action index comes later, as planned |

---

## 11. Security risks and mitigations

| Risk | Mitigation |
|---|---|
| **The Stories key can upgrade the code**, and Stories may mint REFUND Ink, so a stolen key means unlimited free Ink | Admin and upload keys backed up on paper or hardware, never used day-to-day. Ink's admin can remove Stories as a minter in one call. Every refund is public and marked REFUND. The 48-hour announce-before-upgrade process applies. Ink only lets Stories mint REFUND, never purchase or promo Ink |
| A bug refunds more than was burned | On-chain checks: a segment's refunds can never exceed its `original_cost`, and each story's `total_refunded ≤ total_burned`. Tests try to break both |
| Taking someone's Ink | Impossible by design: Ink burns only with the owner's signature, and Stories always burns `from = the signer` |
| Re-entry (a token or authority contract calling back mid-transaction) | The same reentrancy lock pattern as Shop, held across the whole call |
| Spoofed text (bidi or invisible tricks in credits or titles) | Rejected characters (section 6) |
| Editor abuse (mass removal) | Refunds go to authors. The opener picks editors and can remove them. Everything is public |
| Refund farming through a colluding editor | Net zero Ink at best: the trial doesn't reset, and the light-edit formula blocks shrink-and-regrow |
| Admin overreach | The admin can't touch text or Ink. The inactivity floor (30 days) and the bounds are hard-coded |
| Bad or invalid input | Every address must be 25 bytes. Every count uses overflow-safe math. Fixed ranges for kind, visibility, and status |
| Abusive text is permanent on-chain | Removal clears it from contract storage, and the website hides it, but the transaction history keeps it forever. The "text is public and permanent" notice stays at every submit |
| Lost admin key | Same as Ink and Shop: there's no back door, so the key must be backed up |

---

## 12. Deliberately left out of Stories v1 (and why)

- **NFTs, the First Edition, and Contributor Edition claims.** These go in the Books contract later, which reads `surviving_totals` and `contributor_edition_min`. Keeping them out keeps Stories smaller.
- **Reactions and reports.** Decided (question 4): a small separate contract, later. Stories can mint Ink refunds, so it stays as small as possible.
- **Wallet-signed invite links.** Implemented after the October 2026 security review (fix H2): an invite stores only the public address of a per-link key; joining needs that key's signature over the joiner's own wallet, so nothing secret is on chain and a copied signature cannot be replayed. A direct allow-list remains.
- **Keepsakes and tips.** Decided (19 October 2026): these are a **later Shop upgrade**. They are new Shop items, they don't involve Stories, and nothing for them is built now.
- **Sponsorship.** Decided (question 6): offered later as a **separate Sponsor contract, OFF by default**. There is no sponsor code inside Stories. See question 6 for why.
- **Pending or approval queues** (you chose open by default), and **authors editing their own text**.
- **Transferring the opener role, co-openers, and deleting a story.**
- **Sponsored Mana inside Stories** (users use their own wallet Mana; the optional Sponsor contract is separate, above), any AI inside the contract (impossible), view counts, and heat ranking (computed in the browser).
- **The demo-mode reading window and the free-chapter soft gate.** These are website behavior; Stories only stores `free_chapters`.
- **The First Edition sale and a platform token.** Parked, as you said.

---

## 13. Decisions on the open questions (answered by Carl, 19 October 2026)

1. **Emoji cost rule: the UTF-16 rule.** Most emoji 2 Ink; a few older ones like ⭐ cost 1; skin tones and flags 4; a three-person family 8. No emoji table in the contract.
2. **Close fee when a story fills up: yes.** The opener pays the $5 / $2 close fee to start the final edit even when the story auto-locked at its maximum. The admin take-over path stays free.
3. **Per-contribution cap: 2,000 to start.** Admin-adjustable with `set_limits`, bounded 100 to 4,000 in code. The final number comes from real testnet Mana measurements (`deploy.js measure`).
4. **Reactions and reports: a separate contract, later.** Not in Stories v1.
5. **Private-book invites: signed links plus direct adds.** An invite has a use limit (1–1,000) and an expiry (at most 365 days). Only the public address of a per-link key is stored; the private key travels in the link and signs a join bound to the joiner's wallet (fix H2). The opener or an editor can also add wallets directly.
6. **Sponsorship: available later as a separate Sponsor contract, OFF by default.** Carl asked for whichever of "a disabled-by-default switch inside Stories" or "a separate Sponsor contract" is safer and simpler. **The separate contract is both:**
   - *Isolation.* Paying someone's Mana on Koinos means a contract's `authorize()` approves being the payer, and that contract must hold KOIN for Mana. Inside Stories, a bug in that code would sit next to the Ink burn and REFUND mint powers. In its own contract, the worst a bug can do is spend the sponsor's own Mana. It can never mint Ink or touch refunds.
   - *Simpler Stories.* Stories needs no `authorize()` override, holds no KOIN, and keeps its upload flags all false (as Ink and Shop do). An "off" switch in Stories would still ship that code to mainnet, ready to be switched on by mistake or by a stolen admin key.
   - *Later, without risk.* A Sponsor contract can be written, tested and uploaded whenever Carl wants, without changing or re-uploading Stories. Until then it simply doesn't exist, which is the safest possible "off."

Also confirmed on 19 October 2026: the **Short Story close minimum is 10,000** (section 14, item 10).

---

## 14. Inconsistencies found (conversation vs. current code and docs), with decisions

1. **The burner is not a mask.** Ink stores burners as a yes/no flag (`set_burner(account, allowed)`). Only minters use a reason mask. Wiring is `set_burner(Stories, true)` plus `set_minter(Stories, 32)`.
2. **Emoji counting is described three different ways.**
   - The conversation first said "graphemes, emoji = 1," then "Unicode code points; a few emoji count as 2 or more."
   - The repo README says UTF-16 code units (typical emoji 2, flags and families more).
   - `docs/TESTNET_DEPLOY.md` says flatly "2 Ink per emoji."
   - Ink's on-chain description says "1 INK = 1 character."

   **Decided:** the UTF-16 rule everywhere. README, `docs/TESTNET_DEPLOY.md` and this spec now say the same thing. Ink's on-chain description is changed **in code only, in the working copy, for the mainnet upload**: "Non-transferable writing allowance for SwarmTales. 1 INK per text unit; most emoji cost 2. No cash value. Creative use only." The Ink already on testnet (`195trftAvPnqeoPmHeGmxtwNYVUVdghm5x`) keeps its old description and is not touched.
3. **Starter Ink.** The conversation once planned book-bound starter credit. It was then changed to normal Ink ("starter credits don't disappear"), and the Shop code matches the final decision (mints general Ink, reason STARTER). That means an opener could spend starter Ink in other stories. This is consistent with your decision, just worth knowing. **Decided:** keep it as built.
4. **No story id on Shop's open payment.** Shop's starter mint memo is `open:book` / `open:short`. Stories' `story_opened` event provides the link. **Decided:** no Shop change.
5. **There's no `is_writer` read in Shop.** Stories must repeat Shop's rule (`tier == WRITER && paid_until > now`, in seconds) from `get_membership`. It's a small duplication. Adding a Shop read would mean changing Shop, which isn't required. **Decided:** Stories repeats the rule; a test pins it (expired by one second = refused).
6. **`shop.set_addresses` overwrites all four addresses.** Setting Stories means re-sending treasury and founder. The current deploy script sends `stories: ""`. A Stories wiring step must keep the live treasury and founder values. **Done:** `wire-stories` reads them from the chain (section 7).
7. **Keepsake and tip items** appear in the conversation's Shop item list but not in `shop.proto` (items stop at CLOSE_SHORT). They're not needed for Stories. **Decided:** a later Shop upgrade; not built now.
8. **The conversation says "Harbinger testnet,"** but the project actually uses `testnet.koinosfoundation.org`. Harbinger is a different network. **Decided:** the Koinos Foundation testnet, as the deploy script already checks.
9. **The conversation's Ink sketch** had "mint/burn limited to Shop and Stories." The code matches, with a tighter rule: Shop can't burn, and Stories can mint REFUND only. **Decided:** keep the tighter rule (Stories mask 32).
10. **The Short Story close minimum** was never stated outright. The conversation implies 10,000 (the bottom of the range). **Confirmed by Carl: 10,000.**
11. **A Sponsor contract** was still on the roadmap after "no app-paid Mana" was decided. **Decided:** keep it as an optional, separate, later contract that is OFF by default (question 6). The README roadmap now says that.
12. **Admin finalize in EDITING:** an early idea let *anyone* finalize the unedited text after 30 days. Your later decision ("only the opener or the admin finalizes") replaced it, and this spec follows the later decision. **Decided:** only the opener or the admin finalizes.

---

## 15. Status and next steps

1. Done: Stories and its unit tests (mock VM, no chain, no cost) in `/workspace/st-stories/stories`. Counting tests for every row of the section 6 table, and attack tests for the section 11 risks (unauthorized callers, cap boundaries, refund loopholes, closed and archived stories, private access, `false` answers from Ink and Shop).
2. Done: deploy-script support (`upload stories`, `set-admin stories`, `wire-stories`, `status --stories`, `test-open`, `measure`, `stories-limits`).
3. Next, Carl on testnet: upload, set-admin, wire, then `measure` to settle the per-contribution cap, then real writes, emoji counting, not-enough-Ink, too-long text and refunds.
4. Before mainnet: a coverage review, an independent audit, and the mainnet Ink upload with the new description.

---

## 16. How the built contract differs from the draft above (and why)

1. **One text field per segment.** The final edit overwrites `text`; earlier versions live in the transaction history, and `text_hash` plus the story's running hash prove the final order. *Why:* storing every version would multiply storage Mana.
2. **The final pass may push a story slightly past `max_chars`,** but each segment still only grows within its light-edit allowance. *Why:* a whole-book grammar pass at the very top of the range would otherwise be impossible.
3. **Light-edit allowance is `max(original ÷ 10, min(20, original))`, measured from what is still paid for** (`charged + allowance`). *Why:* this closes shrink-then-regrow (refund, then grow back for free) and stops a 2-character segment being padded by 20. Tests try both.
3a. **October 2026 (audit-fixes-2): the writer's own edits are paid growth, not an allowance.** Rewording is free, letters beyond the current length cost the normal rate, and shortening is always allowed; the light-edit allowance applies only to the final edit. A story's pool pays only for new parts. Every change to a part's text (writer edit, paid change, final edit) is kept as a version naming who made it, up to 100 per part, and a takedown wipes them all. Stories' Ink address is set once. *Why:* the October fix check (AB-032 to AB-040).
4. **`update_story` replaces separate setters** for title, categories, visibility and free chapters; `set_editor(…, allowed)` and `set_allowed(…, allowed)` replace add/remove pairs. *Why:* fewer entry points to secure and test.
5. **The finalizer is stored as a flag (`finalizer_is_admin`), not an address.** When it is set, whoever is admin *at the time* finalizes. *Why:* if the admin wallet is rotated (as happened on testnet), a book mid-edit isn't stranded with a dead address. A test rotates the admin mid-edit.
6. **`get_segments` returns at most 10 segments per read;** list reads return at most 50. *Why:* keeps read results within node limits for 4,000-unit segments.
7. **Invite codes are 8–64 plain ASCII characters.** *Why:* no look-alike Unicode in codes people type.
8. **The contract raises its system buffer to 64 KB at start-up.** *Why:* the SDK default (1 KB) is too small for a 4,000-unit text argument or a final batch.
9. **Removed segments before the lock are folded into the running hash automatically** during the final pass, so the finalizer only submits live segments.
10. **The trial counts what was written; refunds don't give trial back.** *Why:* otherwise write-remove-write would reset the trial.
11. **State is written before Ink and Shop are called, and a reentrancy lock is held** for the whole call. If any call fails or answers `false`, the whole transaction is undone.
12. **Each story enters a category list once,** however often it is re-tagged. *Why:* stops list spam.
13. **`open_story` has no `starts_chapter` argument.** The opening text is always segment 1 and always starts chapter 1.
14. **"Not enough space" errors don't include the number left,** because building that message costs code size; `get_story` (`max_chars − used_chars`) gives it, and the website shows it before submitting.
