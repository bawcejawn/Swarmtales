# SwarmTales Stories

This folder is the Stories contract: the books and short stories themselves, and where Ink is **spent**. Ink lives in the parent folder and Shop in `../shop`.

- What it does and why: [../docs/STORIES_DESIGN.md](../docs/STORIES_DESIGN.md)
- Who can do what, and what works at each stage of a story: [../docs/ADMIN_POWERS.md](../docs/ADMIN_POWERS.md)

The code is split by job:

| File | What is in it |
|---|---|
| `assembly/Stories.ts` | Reads, opening, writing and changing text, the final edit, archive |
| `assembly/StoriesAdmin.ts` | Moderation (hide, restore, takedown, reports) and the admin settings |
| `assembly/StoriesBase.ts` | Storage and the helpers both of the above use |
| `assembly/lib/` | The fixed rules (`constants.ts`), storage keys and hashing (`keys.ts`), text rules (`text.ts`), small shared rules (`rules.ts`) |

From this folder (Windows PowerShell: `npx.cmd yarn@1.22.22 …`, one line at a time):

```bash
yarn install --frozen-lockfile
yarn build:release
yarn test
```

Build before testing: the tests import generated files. The tests run in a mock chain and need no tokens; the full run takes a while (about 40 minutes on a two-core machine).

Wiring after an upload: `node deploy/deploy.js wire-stories …` from the repository root (see `../docs/TESTNET_DEPLOY.md`).
