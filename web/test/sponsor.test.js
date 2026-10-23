// The mana sponsor on the website: when to ask it, with what mana limit, and
// which errors mean "pay with your own mana instead".
import assert from "node:assert/strict";
import test from "node:test";
import { APPROVE_ENTRY, SPONSOR_BASE_RC, SPONSOR_MIN_RC, isSponsorRefusal, sponsorRcEstimate, sponsorRcLimit, sponsorableOperations } from "../src/lib/sponsor.js";
import { configProblems, contracts, isAddress } from "../src/config.js";

const ids = { ink: "1INK", shop: "1SHOP", stories: "1STORIES" };
const TOKEN = "1TOKEN";
const call = (contract_id, entry_point = 1) => ({ call_contract: { contract_id, entry_point, args: "" } });
const MANA = 100000000n;
const DAY = 86400000;
const cfg = { enabled: true, ...ids, tokens: [TOKEN], max_mana_per_tx: "300000000", max_mana_per_account_day: "600000000", max_mana_per_day: "1000000000" };

test("sponsor: only SwarmTales calls and approve on a listed token are sponsorable", () => {
  assert.equal(sponsorableOperations([call(TOKEN, APPROVE_ENTRY), call("1SHOP")], ids, [TOKEN]), true);
  assert.equal(sponsorableOperations([call("1STORIES"), call("1INK")], ids, [TOKEN]), true);
  assert.equal(sponsorableOperations([call(TOKEN, 0x27f576ca)], ids, [TOKEN]), false, "a token transfer");
  assert.equal(sponsorableOperations([call("1OTHER")], ids, [TOKEN]), false);
  assert.equal(sponsorableOperations([call("1OTHER", APPROVE_ENTRY)], ids, [TOKEN]), false, "approve on an unlisted token");
  assert.equal(sponsorableOperations([{ upload_contract: {} }], ids, [TOKEN]), false);
  assert.equal(sponsorableOperations([], ids, [TOKEN]), false);
  assert.equal(sponsorableOperations(Array(11).fill(call("1SHOP")), ids, [TOKEN]), false);
});

test("sponsor: the mana limit is the smallest of the caps left and the sponsor's free mana", () => {
  const headMs = 20749 * DAY + 5;
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: 50n * MANA }), 3n * MANA);
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: 2n * MANA }), 2n * MANA);
  // This account used 5 of its 6 today: 1 left.
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: 50n * MANA, mine: { day: "20749", used: String(5n * MANA) } }), MANA);
  // Yesterday's use doesn't count.
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: 50n * MANA, mine: { day: "20748", used: String(6n * MANA) } }), 3n * MANA);
  // Everyone used 9.5 of 10: 0.5 left.
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: 50n * MANA, total: { day: "20749", used: String(95n * MANA / 10n) } }), MANA / 2n);
  // Nothing left, or almost nothing: don't ask.
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: 50n * MANA, mine: { day: "20749", used: String(6n * MANA) } }), 0n);
  assert.equal(sponsorRcLimit({ cfg, ids, headMs, sponsorFree: SPONSOR_MIN_RC - 1n }), 0n);
});

test("sponsor: switched off, or set up for other contracts, means don't ask", () => {
  const headMs = 20749 * DAY;
  assert.equal(sponsorRcLimit({ cfg: { ...cfg, enabled: false }, ids, headMs, sponsorFree: 50n * MANA }), 0n);
  assert.equal(sponsorRcLimit({ cfg: { ...cfg, shop: "1ELSEWHERE" }, ids, headMs, sponsorFree: 50n * MANA }), 0n);
  assert.equal(sponsorRcLimit({ cfg: null, ids, headMs, sponsorFree: 50n * MANA }), 0n);
});

test("sponsor: a sponsor refusal falls back to the user's mana; other errors don't", () => {
  assert.equal(isSponsorRefusal(new Error('{"error":"SPONSOR: today\'s sponsored mana is used up","code":-1}')), true);
  assert.equal(isSponsorRefusal(new Error('{"error":"insufficient pending account resources","code":104}')), true);
  assert.equal(isSponsorRefusal(new Error("STORIES: text is over the per-submission cap")), false);
  assert.equal(isSponsorRefusal(new Error("Transaction rejected by user")), false);
  assert.equal(isSponsorRefusal(null), false);
});

test("sponsor: the config's sponsor is a Koinos address or empty", () => {
  assert.ok(contracts.sponsor === "" || isAddress(contracts.sponsor));
  assert.deepEqual(configProblems(), []);
});

test("sponsor: the mana limit asked for grows with the size of the calls", () => {
  assert.equal(sponsorRcEstimate([call("1STORIES")]), SPONSOR_BASE_RC);
  // 18 KB of text (the largest part, measured at 1.81 mana) asks for 0.8 + 2.7 = 3.5 mana.
  const big = { call_contract: { contract_id: "1STORIES", entry_point: 1, args: "A".repeat(24000) } };
  assert.equal(sponsorRcEstimate([big]), SPONSOR_BASE_RC + 18000n * 15000n);
  assert.ok(sponsorRcEstimate([big]) > 181000000n);
  assert.equal(sponsorRcEstimate([{ call_contract: { contract_id: "1SHOP", entry_point: 1, args: new Uint8Array(100) } }]), SPONSOR_BASE_RC + 1500000n);
});
