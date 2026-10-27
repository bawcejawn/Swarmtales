import assert from "node:assert/strict";
import test from "node:test";
import { findCharacters, openingLines } from "../src/lib/characters.js";

test("finds named characters, not common capitalized words", () => {
  const chapters = [
    { number: 1, text: "Marguerite watched the harbour. The captain hummed. Then Marguerite turned to Captain Reyes and said hello. Reyes nodded." },
    { number: 2, text: "In April the ferry reached Lisbon. Captain Reyes laughed, and Marguerite laughed too. Tomas arrived late. Tomas was tired." },
  ];
  const names = findCharacters(chapters);
  const byName = Object.fromEntries(names.map((c) => [c.name, c]));
  assert.ok(byName.Marguerite, JSON.stringify(names));
  assert.equal(byName.Marguerite.count, 3);
  assert.equal(byName.Marguerite.firstChapter, 1);
  assert.ok(byName["Captain Reyes"]);
  assert.equal(byName.Reyes, undefined); // folded into "Captain Reyes"
  assert.ok(byName.Tomas);
  assert.equal(byName.April, undefined);
  assert.equal(byName.The, undefined);
  assert.equal(byName.Lisbon, undefined); // mentioned once
});

test("opening lines make a short first draft of the summary", () => {
  const s = openingLines([{ number: 1, text: "The ferry left at night. More happened." }, { number: 2, text: "Dawn came. Then more." }]);
  assert.equal(s, "Chapter 1: The ferry left at night. Chapter 2: Dawn came.");
});

test("characters: sentence-start words like On, In and Suddenly are never names", async () => {
  const { findCharacters } = await import("../src/lib/characters.js");
  const text = "On the first day of March, a litter of puppies were born. Each unique in their own way. " +
    "On adoption day, this one pup was selected and named, Little Jawn Bawce. In the end Jawn ran. In time Jawn slept.";
  const names = findCharacters([{ number: 1, text }]).map((c) => c.name);
  assert.ok(!names.includes("On"), names.join(","));
  assert.ok(!names.includes("In"), names.join(","));
  assert.ok(names.includes("Jawn"), names.join(","));
});
