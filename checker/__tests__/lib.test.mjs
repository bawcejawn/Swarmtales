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
  idx.add("1:2", "alice", fingerprint(ORIGINAL), 1000);
  const copy = ORIGINAL.replace("Nell", "Nora").toUpperCase();
  const hashes = fingerprint(copy);
  const match = idx.bestMatch(hashes, "mallory", "2:5", 2000);
  assert.equal(match.key, "1:2");
  assert.ok(isDuplicate(hashes, match), JSON.stringify(match));
});

test("different writing does not match", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL), 1000);
  const other = "Rain had soaked the market stalls by noon, and the fishmonger sang louder to keep the customers from drifting " +
    "toward the bakery, where the ovens kept everyone warm and dry while the gulls argued over scraps behind the harbour wall.";
  const hashes = fingerprint(other);
  assert.equal(isDuplicate(hashes, idx.bestMatch(hashes, "bob", "3:1", 2000)), false);
});

test("a writer reusing their own words is not flagged", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL), 1000);
  assert.equal(idx.bestMatch(fingerprint(ORIGINAL), "alice", "4:1", 2000), null);
});

test("short parts are never judged", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint("A short line here."), 1000);
  const hashes = fingerprint("A short line here.");
  assert.equal(isDuplicate(hashes, idx.bestMatch(hashes, "bob", "1:3", 2000)), false);
});

test("the index survives a save and load", () => {
  const idx = new Index();
  idx.add("1:2", "alice", fingerprint(ORIGINAL), 1000);
  const back = Index.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
  assert.equal(back.bestMatch(fingerprint(ORIGINAL), "bob", "9:9", 2000).key, "1:2");
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
  const b = budget(state, new Date("2026-10-20T00:00:00Z"), 3, "search_books");
  b.spend(); b.spend();
  assert.equal(b.left(), 1);
  const next = budget(state, new Date("2026-11-01T00:00:00Z"), 3, "search_books");
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
  assert.equal(budget(state, now, 1800, "search_brave").left(), 1800); // the Brave budget is untouched
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

test("when each part was written survives a save and load; an unknown date never proves who was first", () => {
  const idx = new Index();
  idx.add("10:3", "wren", fingerprint(ORIGINAL), 1000);
  const back = Index.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
  assert.equal(back.bestMatch(fingerprint(COPY), "mallory", "5:2", 500), null);   // written before the original
  assert.equal(back.bestMatch(fingerprint(COPY), "mallory", "5:2", 2000).key, "10:3");
  const undated = Index.fromJSON({ "10:3": { author: "wren", hashes: fingerprint(ORIGINAL) } });
  assert.equal(undated.bestMatch(fingerprint(COPY), "mallory", "5:2", 2000), null);
  assert.equal(back.bestMatch(fingerprint(COPY), "mallory", "5:2", 0), null);
});

// ---------- AB-024: parts written at the same time are never hidden ----------

test("a match written at the same time is never a hide match, only a tie for a note on both", () => {
  const idx = new Index();
  idx.add("5:9", "mallory", fingerprint(COPY), 1000);   // same block, lower story id
  assert.equal(idx.bestMatch(fingerprint(ORIGINAL), "wren", "10:4", 1000), null);
  const tie = idx.tieMatch(fingerprint(ORIGINAL), "wren", "10:4", 1000);
  assert.equal(tie.key, "5:9");
  assert.equal(tie.at, 1000);
  assert.ok(isDuplicate(fingerprint(ORIGINAL), tie));
  assert.equal(idx.tieMatch(fingerprint(ORIGINAL), "wren", "10:4", 1001), null);   // not a tie: a later part
  assert.equal(idx.bestMatch(fingerprint(ORIGINAL), "wren", "10:4", 1001).key, "5:9");
  assert.deepEqual(runLocal([
    { id: 10, parts: [{ seq: 4, author: "wren", text: ORIGINAL, at: 1000 }] },
    { id: 5, parts: [{ seq: 9, author: "mallory", text: COPY, at: 1000 }] },
  ]), []);
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

// ---------- audit 2026-10 ----------

import {
  cleanNote, logLine, mdCell, mdFence, normalizeResults, noteAllowed, provablyOlder, publishedEnd, readParts, recordSent,
} from "../lib.mjs";

test("O1-08: any text becomes a note the contract accepts (and the contract's rule is ported faithfully)", () => {
  assert.equal(noteAllowed("A fine note."), true);
  for (const bad of ["a\nb", "a\u0007b", "a\u0085b", "a​b", "a﻿b", "a b", "a⁡b", "a‮b", "a⁧b",
    "a\uD800b", "a\uDC00b", "a�b", "  　‍", "x".repeat(201)]) assert.equal(noteAllowed(bad), false, JSON.stringify(bad));
  const cases = ["“Title”\nby\tSomeone", "‮evil‬ title", "\uD83D", "​​", "", "  ", "x".repeat(500), "😀".repeat(150),
    "a" + "😀".repeat(100), "�\uDC00 ok", "⁦⁩", " 　", "abc\u0000def", "\u0085next line"];
  // And a few thousand random strings from the troublesome ranges.
  const pool = [0x0a, 0x0d, 0x07, 0x7f, 0x85, 0xa0, 0x200b, 0x200d, 0x2028, 0x2060, 0x202e, 0x2068, 0xfeff, 0xfffd, 0xd83d, 0xde00, 0x3000, 0x41, 0x20, 0xe9];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000; i++) cases.push(Array.from({ length: Math.floor(rnd() * 260) }, () => String.fromCharCode(pool[Math.floor(rnd() * pool.length)])).join(""));
  for (const text of cases) {
    const out = cleanNote(text, "copied text");
    assert.ok(out.length > 0 && noteAllowed(out), JSON.stringify(text) + " -> " + JSON.stringify(out));
  }
  assert.equal(cleanNote("​ ", ""), "");
  assert.equal(cleanNote("  Parts of “A‮B” appear  "), "Parts of “AB” appear");
  const long = cleanNote("😀".repeat(150));
  assert.ok(long.length <= 200 && long.endsWith("…"));
});

test("O1-08: book titles and authors from the search answer are cleaned before they can reach a note", () => {
  const [hit] = normalizeResults("books", { items: [{ id: "x", volumeInfo: { title: "Evil\n::error::‮title " + "x".repeat(300), authors: ["A​B"], publishedDate: "1999" } }] });
  assert.ok(noteAllowed("Parts of this text also appear in " + hit.label + "."), hit.label);
  assert.ok(hit.label.length < 160);
  assert.equal(hit.kind, "book");
  assert.equal(hit.published, "1999");
  assert.deepEqual(normalizeResults("books", { items: "nope" }), []);
  assert.equal(normalizeResults("tavily", { results: [{ url: "https://x.example" }] })[0].kind, "web");
});

test("M-11: a book counts as older than a part only when its whole publication period is (a day's margin)", () => {
  const at = (iso) => Date.parse(iso) / 1000;
  assert.equal(publishedEnd("2011"), at("2012-01-01T00:00:00Z"));
  assert.equal(publishedEnd("2011-09"), at("2011-10-01T00:00:00Z"));
  assert.equal(publishedEnd("2011-09-13"), at("2011-09-14T00:00:00Z"));
  assert.equal(publishedEnd("1960") < 0, true, "before 1970 is still a date");
  for (const bad of ["", "soon", "2011-13", "2011-00-01", "11", "2011-9-1", "1990s", null, undefined]) assert.equal(publishedEnd(bad), null, String(bad));
  assert.equal(provablyOlder("2011", at("2012-01-02T00:00:00Z")), true);
  assert.equal(provablyOlder("2011", at("2011-12-31T00:00:00Z")), false, "same year: not provably older");
  assert.equal(provablyOlder("2011-09-13", at("2011-09-14T12:00:00Z")), false, "within a day: time zones");
  assert.equal(provablyOlder("1960", 1000), true);
  assert.equal(provablyOlder("", at("2030-01-01T00:00:00Z")), false, "unknown date");
  assert.equal(provablyOlder("1960", 0), false, "unknown part date");
});

test("Info: user text can't break out of the run summary or form a workflow command", () => {
  assert.equal(mdCell("a|b"), "a\\|b");
  assert.doesNotMatch(mdCell("[click](https://evil.example) <img src=x> ![i](y)"), /(^|[^\\])[[\]()<>!]/);
  const text = "line\n```\n# not a heading\n````";
  const block = mdFence(text);
  const fence = block.split("\n")[0];
  assert.ok(fence.length >= 5 && /^`+$/.test(fence));
  assert.ok(!text.split("\n").some((l) => l.startsWith(fence)), "no line of the text can close the fence");
  assert.equal(logLine("title\n::error::boom\r\n::add-mask::x").includes("\n"), false);
});

/** A fake Stories read for readParts: `count` parts; pages over `limitBytes` of text fail; log of calls. */
function partsReader(texts, limitBytes, calls) {
  return async (name, args) => {
    calls.push(name + ":" + args.start + (args.seq ? ":" + args.seq : "") + (args.limit ? "x" + args.limit : ""));
    if (name === "get_segment") return { status: 1, text: texts[Number(args.seq) - 1] };
    const start = Number(args.start);
    const values = texts.slice(start - 1, start - 1 + Math.min(10, args.limit)).map((text) => ({ status: 1, text }));
    if (values.length > 1 && values.reduce((n, v) => n + Buffer.byteLength(v.text), 0) > limitBytes) throw new Error("read limit");
    const next = start + values.length;
    return { values, next: next <= texts.length ? String(next) : "0" };
  };
}

test("M-5: parts are read a few at a time, paged by next, and one at a time when a page is too big", async () => {
  const cjk = "漢".repeat(6000); // 18 KB of UTF-8 each
  const texts = ["short one", cjk, cjk, cjk, "short two", cjk, cjk];
  const calls = [];
  const got = await readParts(partsReader(texts, 30000, calls), 1, 1, texts.length, 3);
  assert.deepEqual(got.map((p) => p.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(got.map((p) => p.seg.text), texts);
  assert.ok(calls.every((c) => !/x(\d+)/.test(c) || Number(/x(\d+)/.exec(c)[1]) <= 3), calls.join(" "));
  assert.ok(calls.some((c) => c.startsWith("get_segment:")), "fell back to single reads");
  // Starts where asked, stops at the end.
  const calls2 = [];
  assert.deepEqual((await readParts(partsReader(texts, 1e9, calls2), 1, 5, 7, 3)).map((p) => p.seq), [5, 6, 7]);
  assert.deepEqual(calls2, ["get_segments:5x3"]);
});

test("M-5: a page that would skip parts, or a part that can't be read even alone, fails the story (retried next run)", async () => {
  const skipping = async () => ({ values: [{ status: 1, text: "a" }], next: "5" });
  await assert.rejects(readParts(skipping, 1, 1, 9, 3), /next 5/);
  const broken = async (name) => { throw new Error(name + " failed"); };
  await assert.rejects(readParts(broken, 1, 1, 3, 3), /get_segment failed/);
});

test("recordSent: only a sent hide becomes the checker's own; a sent unhide is kept as cited", () => {
  const state = { seen: { "1:1": { t: "t1", v: "copy", reason: 1, sourceKind: "book", published: "1960" } } };
  recordSent(state, { kind: "hide", story: 1, seq: 1, t: "t1", src: { title: "B", author: "A" }, label: "“B” by A" });
  assert.deepEqual(state.hiddenByChecker["1:1"], { source: { title: "B", author: "A" }, label: "“B” by A", t: "t1" });
  recordSent(state, { kind: "unhide", story: 1, seq: 1, t: "t1", src: { title: "B", author: "A" }, label: "“B” by A" });
  assert.equal(state.hiddenByChecker["1:1"], undefined);
  assert.equal(state.seen["1:1"].v, "cited");
  assert.equal(state.seen["1:1"].published, "1960", "the evidence stays, so clearing the citation hides it again");
  recordSent(state, { kind: "note", story: 2, seq: 1, t: "t2" });
  assert.equal(state.hiddenByChecker["2:1"], undefined);
});

test("I-14: the mainnet community node koinos.armana.io maps to the mainnet chain id, as on the website and in the deploy tool", async () => {
  const MAINNET = "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==";
  assert.equal(expectedChainId("https://koinos.armana.io", ""), MAINNET);
  assert.equal(expectedChainId("https://koinos.armana.io/", undefined), MAINNET);
  assert.equal(expectedChainId("https://api.koinos.io", ""), MAINNET);
  assert.equal(deployNetworks.mainnet.rpc, "https://koinos.armana.io");
  assert.equal(deployNetworks.mainnet.chainId, MAINNET);
  const { NETWORKS } = await import("../../web/src/config.js");
  assert.equal(NETWORKS.mainnet.rpc, "https://koinos.armana.io");
  assert.equal(NETWORKS.mainnet.chainId, MAINNET);
});

test("L-12: the checker's Stories ABI is the committed, hash-checked file, built from stories.proto", async () => {
  const fsMod = await import("node:fs");
  const { STORIES_ABI_SHA256, abiHash, loadStoriesAbi } = await import("../chain.mjs");
  const { buildAbi } = await import("../../web/scripts/build-abi.mjs");
  const text = fsMod.readFileSync(new URL("../stories.abi.json", import.meta.url), "utf8");
  assert.equal(abiHash(text), STORIES_ABI_SHA256, "run node checker/make-abi.mjs and update STORIES_ABI_SHA256");
  assert.deepEqual(loadStoriesAbi(), buildAbi("stories/assembly/proto/stories.proto"), "the committed ABI is the one stories.proto builds");
  assert.equal(abiHash(text.replace(/\n/g, "\r\n")), STORIES_ABI_SHA256, "line endings don't matter");
  const tampered = text.replace('"set_segment_hidden"', '"set_segment_hidden2"');
  assert.throws(() => loadStoriesAbi(tampered), /not the reviewed Stories ABI/);
});

test("L-12: the apply job (moderator key) builds no ABI at run time", async () => {
  const fs = await import("node:fs");
  const yml = fs.readFileSync(new URL("../../.github/workflows/copy-checker.yml", import.meta.url), "utf8");
  const apply = yml.slice(yml.indexOf("\n  apply:"), yml.indexOf("\n  keep-schedule:"));
  assert.doesNotMatch(apply, /npm run abi/);
  assert.match(apply, /npm ci --ignore-scripts/);
  assert.doesNotMatch(fs.readFileSync(new URL("../chain.mjs", import.meta.url), "utf8"), /generated\/abis/);
});

test("I-13: every web request and node call in the checker has a time limit", async () => {
  const fs = await import("node:fs");
  const { FETCH_TIMEOUT_MS, RPC_TIMEOUT_MS, withTimeout } = await import("../chain.mjs");
  assert.equal(await withTimeout(Promise.resolve(7), 1000, "x"), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "The node"), /The node did not answer within 0 s/);
  assert.ok(FETCH_TIMEOUT_MS > 0 && RPC_TIMEOUT_MS > 0);
  const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
  const check = read("check.mjs");
  assert.equal((check.match(/fetch\(/g) || []).length, (check.match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) || []).length, "each fetch has a timeout");
  assert.match(read("chain.mjs"), /withTimeout\(stories\.functions\[name\]/);
  const apply = read("apply.mjs");
  assert.match(apply, /withTimeout\(provider\.getAccountRc/);
  assert.match(apply, /withTimeout\(tx\.send\(\)/);
  assert.match(apply, /tx\.wait\("byBlock", \d+\)/);
});
