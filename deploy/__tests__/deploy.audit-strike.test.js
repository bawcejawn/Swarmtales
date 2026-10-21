// Audit Bot attack test for the takedown --strike flag (SwarmTales fix check, 86d9b22).
// Attack: the new `strike` field is silently dropped when the deploy script
// encodes takedown_segment with the built Stories ABI (e.g. a stale ABI), so
// an admin's --strike choice would never reach the chain.
// Asserts the SAFE behaviour: the field survives encoding, and an empty one
// encodes as "no choice". Needs stories/abi/stories.abi from a fresh build.
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const lib = require("../lib");
const { Contract } = require("koilib");

const ABI = path.join(__dirname, "..", "..", "stories", "abi", "stories.abi");
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const BOB = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";

function contract() {
  return new Contract({ id: STORIES, abi: lib.toKoilibAbi(JSON.parse(fs.readFileSync(ABI, "utf8"))) });
}

test("takedown --strike reaches the operation, and no --strike encodes as empty", async () => {
  const c = contract();
  for (const strike of [BOB, ""]) {
    const op = await c.encodeOperation({ name: "takedown_segment", args: { story_id: "1", seq: "2", reason: lib.requireReason("copyright"), note: "n", strike } });
    const back = await c.decodeOperation(op);
    assert.strictEqual(back.args.strike || "", strike, "--strike " + JSON.stringify(strike) + " did not survive encoding");
  }
});
