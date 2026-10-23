// Red-team (Insider) attack tests, SwarmTales fix check @ d82364b.
// Target: checker/check.mjs (the copy checker, moderator key). Roles: a
// story opener (or editor) who wrote, or wants to keep, copied text, plus a
// few friendly writer wallets.
//
// L1 "launder through reports": the opener has friends report her copied
//   part (report_threshold writer reports) before the hourly run. The run
//   sees it hidden (hidden_by 1) and records state.hiddenWhenRead. She then
//   restores it (allowed for a reports hide, and NOT refund-forfeiting:
//   restore_segment only forfeits hidden_by 2). restore sets seg.restored,
//   and checkPart never hides a restored part (`!seg.restored`, check.mjs
//   ~375 and ~399). So the checker's later check of the visible part can
//   only add a note: the opener overrode a checker hide that never happened,
//   and kept her full refund. (RT-IMP B accepted a note; this asserts the
//   copied text is hidden, because nobody ever overrode the checker.)
// L2 "edit after the check": the writer posts original text, the run checks
//   it clean (state.checked marks the seq done), then rewords it for free
//   (edit_segment) into copied text. Parts are only ever read once
//   (state.checked) and the "full story" sweep doesn't search the web, so the
//   copied text is never checked.
// L3 "cite, get unhidden, un-cite": the checker hid a copied part; the writer
//   sets a citation naming the source, the checker unhides it (and the part
//   is refundable again, per docs); the writer then clears the citation. The
//   uncited copy stays up: nothing re-checks it.
//
// Each attack test asserts the SAFE behaviour and FAILS while the attack works.
// Runs the real checker (load, plan, apply) through the shared harness (harness.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { BOOKPAGE, MOD, WRITER, run as runChecker, workdir, writeState } from "./harness.mjs";

const BOOK = { title: "The Night Circus", author: "Erin Morgenstern", published: "1960" };
const CITATION = "From The Night Circus by Erin Morgenstern";
const COPIED = BOOKPAGE;

/** One run (load, plan, apply); { wif, books }: whether the moderator key and the Google Books key are set. */
function run(dir, scenario, { wif = true, books = false } = {}) {
  return runChecker(dir, { book: null, copiedText: COPIED, ...scenario }, { MODERATOR_WIF: wif ? "5Kfake-moderator-wif" : "", GOOGLE_BOOKS_KEY: books ? "fake-key" : "" });
}

const config = { moderator: MOD, next_story_id: "2" };
const story = { "1": { status: 1, segment_count: "1" } };
const entry = { "1:1": { source: BOOK, label: "“The Night Circus” by Erin Morgenstern" } };
const hiddenPart = (hiddenBy) => ({
  "1:1": { status: 1, hidden: true, hidden_by: hiddenBy, citation: CITATION, author: WRITER, text: COPIED, created_at: "1000" },
});
const unhides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === false && String(o.args.seq) === "1");
const hides = (ops) => ops.filter((o) => o.op === "set_segment_hidden" && o.args.hidden === true && String(o.args.seq) === "1");
const ORIGINAL =
  "Marguerite kept the lighthouse ledger in pencil, because ink froze in the winter and the keeper before her had " +
  "written everything in ink. Each night she counted the ships by their lamps, red to port and green to starboard, " +
  "and each morning she walked the shingle to see what the sea had returned. Usually it was rope. Once it was a " +
  "piano stool, upright and dry, as if someone had set it there on purpose and gone back for the piano. She wrote " +
  "that down too, with the date and the state of the tide, and drew a small square around it so she would not forget.";

test("RT-INS L1: a copied part restored from a writer-reports hide is still hidden by the checker", () => {
  const dir = workdir();
  writeState(dir, {});
  // Run 1: three friendly writer reports hid it just before the run.
  run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: true, hidden_by: 1, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  // Run 2: the opener restored it (no refund forfeited: it was a reports hide).
  const { ops } = run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: false, restored: true, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  assert.equal(hides(ops).length, 1,
    "RT-INS L1: the opener laundered copied text through a reports hide + restore: the checker never hides a restored part");
});

test("RT-INS L2: a part reworded into copied text after its check is checked again", () => {
  const dir = workdir();
  writeState(dir, {});
  const seg = (text) => ({ "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text, created_at: "1000", last_edited_at: "2000" } });
  // Run 1: original text, nothing found anywhere.
  const first = run(dir, { config, stories: story, segments: seg(ORIGINAL), book: null }, { books: true });
  assert.equal(first.state.checked["1"], 1, "harness: run 1 checked part 1");
  // The writer rewords it for free (edit_segment) into the novel's opening page.
  const { ops } = run(dir, { config, stories: story, segments: seg(COPIED), book: BOOK }, { books: true });
  assert.ok(ops.some((o) => (o.op === "set_segment_hidden" || o.op === "set_source_note") && String(o.args.seq) === "1"),
    "RT-INS L2: copied text put in by a free edit after the check is never looked at");
});

test("RT-INS L3: clearing the citation after the checker unhid the part brings the hide back", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: entry });
  // Run 1: the writer cited the source; the checker unhides its own hide (control).
  const first = run(dir, { config, stories: story, segments: hiddenPart(2), book: BOOK }, { books: true });
  assert.equal(unhides(first.ops).length, 1, "harness: the checker unhid its own hide after the citation");
  // The writer clears the citation (set_citation ""): the same copied text, uncited.
  const { ops } = run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: false, hidden_by: 0, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  assert.equal(hides(ops).length, 1,
    "RT-INS L3: cite to get unhidden, then clear the citation: the uncited copy stays up and is never re-checked");
});
