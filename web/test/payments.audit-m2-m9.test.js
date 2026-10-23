// Audit 2026-10 M-2 (site side) and M-9: the Writer month's min_ink is the
// Ink the page shows, and Kondor receives the ABIs of exactly the contracts
// a transaction calls.
import assert from "node:assert/strict";
import test from "node:test";
import { utils } from "koilib";
import { writerMinInk } from "../src/lib/rules.js";
import { abisFor } from "../src/chain.js";
import { abis } from "../src/generated/abis.js";
import { contracts } from "../src/config.js";

test("M-2: min_ink for a Writer month is the active term's amount, else the catalog's", () => {
  const cfg = { writer_ink: "30000" };
  assert.equal(writerMinInk({}, 100, cfg), "30000");
  assert.equal(writerMinInk({ tier: 2, paid_until: "200", ink_per_month: "25000" }, 100, cfg), "25000");
  assert.equal(writerMinInk({ tier: 2, paid_until: "50", ink_per_month: "25000" }, 100, cfg), "30000", "an ended term uses the catalog");
  assert.equal(writerMinInk({ tier: 1, paid_until: "200" }, 100, cfg), "30000");
  assert.equal(writerMinInk({}, 100, {}), "0");
});

test("M-9: Kondor gets the ABI of each contract the operations call, keyed by contract id", () => {
  const op = (id) => ({ call_contract: { contract_id: id, entry_point: 1, args: "" } });
  const out = abisFor([op(contracts.paymentToken), op(contracts.shop), op(contracts.shop), op(contracts.stories)]);
  assert.deepEqual(Object.keys(out).sort(), [contracts.paymentToken, contracts.shop, contracts.stories].sort());
  assert.equal(out[contracts.shop], abis.shop);
  assert.equal(out[contracts.paymentToken], utils.tokenAbi);
  assert.ok(out[contracts.shop].methods.buy_pack.argument, "buy_pack decodes (max_price, min_ink)");
  assert.deepEqual(abisFor([op("1SomethingElse")]), {});
});

test("M-2: the ABIs carry the new min_ink, rights and no-token close arguments", () => {
  const has = (pkg, msg, field) => !!abis[pkg].koilib_types.nested[pkg].nested[msg].fields[field];
  assert.ok(has("shop", "buy_pack_arguments", "min_ink"));
  assert.ok(has("shop", "buy_membership_arguments", "min_ink"));
  assert.ok(has("stories", "open_story_arguments", "min_ink"));
  assert.ok(has("stories", "edit_segment_arguments", "rights_confirmed"));
  assert.ok(has("stories", "edit_segment_arguments", "terms_version"));
  assert.ok(!has("stories", "close_story_arguments", "token"));
  assert.ok(has("stories", "segment_list", "next"));
});
