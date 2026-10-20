import assert from "node:assert/strict";
import test from "node:test";
import { Index, budget, fingerprint, isDuplicate, pickPhrases, resultMatches, words } from "../lib.mjs";

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
