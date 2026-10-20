# Copy checker: free book and web search (optional)

The copy checker always compares new parts with everything already on SwarmTales. It can
also look for copied text outside SwarmTales: it takes three exact phrases of about 12 words
from each part over 300 characters. When **two of the three** are found somewhere else, it
hides the part and notes where they were found.

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

## If something is hidden by mistake

The note on the hidden part says where the phrases were found. The admin or moderator can
unhide it:

```powershell
node deploy/deploy.js hide --actor $ADMIN --stories $STORIES --story <id> --seq <part> --reason copyright --unhide
```
