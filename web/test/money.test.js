import assert from "node:assert/strict";
import test from "node:test";
import {
  LOW_MANA_WARN,
  VAULT_MANA_CEILING,
  formatMana,
  formatUnits,
  formatUtc,
  headTimeSeconds,
  kondorManaNote,
  shortAddress,
} from "../src/lib/money.js";

test("token and mana amounts trim trailing zeros", () => {
  assert.equal(formatUnits("100000000", 8), "1");
  assert.equal(formatUnits("50000000", 8), "0.5");
  assert.equal(formatUnits("1", 8), "0.00000001");
  assert.equal(formatUnits(0, 0), "0");
  assert.equal(formatMana("100000000"), "1");
  assert.equal(formatMana(VAULT_MANA_CEILING), "100");
});

test("dates and addresses stay short", () => {
  assert.equal(formatUtc(0), "");
  assert.equal(formatUtc("0"), "");
  assert.equal(formatUtc(1_700_000_000), "14 Nov 2023, 22:13 UTC");
  assert.equal(shortAddress("12SVw65QpMjFo9fnc651V7LhXKqVLg15Ww"), "12SVw6…15Ww");
  assert.equal(shortAddress("short"), "short");
});

test("head time in milliseconds becomes seconds", () => {
  assert.equal(headTimeSeconds({ head_block_time: "1700000000000" }), 1_700_000_000n);
  assert.equal(headTimeSeconds({ head_block_time: "1700000000" }), 1_700_000_000n);
  assert.equal(headTimeSeconds({}), 0n);
});

test("Kondor is warned under 1 mana and still not blocked by this helper", () => {
  assert.equal(kondorManaNote(LOW_MANA_WARN), "");
  assert.match(kondorManaNote(LOW_MANA_WARN - 1n), /under 1 mana/);
  assert.match(kondorManaNote("0"), /under 1 mana/);
  assert.match(kondorManaNote("nope"), /could not read/);
  assert.match(kondorManaNote("nope", true), /could not read mana/);
});

test("testnet mana notes never suggest Kondor's free mana", () => {
  assert.doesNotMatch(kondorManaNote("0", false), /Use free mana in its window/);
  assert.match(kondorManaNote("0", false), /tKOIN/);
  assert.match(kondorManaNote("0", true), /Use free mana/);
});
