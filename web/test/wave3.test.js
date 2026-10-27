// Wave 3 website rules: the Reader's Cut.
import assert from "node:assert/strict";
import test from "node:test";
import { applyCut, changedCount, cutCredits, cutKey, cutParts, hasChoices, loadCut, OUT, saveCut, versionOptions } from "../src/lib/readersCut.js";
import { bookFromBlocks } from "../src/lib/exportBook.js";

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const segments = [
  { author: "1A", text: "Opening line.", status: 1, version_count: 1 },
  { author: "1B", text: "Bob's part, edited.", status: 1, version_count: 3 },
  { author: "1C", text: "", status: 2, version_count: 2 },                 // removed by the final edit
  { author: "1D", text: "Hidden.", status: 1, hidden: true, version_count: 2 },
  { author: "1E", text: "", status: 2, taken_down: true, version_count: 2 }, // taken down
];

const bobVersions = [
  { version: 1, kind: 1, author: "1B", by: "1B", text: "Bob's first try." },
  { version: 2, kind: 2, author: "1B", by: "1X", text: "A paid change by X." },
  { version: 3, kind: 4, author: "1B", by: "1B", text: "Bob's part, edited." },
];
const caraVersions = [
  { version: 1, kind: 1, author: "1C", by: "1C", text: "Cara's lost scene." },
  { version: 2, kind: 5, author: "1C", by: "1A", text: "" },
];

test("wave 3: the cut offers book parts and removed parts, never hidden or taken-down ones", () => {
  const parts = cutParts(segments);
  assert.deepEqual(parts.map((p) => [p.seq, p.inBook]), [[1, true], [2, true], [3, false]]);
  assert.deepEqual(parts.filter(hasChoices).map((p) => p.seq), [2, 3]);
});

test("wave 3: versions without text are not offered, newest first", () => {
  assert.deepEqual(versionOptions(bobVersions).map((v) => v.version), [3, 2, 1]);
  assert.deepEqual(versionOptions(caraVersions).map((v) => v.version), [1]);
  assert.deepEqual(versionOptions([{ version: 1, kind: 3, text: "x" }]), []);
});

test("wave 3: with no choices the cut is the published book", () => {
  const parts = cutParts(segments);
  const blocks = applyCut(parts, {}, {});
  assert.deepEqual(blocks.map((b) => b.segment.text), ["Opening line.", "Bob's part, edited."]);
  assert.equal(changedCount(parts, blocks), 0);
});

test("wave 3: picking versions, bringing back a removed part and leaving one out", () => {
  const parts = cutParts(segments);
  const choices = { 1: OUT, 2: 2, 3: 1 };
  const blocks = applyCut(parts, choices, { 2: bobVersions, 3: caraVersions });
  assert.deepEqual(blocks.map((b) => [b.seq, b.segment.text, b.segment.author]), [
    [2, "A paid change by X.", "1X"],
    [3, "Cara's lost scene.", "1C"],
  ]);
  assert.equal(changedCount(parts, blocks), 3);
  const credits = cutCredits(blocks);
  assert.deepEqual(credits.map((c) => c.address), ["1X", "1C"]);
  assert.equal(credits.reduce((n, c) => n + c.share, 0), 100);
  const book = bookFromBlocks({ title: "T", status: 4 }, blocks, credits);
  assert.equal(book.chapters[0].paragraphs.length, 2);
});

test("wave 3: a pick whose versions aren't loaded, or that has no text, keeps the book's own text", () => {
  const parts = cutParts(segments);
  assert.equal(applyCut(parts, { 2: 1 }, {})[1].segment.text, "Bob's part, edited.");
  assert.equal(applyCut(parts, { 3: 2 }, { 3: caraVersions }).length, 2);
  // Choosing the published version again isn't a change.
  const same = applyCut(parts, { 2: 3 }, { 2: bobVersions });
  assert.equal(changedCount(parts, same), 0);
});

test("wave 3: choices are saved per story and bad saved data is ignored", () => {
  const store = memoryStore();
  const key = cutKey("1Stories", 7);
  assert.equal(key, "st-cut:1Stories:7");
  assert.equal(saveCut(key, { 2: 1, 3: OUT }, store), true);
  assert.deepEqual(loadCut(key, store), { 2: 1, 3: OUT });
  store.setItem(key, JSON.stringify({ 2: "<script>", x: 1, 3: -1, 4: 2.5, 5: OUT }));
  assert.deepEqual(loadCut(key, store), { 5: OUT });
  store.setItem(key, "not json");
  assert.deepEqual(loadCut(key, store), {});
  saveCut(key, {}, store);
  assert.equal(store.getItem(key), null);
  assert.deepEqual(loadCut(key, null), {});
});

import { splitSale, tokenIdHex, writerEdition, kindLabel } from "../src/lib/editions.js";
import { abis } from "../src/generated/abis.js";

test("wave 3: the Editions ABI has the reader, writer and KCS-5 methods", () => {
  const m = abis.editions.methods;
  for (const name of ["buy_edition", "claim_writer_edition", "claim_earnings", "set_book_price", "transfer", "burn"]) assert.ok(m[name] && !m[name].read_only, name);
  for (const name of ["get_price", "get_earnings", "get_book_editions", "owner_of", "metadata_of", "balance_of", "get_tokens_by_owner"]) assert.equal(m[name].read_only, true, name);
  assert.ok(JSON.stringify(abis.stories.koilib_types).includes("surviving_sum"), "Stories' story record has surviving_sum");
});

test("wave 3: a price splits like the contract splits it", () => {
  assert.deepEqual(splitSale(3000000n, 2000), { toTreasury: 600000n, toWriters: 2400000n });
  assert.deepEqual(splitSale(7n, 2000), { toTreasury: 1n, toWriters: 6n });
  assert.deepEqual(splitSale("18446744073709551615", 3000), { toTreasury: 5534023222112865484n, toWriters: 12912720851596686131n });
});

test("wave 3: who may claim which free edition", () => {
  const story = { status: 4, opener: "1O", contributor_edition_min: "50" };
  const credits = [{ address: "1O", chars: 10 }, { address: "1W", chars: 60 }, { address: "1S", chars: 20 }];
  assert.equal(writerEdition(story, "1O", credits).kind, "first");
  assert.equal(writerEdition(story, "1W", credits).kind, "contributor");
  assert.match(writerEdition(story, "1S", credits).reason, /20 characters; a Contributor Edition needs 50/);
  assert.equal(writerEdition(story, "1R", credits).kind, null);
  assert.equal(writerEdition({ ...story, status: 1 }, "1O", credits).kind, null);
  assert.equal(writerEdition({ ...story, contributor_edition_min: "0" }, "1S", credits).kind, "contributor");
  assert.equal(kindLabel(3), "Collector's Edition");
  assert.equal(tokenIdHex(258), "0x0000000000000102");
});

import { promptsNow } from "../src/lib/spotlight.js";

test("wave 3: this week's prompt is the newest one that has started", () => {
  const list = [
    { start: "2026-11-02", storyId: "3", prompt: "A" },
    { start: "2026-11-09", storyId: "4", prompt: "B" },
    { start: "2026-11-16", storyId: "5", prompt: "C" },
    { start: "bad", storyId: "6", prompt: "D" },
    { start: "2026-11-01", storyId: "0", prompt: "E" },
  ];
  const at = (d) => promptsNow(list, new Date(d + "T12:00:00Z"));
  assert.equal(at("2026-10-30").current, null);
  assert.equal(at("2026-11-02").current.prompt, "A");
  assert.equal(at("2026-11-12").current.prompt, "B");
  assert.deepEqual(at("2026-11-12").past.map((p) => p.prompt), ["A"]);
  assert.deepEqual(at("2027-01-01").past.map((p) => p.prompt), ["B", "A"]);
  assert.equal(promptsNow([], new Date()).current, null);
});
