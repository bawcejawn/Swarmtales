# Copy checker: free book and web search (optional)

The copy checker always compares new parts with everything already on SwarmTales. It can
also look for copied text outside SwarmTales: it takes three exact phrases of about 12 words
from each long part and searches for them. It hides a part only when the text is in a
**published book that is provably older than the part**; anything else gets a note at most
(details below).

Brave dropped its free plan in February 2026. These two replacements are free, with no
credit card. Add either one, or both.

| Service | What it searches | Free amount | Card? |
|---|---|---|---|
| Google Books API | Inside millions of published books (the main copyright risk for fiction) | 1,000 searches a day | No |
| Tavily | The web (fan fiction sites, blogs, articles) | 1,000 searches a month, then it simply stops until the 1st | No |

The checker stays under these limits by itself:

- Google Books: at most 25,000 searches a month.
- Tavily: at most 950 a month.
- All services together: at most 40 searches per hourly run.
- Books are searched first, and the web only when a phrase isn't found in a book.

## 1. Google Books key

1. Go to https://console.cloud.google.com/ and sign in with a Google account. If it asks
   you to start a free trial or add billing, skip it. The Books API doesn't need billing.
2. At the top, click the project picker → **New project** → name it `swarmtales-checker` →
   **Create**. Make sure the new project is selected.
3. Open https://console.cloud.google.com/apis/library/books.googleapis.com → **Enable**.
4. Open https://console.cloud.google.com/apis/credentials → **Create credentials** →
   **API key**. Copy the key.
5. Click the new key → under **API restrictions** choose **Restrict key** → tick
   **Books API** → **Save**. That way the key can only search books.
6. In GitHub, open https://github.com/bawcejawn/Swarmtales/settings/secrets/actions →
   **New repository secret** → Name `GOOGLE_BOOKS_KEY`, Secret: the key → **Add secret**.

## 2. Tavily key

1. Go to https://app.tavily.com/ and sign up (the free "Researcher" plan, no card).
2. Copy your API key from the dashboard (it starts with `tvly-`).
3. In GitHub, open https://github.com/bawcejawn/Swarmtales/settings/secrets/actions →
   **New repository secret** → Name `TAVILY_API_KEY`, Secret: the key → **Add secret**.

## 3. Test the keys (nothing is hidden in a test)

1. Open https://github.com/bawcejawn/Swarmtales/actions/workflows/copy-checker.yml
2. **Run workflow**. In **test_phrase**, paste one sentence of at least 12 words from a
   well-known published novel → **Run workflow**.
3. When it finishes (about a minute), open the run. Its summary shows a line for each key:
   - `key works … the phrase was FOUND in the book "…"` means it works and found the book.
   - `key works … no exact match` means the key is fine, but that sentence wasn't matched.
     Try another sentence.
   - `FAILED with status 400/403` means the key is wrong, or the Books API isn't enabled.

After that, the normal hourly runs use the keys by themselves.

## 4. The state key (required)

The checker saves its progress between runs, and seals it with a secret so nobody can plant a
fake one. Without this key it only reports, and each run fails so GitHub emails you.

1. Make a random text of at least 32 characters (a password manager's "generate" button).
2. Open https://github.com/bawcejawn/Swarmtales/settings/environments → **copy-checker** →
   **Add environment secret** → Name `CHECKER_STATE_KEY`, Value: that text → **Add secret**.
   (It must be an **environment** secret, like `MODERATOR_WIF`, not a repository secret.)

## How a run works

Each hourly run has three steps:

1. **load** checks the seal on the saved progress.
2. **plan** reads new parts from the chain and searches the books and the web. It has no
   moderator key, so nothing it reads from the web can ever reach the key.
3. **apply** re-reads each planned part on the chain, signs only what still holds (at most 20
   hides a run), and seals the progress again.

Progress is saved every few seconds, and a run stops starting new work after 20 minutes, so a
long run never loses its work; the next run picks up where it stopped.

## What the checker does (automatic, no reviewing needed)

The checker is set to be gentle. Most of the time it does nothing, or only adds a note.

| What it finds | What happens |
|---|---|
| 4 or 5 of the part's 5 phrases in a **published book**, at least 3 of them in the same book, and the book's publication date is before the part was written | The part is **hidden**, with a public note naming the book. |
| The same, but found only on the web, or in a book that isn't provably older than the part | **Not hidden.** A note says where the text also appears. |
| 80% or more of the part matches another writer's part on SwarmTales | The part is **hidden**. |
| 2 or 3 phrases found, or matches spread over different books (common wording) | **Not hidden.** A small note appears under the part: "Parts of this text also appear in …". |
| Half of the part matches another SwarmTales part | **Not hidden.** A note says where. |
| The writer named the source ("Quoting someone? Name the source") | **Left alone.** |

**Getting a hidden part back.** No admin is needed:

- **The writer names the source.** Under their hidden part, the writer sees a **Source** box.
  If what they type names the book or site the checker found, the part comes back by
  itself on the next hourly run.
- **The opener or an editor decides.** They see **Restore this part** under any hidden part
  in their story. If the checker hid it, restoring it gives up its refund, and the checker
  doesn't hide that text again (it can still add a note). That rule is read from the chain,
  so it holds even if the checker's saved progress is lost. If the writer then changes the text,
  the new text is checked like any other. Writer reports can still hide it, but only 3 new
  reports count.
- **Checked again after a change.** The checker checks a part again whenever its text or its
  citation changes, and it checks parts writer reports hid too: a copy that writers reported as
  copied becomes the checker's hide. A part reported for anything else (abuse, spam) stays the
  reports' hide; a citation never brings it back. If the writer clears the citation that brought
  a part back, it is hidden again.

**Which text came first.** Two matching texts are dated by when their words were first written
(from the part's history), not by its last edit, so a typo fix or a paid change to an original
never makes it look like a copy of its copies.

**Out of searches.** A long part is never passed without its phrase search. If a run has no
searches left, or the search service fails, the part waits and is searched first in the next
run; the parts after it wait with it, so a copy is never checked before the text it copied. If
the month's free searches run out, the checker waits at the first long part until the next month.
- **The admin's legal takedown stays final.** Use it for a rights holder's notice. A taken-down
  part can't be restored.

## If something is hidden by mistake

The note on the hidden part says where the phrases were found. The admin or moderator can
unhide it:

```powershell
node deploy/deploy.js hide --actor $ADMIN --stories $STORIES --story <id> --seq <part> --reason copyright --unhide
```
