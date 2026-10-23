// Red-team (Insider) attack test, SwarmTales fix check @ 00eec36.
// Role: the moderator key, which only the copy checker uses (ADMIN_POWERS.md,
// KEY_CUSTODY.md section 5). The contract lets the moderator unhide ANY part,
// admin hides included (Stories.ts set_segment_hidden, ~1189), and the
// checker does exactly that by itself: every run it walks
// state.hiddenByChecker and, when the part is still hidden and its citation
// "covers" the source, sends set_segment_hidden(hidden=false) with the
// moderator key (check.mjs ~411-430). It never looks at seg.hidden_by, so it
// can't tell its own hide from the admin's.
// Attack (writer, or opener-writer): the checker hides Bob's copied part
// (entry saved in hiddenByChecker). The rights holder's notice arrives; the
// admin holds the part (e.g. the opener restored it and the admin hid it
// again, or the admin re-hid it per the AB-053 runbook). Bob then sets a
// citation naming the book (set_citation works on a hidden part). On its
// next run the checker unhides the part the admin is holding, which is the
// one hide AB-053 says only the admin or moderator may undo, and nobody
// meant the moderator automation to undo it.
// The loop is run here with its own source from check.mjs, the real
// citationCovers from lib.mjs, and stubs for the chain (no network).
// Asserts the SAFE behaviour: FAILS on the current code.
// Copy into checker/__tests__/ and run: node --test checker/__tests__/
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { REASON, citationCovers } from "../lib.mjs";

const SRC = fs.readFileSync(new URL("../check.mjs", import.meta.url), "utf8");
const START = SRC.indexOf("for (const key of Object.keys(state.hiddenByChecker))");
const END = SRC.indexOf("// 1. Read every story's new parts.", START);

const SOURCE = { title: "The Silent Harbour", author: "Jane Roe" };
const CITATION = "From The Silent Harbour by Jane Roe";

async function runRecheck(seg) {
  assert.ok(START > 0 && END > START, "precondition: check.mjs still has the hiddenByChecker re-check loop");
  const body = SRC.slice(START, END);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const loop = new AsyncFunction("state", "read", "citationCovers", "note", "sendAsModerator", "actions", "signer", "REASON", body);
  const state = { hiddenByChecker: { "7:3": { source: SOURCE, label: "Google Books: The Silent Harbour" } } };
  const sent = [];
  const read = async (name, args) => {
    assert.equal(name, "get_segment");
    assert.deepEqual([String(args.story_id), String(args.seq)], ["7", "3"]);
    return seg;
  };
  const sendAsModerator = async (name, args) => { sent.push({ name, args }); return true; };
  await loop(state, read, citationCovers, () => {}, sendAsModerator, [], { getAddress: () => "moderator" }, REASON);
  return sent.filter((s) => s.name === "set_segment_hidden" && s.args.hidden === false);
}

test("RT-INS unhide (sanity): the checker brings back its OWN hide when the writer cites the source", async () => {
  assert.ok(citationCovers(CITATION, SOURCE), "precondition: the citation covers the source");
  const unhides = await runRecheck({ status: 1, hidden: true, hidden_by: 2, citation: CITATION, author: "bob" });
  assert.equal(unhides.length, 1, "precondition: the re-check loop unhides a part the moderator hid");
});

test("RT-INS unhide: the checker's moderator key never undoes a hide the ADMIN made", async () => {
  const unhides = await runRecheck({ status: 1, hidden: true, hidden_by: 3, citation: CITATION, author: "bob" });
  assert.equal(unhides.length, 0,
    "RT-INS unhide: the copy checker unhid a part the admin is holding (hidden_by 3) because the writer added a citation; " +
      "check.mjs must only unhide parts with hidden_by == 2 (its own hide)");
});

test("RT-INS unhide: the checker does not undo a hide made by writer reports either", async () => {
  // After the opener restores the checker's hide, writers can report it hidden again;
  // the stale hiddenByChecker entry then lets the checker undo the reports.
  const unhides = await runRecheck({ status: 1, hidden: true, hidden_by: 1, hidden_by_reports: true, citation: CITATION, author: "bob" });
  assert.equal(unhides.length, 0,
    "RT-INS unhide: the copy checker unhid a part writer reports hid (hidden_by 1)");
});
