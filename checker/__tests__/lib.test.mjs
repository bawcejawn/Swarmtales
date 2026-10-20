import assert from "node:assert/strict";
import test from "node:test";
import { Index, budget, checkOrder, fingerprint, isDuplicate, pickPhrases, resultMatches, words } from "../lib.mjs";

const ORIGINAL = "The lanterns of Harrow Street went out one by one, as if someone were walking the length of the road " +
  "and pinching each flame between finger and thumb. Nell counted eleven before she understood that the someone was her shadow. " +
  "It moved half a step ahead of her now, the way a dog pulls toward a smell, and when she stopped, it stopped too.";

test("words ignore case, accents and punctuation", () => {
  assert.deepEqual(words("Café, CAFÉ — café!"), ["cafe", "cafe", "cafe"]);
});

test("a copied part matches its source, even with small changes", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL));
  const copy = ORIGINAL.replace("Nell", "Nora").toUpperCase();
  const hashes = fingerprint(copy);
  const match = idx.bestMatch(hashes, "mallory", "2:5");
  assert.equal(match.key, "1:2");
  assert.ok(isDuplicate(hashes, match), JSON.stringify(match));
});

test("different writing does not match", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL));
  const other = "Rain had soaked the market stalls by noon, and the fishmonger sang louder to keep the customers from drifting " +
    "toward the bakery, where the ovens kept everyone warm and dry while the gulls argued over scraps behind the harbour wall.";
  const hashes = fingerprint(other);
  assert.equal(isDuplicate(hashes, idx.bestMatch(hashes, "bob", "3:1")), false);
});

test("a writer reusing their own words is not flagged", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL));
  assert.equal(idx.bestMatch(fingerprint(ORIGINAL), "alice", "4:1"), null);
});

test("short parts are never judged", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint("A short line here."));
  const hashes = fingerprint("A short line here.");
  assert.equal(isDuplicate(hashes, idx.bestMatch(hashes, "bob", "1:3")), false);
});

test("the index survives a save and load", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL));
  const back = Index.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
  assert.equal(back.bestMatch(fingerprint(ORIGINAL), "bob", "9:9").key, "1:2");
});

test("phrases are distinctive runs of about 12 words", () => {
  const phrases = pickPhrases(ORIGINAL);
  assert.ok(phrases.length >= 2);
  for (const p of phrases) assert.ok(p.split(" ").length >= 10, p);
  assert.deepEqual(pickPhrases("Too short to search."), []);
});

test("a web result only counts if it contains most of the phrase and isn't SwarmTales", () => {
  const phrase = "pinching each flame between finger and thumb Nell counted eleven before she";
  const hit = { url: "https://books.example.com/lantern", title: "The Lantern", description: "…pinching each <strong>flame</strong> between finger and thumb. Nell counted eleven before she…" };
  assert.equal(resultMatches(phrase, hit, ["bawcejawn.github.io"]), true);
  assert.equal(resultMatches(phrase, { ...hit, url: "https://bawcejawn.github.io/Swarmtales/" }, ["bawcejawn.github.io"]), false);
  assert.equal(resultMatches(phrase, { ...hit, description: "Something else entirely about lamps." }, []), false);
  assert.equal(resultMatches(phrase, { ...hit, url: "not a url" }, []), false);
});

test("the monthly search budget resets each month", () => {
  const state = {};
  const b = budget(state, new Date("2026-10-20T00:00:00Z"), 3);
  b.spend(); b.spend();
  assert.equal(b.left(), 1);
  const next = budget(state, new Date("2026-11-01T00:00:00Z"), 3);
  assert.equal(next.left(), 3);
});

test("search answers from each service become the same shape", async () => {
  const { normalizeResults } = await import("../lib.mjs");
  const phrase = "the lighthouse keeper counted every wave that broke against the northern rocks";
  const books = normalizeResults("books", {
    items: [{ id: "abc", volumeInfo: { title: "Sea Stories", authors: ["A. Writer"], infoLink: "https://books.google.com/books?id=abc" },
      searchInfo: { textSnippet: "&quot;...<b>the lighthouse keeper counted every wave that broke against the northern rocks</b>, and..." } }],
  });
  assert.equal(books.length, 1);
  assert.equal(books[0].label, "“Sea Stories” by A. Writer");
  assert.deepEqual(books[0].source, { title: "Sea Stories", author: "A. Writer" });
  assert.equal(resultMatches(phrase, books[0], []), true);
  const tavily = normalizeResults("tavily", { results: [{ url: "https://example.com/a", title: "A page", content: "Once the lighthouse keeper counted every wave that broke against the northern rocks." }] });
  assert.equal(resultMatches(phrase, tavily[0], []), true);
  const brave = normalizeResults("brave", { web: { results: [{ url: "https://example.org", title: "t", description: "nothing alike" }] } });
  assert.equal(resultMatches(phrase, brave[0], []), false);
  assert.deepEqual(normalizeResults("books", {}), []);
  assert.deepEqual(normalizeResults("tavily", null), []);
});

test("each search service keeps its own monthly budget", () => {
  const state = {};
  const now = new Date("2026-10-20T00:00:00Z");
  const books = budget(state, now, 2, "search_books");
  const tavily = budget(state, now, 1, "search_tavily");
  books.spend();
  tavily.spend();
  assert.equal(books.left(), 1);
  assert.equal(tavily.left(), 0);
  assert.equal(budget(state, now, 1800).left(), 1800); // the original Brave budget is untouched
});

test("decide: hide only on strong matches from one source, otherwise a note or nothing", async () => {
  const { decide } = await import("../lib.mjs");
  assert.equal(decide(["A", "A", "A", "A", null]).action, "hide");
  assert.equal(decide(["A", "A", "A", "B", "B"]).action, "hide");
  // Found 4 times, but spread over different books: common wording, so only a note.
  assert.equal(decide(["A", "B", "C", "D", null]).action, "note");
  assert.equal(decide(["A", "A", null, null, null]).action, "note");
  assert.equal(decide(["A", null, null, null, null]).action, "none");
  assert.equal(decide([null, null, null]).action, "none");
  assert.equal(decide(["A", "A", "A", "A", null]).source, "A");
});

test("a writer's citation covers the book it names", async () => {
  const { citationCovers } = await import("../lib.mjs");
  const book = { title: "Pride and Prejudice", author: "Jane Austen" };
  assert.equal(citationCovers("Pride and Prejudice, Jane Austen", book), true);
  assert.equal(citationCovers("quoting Austen's Pride & Prejudice", book), true);
  assert.equal(citationCovers("Austen", book), false);
  assert.equal(citationCovers("Emma by Jane Austen", book), false);
  assert.equal(citationCovers("", book), false);
  assert.equal(citationCovers("from example.com", "www.example.com"), true);
  assert.equal(citationCovers("from my blog", "www.example.com"), false);
});

test("worthAsking stops searching when a note can no longer be reached", async () => {
  const { worthAsking } = await import("../lib.mjs");
  assert.equal(worthAsking(0, 3, 5), true);
  assert.equal(worthAsking(0, 4, 5), false);
  assert.equal(worthAsking(1, 4, 5), true);
});

test("a half-matching part gets a note, not a hide", async () => {
  const { isPartialDuplicate } = await import("../lib.mjs");
  const hashes = new Array(20).fill(0).map((_, i) => i);
  assert.equal(isPartialDuplicate(hashes, { key: "1:2", shared: 12, ratio: 0.6 }), true);
  assert.equal(isPartialDuplicate(hashes, { key: "1:2", shared: 18, ratio: 0.9 }), false);
  assert.equal(isPartialDuplicate(hashes, { key: "1:2", shared: 6, ratio: 0.3 }), false);
});

// ---------- AB-005: the earlier writer is never the one hidden ----------

// One run as check.mjs does it: parts in checkOrder, each compared with
// what is already indexed; a duplicate is flagged, anything else indexed.
function runLocal(stories, idx = new Index()) {
  const flagged = [];
  for (const p of checkOrder(stories)) {
    const key = p.story + ":" + p.seq;
    const hashes = fingerprint(p.text);
    const match = idx.bestMatch(hashes, p.author, key, p.at);
    if (match && isDuplicate(hashes, match)) flagged.push(key);
    else idx.add(key, p.author, hashes, p.at);
  }
  return flagged;
}

const COPY = ORIGINAL; // pasted word for word

test("a copy pasted into a lower-numbered story is hidden, not the original it copied", () => {
  const flagged = runLocal([
    { id: 5, parts: [{ seq: 2, author: "mallory", text: COPY, at: 2000 }] },   // copied later
    { id: 10, parts: [{ seq: 3, author: "wren", text: ORIGINAL, at: 1000 }] }, // written first
  ]);
  assert.deepEqual(flagged, ["5:2"]);
});

test("parts are checked oldest first; ties go by story, then part", () => {
  const order = checkOrder([
    { id: 5, parts: [{ seq: 1, at: 300 }, { seq: 2, at: 300 }] },
    { id: 3, parts: [{ seq: 7, at: 300 }, { seq: 8, at: 900 }] },
    { id: 9, parts: [{ seq: 1, at: 100 }] },
  ]).map((p) => p.story + ":" + p.seq);
  assert.deepEqual(order, ["9:1", "3:7", "5:1", "5:2", "3:8"]);
});

test("the final sweep never flags an original because a later copy is in the index", () => {
  const idx = new Index();
  idx.add("10:3", "wren", fingerprint(ORIGINAL), 1000);
  idx.add("5:2", "mallory", fingerprint(COPY), 2000); // e.g. restored by its opener, so indexed
  const again = idx.bestMatch(fingerprint(ORIGINAL), "wren", "10:3", 1000);
  assert.equal(again, null); // not even a source note
  const copy = idx.bestMatch(fingerprint(COPY), "mallory", "5:2", 2000);
  assert.equal(copy.key, "10:3");
  assert.ok(isDuplicate(fingerprint(COPY), copy));
});

test("when each part was written survives a save and load; older saved entries count as earlier", () => {
  const idx = new Index();
  idx.add("10:3", "wren", fingerprint(ORIGINAL), 1000);
  const back = Index.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
  assert.equal(back.bestMatch(fingerprint(COPY), "mallory", "5:2", 500), null);   // written before the original
  assert.equal(back.bestMatch(fingerprint(COPY), "mallory", "5:2", 2000).key, "10:3");
  const legacy = Index.fromJSON({ "10:3": { author: "wren", hashes: fingerprint(ORIGINAL) } });
  assert.equal(legacy.bestMatch(fingerprint(COPY), "mallory", "5:2", 2000).key, "10:3");
});

// ---------- AB-015: the checker signs only for the chain it expects ----------

import { createRequire } from "node:module";
import { checkChainId, expectedChainId } from "../lib.mjs";

const deployNetworks = createRequire(import.meta.url)("../../deploy/lib.js").NETWORKS;

test("the known nodes pin their chain ids, the same ones the deploy script uses", () => {
  for (const net of Object.values(deployNetworks)) {
    assert.equal(expectedChainId(net.rpc, ""), net.chainId, net.rpc);
  }
  assert.equal(expectedChainId("https://testnet.koinosfoundation.org/", undefined), deployNetworks.testnet.chainId);
});

test("another node needs EXPECTED_CHAIN_ID, which also overrides the known ones", () => {
  assert.throws(() => expectedChainId("https://my-node.example.com", ""), /EXPECTED_CHAIN_ID/);
  assert.equal(expectedChainId("https://my-node.example.com", "abc="), "abc=");
  assert.equal(expectedChainId("https://api.koinos.io", " abc= "), "abc=");
});

test("a node on a different chain stops the run before anything is signed", () => {
  assert.throws(() => checkChainId(deployNetworks.mainnet.chainId, deployNetworks.testnet.chainId), /chain id/);
  checkChainId("abc=", "abc=");
});
