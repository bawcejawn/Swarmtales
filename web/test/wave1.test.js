// Wave 1 (October 2026): drafts, following, credits, downloads, support,
// version changes and feeds. Pure functions only; no browser, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { agoText, clearDraft, draftKey, loadDraft, saveDraft, DRAFT_DAYS } from "../src/lib/drafts.js";
import { followed, isFollowing, markSeen, newParts, setFollow, MAX_FOLLOWS } from "../src/lib/follow.js";
import { sharePercents, storyCredits } from "../src/lib/credits.js";
import { parseTip, splitTip, MAX_TIP_RECIPIENTS } from "../src/lib/tip.js";
import { crc32, unzipStored, zip } from "../src/lib/zip.js";
import { bookFromBlocks, fileBase, toDocx, toEpub, toHtml, toMarkdown, xmlEscape } from "../src/lib/exportBook.js";
import { diffCounts, wordDiff } from "../src/lib/diff.js";
import { escapeXml, feedXml, latestParts, newestStories } from "../scripts/feeds-lib.mjs";

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const A = "1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

// ---------- drafts ----------

test("drafts: unsent text is kept per writing box, restored, and cleared after sending", () => {
  const store = memoryStore();
  const k = draftKey("1STORIES", 7, 0);
  assert.notEqual(k, draftKey("1STORIES", 7, 3), "a box between parts has its own draft");
  assert.equal(loadDraft(k, store), null);
  assert.equal(saveDraft(k, "Once upon a time", store, 1000), true);
  assert.deepEqual(loadDraft(k, store, 2000), { text: "Once upon a time", at: 1000 });
  saveDraft(k, "   ", store, 3000);
  assert.equal(loadDraft(k, store), null, "empty text removes the draft");
  saveDraft(k, "again", store, 1000);
  clearDraft(k, store);
  assert.equal(loadDraft(k, store), null);
});

test("drafts: old drafts expire, broken ones are ignored, a full browser doesn't throw", () => {
  const store = memoryStore();
  const k = draftKey("1S", 1, 0);
  saveDraft(k, "old", store, 0);
  assert.equal(loadDraft(k, store, (DRAFT_DAYS + 1) * 86400000), null);
  store.setItem(k, "{not json");
  assert.equal(loadDraft(k, store), null);
  const full = { ...memoryStore(), setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(saveDraft(k, "text", full), false);
  assert.equal(agoText(0, 30000), "just now");
  assert.equal(agoText(0, 5 * 60000), "5 minutes ago");
  assert.equal(agoText(0, 3 * 3600000), "3 hours ago");
  assert.equal(agoText(0, 3 * 86400000), "3 days ago");
});

// ---------- following ----------

test("follow: follow and unfollow, newest first, with a cap", () => {
  const store = memoryStore();
  assert.equal(isFollowing("1S", 4, store), false);
  setFollow("1S", 4, true, "Four", store, 10);
  setFollow("1S", 9, true, "Nine", store, 20);
  assert.equal(isFollowing("1S", "4", store), true);
  assert.deepEqual(followed("1S", store).map((f) => f.id), ["9", "4"]);
  setFollow("1S", 4, false, "", store);
  assert.deepEqual(followed("1S", store).map((f) => f.id), ["9"]);
  assert.equal(isFollowing("1OTHER", 9, store), false, "per contract");
  for (let i = 100; i < 100 + MAX_FOLLOWS; i++) setFollow("1S", i, true, "", store);
  assert.equal(followed("1S", store).length, MAX_FOLLOWS);
  assert.equal(setFollow("1S", 999, true, "", store), false, "no more than MAX_FOLLOWS");
});

test("follow: new parts since the last visit", () => {
  const store = memoryStore();
  assert.equal(newParts("1S", 3, 12, store), 0, "never opened: nothing is 'new'");
  markSeen("1S", 3, 12, store);
  assert.equal(newParts("1S", 3, 12, store), 0);
  assert.equal(newParts("1S", 3, 15, store), 3);
  assert.equal(newParts("1S", 3, 10, store), 0, "never negative");
});

// ---------- credits ----------

test("credits: whole percents always add up to 100", () => {
  assert.deepEqual(sharePercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(sharePercents([0, 0]), [0, 0]);
  assert.deepEqual(sharePercents([5]), [100]);
  for (const set of [[7, 13, 80], [1, 2, 3, 4, 5, 6], [999, 1, 1]]) {
    assert.equal(sharePercents(set).reduce((a, b) => a + b, 0), 100);
  }
});

test("credits: counted per writer, skipping removed and hidden parts; finished books count what survived", () => {
  const seg = (author, current, extra = {}) => ({ segment: { author, current_cost: String(current), status: 1, ...extra } });
  const open = { status: 1 };
  const blocks = [seg(A, 300), seg(B, 100), seg(A, 100), seg(C, 500, { status: 2 }), seg(C, 50, { hidden: true })];
  assert.deepEqual(storyCredits(open, blocks), [
    { address: A, chars: 400, share: 80 },
    { address: B, chars: 100, share: 20 },
  ]);
  const done = [seg(A, 300, { surviving: "150" }), seg(B, 100, { surviving: "150" })];
  assert.deepEqual(storyCredits({ status: 4 }, done).map((c) => c.share), [50, 50]);
});

// ---------- support the writers ----------

test("tip: amounts parse in the token's decimals and refuse anything odd", () => {
  assert.equal(parseTip("1", 8), 100000000n);
  assert.equal(parseTip("2.5", 8), 250000000n);
  assert.equal(typeof parseTip("0", 8), "string");
  assert.equal(typeof parseTip("1.123456789", 8), "string");
  assert.equal(typeof parseTip("-1", 8), "string");
  assert.equal(typeof parseTip("1e3", 8), "string");
  assert.equal(typeof parseTip("999999999999", 18), "string", "above 2^64-1 is refused (M-C)");
});

test("tip: the split is exact, by characters, leaves out the payer and caps the number of writers", () => {
  const credits = [{ address: A, chars: 600 }, { address: B, chars: 300 }, { address: C, chars: 100 }];
  const split = splitTip(1000n, credits, "");
  assert.deepEqual(split.map((s) => [s.address, s.value]), [[A, 600n], [B, 300n], [C, 100n]]);
  const odd = splitTip(10n, credits, "");
  assert.equal(odd.reduce((n, s) => n + s.value, 0n), 10n, "adds up exactly");
  const notMe = splitTip(1000n, credits, A);
  assert.deepEqual(notMe.map((s) => s.address), [B, C]);
  assert.equal(notMe.reduce((n, s) => n + s.value, 0n), 1000n);
  assert.deepEqual(splitTip(1000n, [{ address: A, chars: 10 }], A), [], "nobody else to pay");
  // Too small to give everyone something: the smallest shares drop out, nothing is lost.
  const tiny = splitTip(2n, credits, "");
  assert.deepEqual(tiny.map((s) => s.value), [1n, 1n]);
  const many = Array.from({ length: 15 }, (_, i) => ({ address: "1W" + String(i).padStart(32, "0"), chars: 100 - i }));
  const capped = splitTip(100000n, many, "");
  assert.equal(capped.length, MAX_TIP_RECIPIENTS);
  assert.equal(capped.reduce((n, s) => n + s.value, 0n), 100000n);
});

// ---------- downloads ----------

test("zip: entries read back with the right names, data and CRC-32", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const bytes = zip([{ name: "mimetype", data: "application/epub+zip" }, { name: "a/b.txt", data: "héllo" }]);
  const entries = unzipStored(bytes);
  assert.deepEqual(entries.map((e) => e.name), ["mimetype", "a/b.txt"]);
  assert.equal(new TextDecoder().decode(entries[1].data), "héllo");
  assert.equal(entries[1].crc, crc32(entries[1].data));
});

const sample = () => bookFromBlocks(
  { title: "The <Little> Jawn & Co", status: 4 },
  [
    { segment: { text: "First line.\nSecond <b>line</b>.", status: 1, author: A } },
    { segment: { text: "Removed", status: 2, author: B } },
    { segment: { text: "Hidden", status: 1, hidden: true, author: B } },
    { segment: { text: "New chapter here.", status: 1, starts_chapter: true, author: B } },
  ],
  [{ address: A, chars: 30, share: 60 }, { address: B, chars: 20, share: 40 }],
  { storyId: "1", network: "Koinos testnet", contract: "1STORIES" }
);

test("export: chapters and paragraphs skip removed and hidden parts", () => {
  const book = sample();
  assert.equal(book.chapters.length, 2);
  assert.deepEqual(book.chapters[0].paragraphs, ["First line.", "Second <b>line</b>."]);
  assert.deepEqual(book.chapters[1].paragraphs, ["New chapter here."]);
  assert.equal(fileBase("The <Little> Jawn & Co"), "The-Little-Jawn-Co");
});

test("export: EPUB starts with an uncompressed mimetype and escapes all story text", () => {
  const entries = unzipStored(toEpub(sample()));
  assert.equal(entries[0].name, "mimetype");
  assert.equal(new TextDecoder().decode(entries[0].data), "application/epub+zip");
  const names = entries.map((e) => e.name);
  for (const n of ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml", "OEBPS/credits.xhtml"]) assert.ok(names.includes(n), n);
  const all = entries.map((e) => new TextDecoder().decode(e.data)).join("\n");
  assert.ok(!all.includes("<b>line</b>"), "story text never becomes markup");
  assert.ok(all.includes("&lt;b&gt;line&lt;/b&gt;"));
  assert.ok(all.includes("The &lt;Little&gt; Jawn &amp; Co"));
  assert.ok(all.includes(A + " — 60%"));
  assert.ok(!all.includes("Removed") && !all.includes("Hidden"));
  // The same book always gives the same file.
  assert.deepEqual(toEpub(sample()), toEpub(sample()));
});

test("export: Word, Markdown and HTML carry the text and the credits", () => {
  const docx = unzipStored(toDocx(sample()));
  assert.deepEqual(docx.map((e) => e.name).sort(), ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
  const doc = new TextDecoder().decode(docx.find((e) => e.name === "word/document.xml").data);
  assert.ok(doc.includes("Second &lt;b&gt;line&lt;/b&gt;."));
  assert.ok(doc.includes(B + " — 40%"));
  const md = toMarkdown(sample());
  assert.match(md, /^# The \\<Little\\> Jawn \\& Co/);
  assert.ok(md.includes("Second \\<b\\>line\\</b\\>."), "no raw HTML can come from a part");
  assert.match(md, /## Chapter 2\n\nNew chapter here\./);
  const html = toHtml(sample());
  assert.ok(html.includes("<p>Second &lt;b&gt;line&lt;/b&gt;.</p>"));
  assert.equal(xmlEscape("a\u0001b"), "ab", "characters XML can't hold are dropped");
});

// ---------- version changes ----------

test("diff: words added and removed, and the pieces rebuild both versions", () => {
  const before = "The dog ran to the old barn.";
  const after = "The brown dog ran to the barn quickly.";
  const pieces = wordDiff(before, after);
  const rebuild = (ops) => pieces.filter((p) => ops.includes(p.op)).map((p) => p.text).join("");
  assert.equal(rebuild(["same", "add"]), after);
  assert.equal(rebuild(["same", "del"]), before);
  assert.deepEqual(diffCounts(pieces), { added: 3, removed: 2 });
  assert.deepEqual(wordDiff("same text", "same text"), [{ op: "same", text: "same text" }]);
  assert.deepEqual(wordDiff("", "new"), [{ op: "add", text: "new" }]);
});

// ---------- feeds ----------

test("feeds: newest visible parts of public stories, escaped", () => {
  const site = "https://example.org/";
  const rows = [
    { id: 1, story: { title: "Pub <1>", visibility: 1, created_at: "100", kind: 2 }, parts: [
      { seq: 1, segment: { text: "Old", created_at: "100", status: 1 } },
      { seq: 2, segment: { text: "New & <shiny>", created_at: "300", status: 1 } },
      { seq: 3, segment: { text: "Hidden", created_at: "400", status: 1, hidden: true } },
      { seq: 4, segment: { text: "Gone", created_at: "500", status: 2 } },
    ] },
    { id: 2, story: { title: "Private", visibility: 3, created_at: "200" }, parts: [{ seq: 1, segment: { text: "Secret", created_at: "600", status: 1 } }] },
  ];
  const parts = latestParts(rows, site, 10);
  assert.deepEqual(parts.map((p) => p.description), ["New & <shiny>", "Old"]);
  assert.equal(parts[0].guid, site + "#/stories/1/part/2");
  assert.deepEqual(newestStories(rows, site, 10).map((s) => s.title), ["Pub <1>"]);
  const xml = feedXml({ title: "T", link: site, self: site + "feeds/latest.xml", description: "D", items: parts, now: new Date(0) });
  assert.ok(xml.includes("New &amp; &lt;shiny&gt;"));
  assert.ok(!xml.includes("<shiny>"));
  assert.ok(!xml.includes("Secret"));
  assert.equal(escapeXml("\u0007ok"), "ok");
});

test("export: Markdown can't carry raw HTML, links or images from story text", async () => {
  const { mdText } = await import("../src/lib/exportBook.js");
  assert.equal(mdText("<img src=x onerror=alert(1)>"), "\\<img src=x onerror=alert(1)\\>");
  assert.equal(mdText("[x](javascript:alert(1))"), "\\[x\\](javascript:alert(1))");
  assert.equal(mdText("![i](http://e/x.png)"), "\\!\\[i\\](http://e/x.png)");
  assert.equal(mdText("# not a heading"), "\\# not a heading");
});

test("follow: a browser that refuses to save leaves the state unchanged", () => {
  const refusing = { ...memoryStore(), setItem: () => { throw new Error("blocked"); } };
  assert.equal(setFollow("1S", 5, true, "", refusing), false);
  assert.equal(isFollowing("1S", 5, refusing), false);
});

test("credits: a finished part that didn't survive the final edit counts 0", () => {
  const seg = (author, extra) => ({ segment: { author, current_cost: "500", status: 1, ...extra } });
  assert.deepEqual(storyCredits({ status: 4 }, [seg(A, { surviving: "100" }), seg(B, { surviving: "0" })]).map((c) => c.address), [A]);
});

test("offline: only a lost connection falls back to the saved copy", async () => {
  const { looksOffline } = await import("../src/lib/offline.js");
  assert.equal(looksOffline(new TypeError("Failed to fetch"), true), true);
  assert.equal(looksOffline(new Error("anything"), false), true, "the browser says it's offline");
  assert.equal(looksOffline(new Error("This page is set up for the Koinos testnet, but the node answered with another chain"), true), false);
  assert.equal(looksOffline(new Error("STORIES: unknown story"), true), false);
});
