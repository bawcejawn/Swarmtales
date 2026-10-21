// Audit Bot attack test for AB-048 (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack (new surface from the AB-038 fix): an opener sets a citation on Bob's part. The contract
// now records the opener as a changer (so the admin may strike them), but `deploy.js takedown`
// builds its candidate list only from versions and last_edited_by. A citation makes neither, so
// the tool says "Changed by others: yes" and offers only Bob, the one wallet that did nothing.
// Asserts the SAFE behaviour: FAILS on the current code (proof), PASSES once the tool names
// every recorded changer (or at least says one it can't see exists).
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const lib = require("../lib");

const BOB = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";   // writer
const ALICE = "1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq"; // opener who set the citation

test("AB-048: a citation by someone else gives the admin someone other than the writer to pick", () => {
  // What get_segment returns after Alice's set_citation on Bob's untouched part.
  const seg = { author: BOB, edited_by_others: true, last_edited_by: BOB, paid_changes: 0, version_count: 0,
    text: "Bob's words.", citation: "Copied Book, Somebody Else" };
  const who = lib.takedownStrike(seg, [], undefined, undefined);
  assert.equal(who.changed, true);
  assert.ok(who.needsChoice);
  assert.ok(who.candidates.some((a) => a !== BOB),
    "AB-048: the takedown tool says someone else changed the part but offers only the writer " + JSON.stringify(who.candidates));
});
