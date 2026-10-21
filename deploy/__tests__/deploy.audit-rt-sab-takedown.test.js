// Red-team (Saboteur) attack tests for `deploy.js takedown` (fix check @ 42f6af9).
// Attack: frame an honest changer. The admin picks --strike from what the tool
// prints: writer, changers and lib.versionHistory(get_versions). (a) Each
// version is cut to 160 chars, so a plant after char 160 looks identical to the
// clean original. (b) The tool never prints the live text or last_edited_by,
// and the writer's own free edit_segment after a revise keeps no version, so
// the last version shown is the honest changer's clean one.
// Asserts the SAFE behaviour: fails while the attack works.
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const lib = require("../lib");

const BOB = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";   // writer
const CARA = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";  // honest changer
const MALLORY = "1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52";

function shownText(line) {
  const i = line.indexOf(": ");
  return JSON.parse(line.slice(i + 2).replace(/…"$/, '"'));
}

test("RT-SAB-6a: versionHistory shows a change made after character 160", () => {
  const prefix = "Bob writes a long honest opening. ".repeat(6); // > 160 chars
  const versions = [
    { version: 1, kind: 1, by: BOB, author: BOB, text: prefix + "The harbour sleeps.", at: "1700000000" },
    { version: 2, kind: 2, by: MALLORY, author: BOB, text: prefix + "COPIED: It was the best of times.", at: "1700000100" },
  ];
  const lines = lib.versionHistory(versions);
  assert.notStrictEqual(shownText(lines[0]), shownText(lines[1]),
    "RT-SAB-6a: two different versions print identically; the admin cannot see who added the copied words");
});

test("RT-SAB-6b: takedownStrike names the writer when the writer made the last (unversioned) change", () => {
  const clean = "Bob writes teh calm opening of his own story.";
  const seg = {
    author: BOB, edited_by_others: true, version_count: 2, last_edited_by: BOB,
    text: "COPIED: It was the best of times, the worst..",
  };
  const versions = [
    { version: 1, kind: 1, by: BOB, author: BOB, text: clean, at: "1700000000" },
    { version: 2, kind: 2, by: CARA, author: BOB, text: clean.replace("teh", "the"), at: "1700000100" },
  ];
  // Updated: versionHistory now takes the part too and ends with its live text
  // when the newest version differs (the contract also versions Bob's edit now).
  const lines = lib.versionHistory(versions, seg);
  const lastShown = shownText(lines[lines.length - 1]);
  assert.strictEqual(lastShown, seg.text,
    "RT-SAB-6b: the history the admin compares does not contain the live text (Bob's free edit keeps no version)");
  // The writer who made the last change is offered first, even though they are the writer.
  const who = lib.takedownStrike(seg, versions, "", false);
  assert.strictEqual(who.candidates[0], BOB, "RT-SAB-6b: last_edited_by is not offered as a candidate");
  assert.ok(who.candidates.includes(CARA));
});

test("RT-SAB-6c: cmdTakedown prints the live text and who last edited it before asking for --strike", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
  const start = src.indexOf("async function cmdTakedown");
  const end = src.indexOf("\nasync function ", start + 10);
  const body = src.slice(start, end);
  assert.ok(start > 0, "cmdTakedown not found");
  assert.match(body, /seg\.text/, "RT-SAB-6c: the takedown tool never shows the part's live text");
  assert.match(body, /last_edited_by/, "RT-SAB-6c: the takedown tool never shows who last edited the part");
});
