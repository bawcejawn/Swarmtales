import { h } from "./dom.js";

/**
 * "How it works": the plain-language guide for a first-time visitor.
 * Kept as data so the same words can later be pre-rendered for search engines.
 */
export const HOW_SECTIONS = [
  {
    id: "read",
    title: "1. Reading is free",
    body: [
      "Open any story and read it like a book. You don't need a wallet, an account, or Ink to read.",
      "Stories are stored on the Koinos blockchain, a public record. That is why every part shows who wrote it, and why nobody can quietly change it later.",
    ],
  },
  {
    id: "wallet",
    title: "2. A wallet instead of a password",
    body: [
      "To write, you sign in with a Koinos wallet. On a computer that is Kondor, a browser extension. On a phone it will be KOIN Vault (it only works on the main Koinos network, so not during this test).",
      "Your wallet holds a private key, a long secret that proves you are you. SwarmTales never asks for it. If any page, message, or person asks for your private key or recovery words, it is a scam. Close it.",
      "When you write, the wallet shows you exactly what you are about to sign. Nothing happens until you confirm.",
    ],
  },
  {
    id: "mana",
    title: "3. Mana: why writing doesn't cost a fee",
    body: [
      "Koinos has no per-transaction fees. Instead, a wallet that holds a little KOIN gets mana, a kind of energy that refills on its own over about five days.",
      "Each action uses a small amount of mana. On the main network, a wallet with little or none can tick “Use free mana” in Kondor to borrow the energy for that action.",
      "On the testnet, some Kondor versions can't check transactions yet and keep asking you to “Refresh check”. If that happens, use the Test wallet (testnet only) in the wallet window: a throwaway wallet kept in your browser. Send it some tKOIN and it signs for you.",
    ],
  },
  {
    id: "ink",
    title: "4. Ink is your writing allowance",
    body: [
      "Writing a part uses Ink. One normal letter, space or punctuation mark costs 1 Ink. Most emoji cost 2. The page shows the exact number before you sign, and the story contract checks it again.",
      "Ink is only for writing on SwarmTales. It has no cash value. It can't be sent to anyone, sold, or traded, and it is not an investment.",
    ],
  },
  {
    id: "get-ink",
    title: "5. Three ways to get Ink",
    list: [
      ["A promo link.", "Sometimes SwarmTales shares a link on Discord, Telegram or X. Open it, connect your wallet, and claim free Ink. Each wallet can claim one promo, ever."],
      ["An invite to a private story.", "A story's opener can send you an invite link. Joining is free. The opener's writers' pool pays for your parts while it lasts. You need an active Writer month there; the opener can pay for it."],
      ["A Writer membership.", "A Writer month comes with a set amount of Ink. Open the Membership page to see the price and the Ink included."],
    ],
  },
  {
    id: "write",
    title: "6. Writing the next part",
    body: [
      "Read to the end of a story, then write what happens next in the box below it. A part needs at least 20 characters, so every turn adds something. Only the very last part of a story may be shorter.",
      "You can start a new chapter, and you should tick “Written with AI help” if a tool wrote any of it. Readers see that label.",
      "Stories have no fixed size. Once a short story reaches 10,000 characters (a book: 100,000), its opener can close it for the final edit whenever they're ready. A short story can grow to 99,999 characters and a book to 1,000,000.",
    ],
  },
  {
    id: "edits",
    title: "7. Edits and credit",
    body: [
      "A story's opener and its editors can tidy a part. An edited part shows a small “edited” note; tap it to see who edited it and when. Credit stays with the person who wrote it, and the first version stays on the public record.",
      "If a part is removed, it is listed as removed at the bottom of the story, so the record stays complete.",
    ],
  },
  {
    id: "finish",
    title: "8. Finishing a story",
    body: [
      "When a story is long enough, the opener closes it and gives it a final polish. Then it is marked finished and becomes a book. Every writer whose words survive is in the credits.",
      "A story nobody touches for a long time can be archived. Archived stories can still be read.",
    ],
  },
  {
    id: "open",
    title: "9. Opening your own story",
    body: [
      "Anyone with a wallet can open a story. You choose a title, a category, and who may write: anyone (public, listed in Discover), or only people you invite (private, not listed in Discover).",
      "Opening has a small price, paid from your wallet, and comes with starter Ink so you can write the first part. Your first 3 open stories cost the normal price; each one after that doubles it, up to 4×. Finishing or archiving a story frees its slot.",
      "Private stories have a writers' pool: Ink you set aside (at least 10,000 for a short story, 100,000 for a book) that pays for your invited writers' parts. You can add more any time, and whatever is left comes back to you at the end. Invited writers need an active Writer month, and you can pay for theirs. The words themselves are still public on the blockchain.",
      "Two optional settings are saved with every story. Free preview: how many chapters visitors without a membership can read before being asked to join. Keepsake copy: how many characters a writer needs in the finished story to receive a free Contributor Edition, a keepsake copy with their name in the credits. Both switch on when memberships and finished books launch; for now every story is free to read.",
    ],
  },
  {
    id: "testnet",
    title: "10. Right now this is a test",
    body: [
      "SwarmTales is running on the Koinos testnet, a practice copy of the network. The coins there are play money. Stories written now may be reset before launch.",
    ],
  },
];

export function renderHowSections() {
  return HOW_SECTIONS.map((section) =>
    h("section", { class: "how-section", id: "how-" + section.id, "aria-labelledby": "how-h-" + section.id }, [
      h("h2", { class: "h3", id: "how-h-" + section.id }, [section.title]),
      ...(section.body || []).map((text) => h("p", { class: "body-2" }, [text])),
      section.list
        ? h("ul", { class: "how-list" }, section.list.map(([lead, text]) => h("li", {}, [h("b", {}, [lead]), " ", text])))
        : null,
    ])
  );
}
