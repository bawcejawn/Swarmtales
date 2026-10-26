// Red-team (Impersonator) attack tests, SwarmTales fix check @ 00eec36.
// Target: checker/check.mjs, which signs with the MODERATOR key. Since
// AB-053 the moderator may unhide ANY part, including one the admin hid
// (hidden_by 3), so whatever makes the checker send an unhide is a way for a
// writer to act with the moderator's power.
//
// Attack A ("the writer unlocks the admin's hide through the checker"):
//   1. The checker decides to hide copied part P and records it in
//      state.hiddenByChecker, whether or not the hide was sent: it records it
//      when the moderator wallet has no mana, when the chain refused the hide,
//      and in every report-only run (no MODERATOR_WIF yet).
//      (A part the checker DID hide that the admin then re-hides with the
//      admin key, unhide+hide in one transaction (deploy.js hide)
//      tells the admin to do to lock old hides, gets the same entry.)
//   2. The admin hides P with the admin key (hidden_by 3) after a complaint,
//      so that the opener cannot restore it (AB-053).
//   3. The writer calls set_citation on P (allowed while hidden) naming the
//      book the checker found.
//   4. Next hourly run: the re-check loop sees seg.hidden + a covering
//      citation and sends set_segment_hidden(hidden=false) with the moderator
//      key. It never looks at seg.hidden_by, so the admin's hide is undone.
// Attack B ("hide it yourself first"): a part that is hidden when the
//   checker reads it (e.g. hidden by 3 sybil writer reports in the hour
//   before the run) is marked checked and skipped for good. The opener then
//   restores it (allowed: hidden_by 1) and the copied text is never checked.
//
// Runs the real checker (load, plan, apply) through the shared harness
// (harness.mjs: fake koilib and fetch, no network). Each attack test
// asserts the SAFE behaviour and FAILS while the attack works. The
// "control" tests show the harness works (they pass on the current code).
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

test("control: a part the checker itself hid comes back once the writer cites the source", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: entry });
  const { ops } = run(dir, { config, stories: story, segments: hiddenPart(2) });
  assert.equal(unhides(ops).length, 1, "harness: expected the moderator unhide of a checker-hidden part");
});

test("RT-IMP A1: the writer's citation never makes the checker unhide a part the ADMIN hid", () => {
  const dir = workdir();
  writeState(dir, { checked: { "1": 1 }, hiddenByChecker: entry });
  const { ops } = run(dir, { config, stories: story, segments: hiddenPart(3) });
  assert.equal(unhides(ops).length, 0,
    "RT-IMP A1: the checker used the moderator key to unhide a part hidden_by=3 (admin) because the writer set a citation");
});

// Step 1 of attack A: a hide that was never sent must not leave a
// "the checker hid this" record that a later citation can cash in.
for (const [name, opts, rc] of [
  ["the moderator wallet has no mana", { wif: true, books: true }, "0"],
  ["a report-only run (no moderator key)", { wif: false, books: true }, "100000000"],
]) {
  test("RT-IMP A2: no hiddenByChecker record when the hide was not sent (" + name + ")", () => {
    const dir = workdir();
    writeState(dir, {});
    const fresh = { "1:1": { status: 1, hidden: false, citation: "", author: WRITER, text: COPIED, created_at: "1000" } };
    const { ops, state, out } = run(dir, { config, stories: story, segments: fresh, book: BOOK, rc }, opts);
    assert.ok(/HIDE story 1 part 1/.test(out), "harness: the checker should have wanted to hide the copied part");
    assert.equal(ops.filter((o) => o.op === "set_segment_hidden").length, 0, "harness: nothing should have been sent");
    assert.equal((state.hiddenByChecker || {})["1:1"], undefined,
      "RT-IMP A2: the checker recorded a hide it never made; if the admin hides the part later, the writer's citation makes the checker unhide it");
  });
}

test("RT-IMP B: a part hidden (by reports) when the checker reads it is still checked after it is restored", () => {
  const dir = workdir();
  writeState(dir, {});
  // Run 1: three sybil writer reports hid the copied part just before the run.
  run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: true, hidden_by: 1, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  // Run 2: the opener (who wrote it) restored it; the copied text is visible.
  const { ops } = run(dir, {
    config, stories: story, book: BOOK,
    segments: { "1:1": { status: 1, hidden: false, restored: true, citation: "", author: WRITER, text: COPIED, created_at: "1000" } },
  }, { books: true });
  const acted = ops.filter((o) => (o.op === "set_source_note" || o.op === "set_segment_hidden") && String(o.args.seq) === "1");
  assert.ok(acted.length > 0,
    "RT-IMP B: the part was marked checked while hidden and is never looked at again: copied text stays up with no note");
});
