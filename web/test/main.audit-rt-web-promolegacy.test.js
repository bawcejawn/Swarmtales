// Audit Bot red-team (Web attacker) test: what the page promises vs. what
// the contracts do, for the "remove the whole part" refund label. The page is
// too DOM-heavy to import, so this reads its source (the decision is one
// expression). (The legacy promo-claim check that was here went with the
// pre-per-campaign claims, which the October 2026 testnet reset removed.)
//
// "Remove the whole part instead (N Ink; <writer> gets all N back)"
//    (main.js changePanel ~1332) uses changePrice().refund = seg.charged. In a
//    pool-paid part (seg.fund_paid) the contract's settleRefund sends only
//    own_paid to the writer and the rest to the story's pool
//    (Stories.ts ~2092-2105). The page tells the changer the writer gets
//    everything back, a false justification for a paid removal.
//    SAFE: the label (or changePrice) accounts for fund_paid / own_paid.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { appSource, fnBody } from "./helpers/appSource.js";

const src = appSource();

test("RT-WEB: the 'remove the whole part' label does not promise the writer Ink that goes to the pool", () => {
  const panel = fnBody(src, "changePanel");
  const label = panel.slice(panel.indexOf("removeAll.textContent"), panel.indexOf("\n", panel.indexOf("removeAll.textContent")));
  assert.ok(label.length > 0, "can't find the remove label");
  const promisesAll = /gets all/.test(label);
  const knowsPool = /fund_paid|own_paid|toPool|toWriter/.test(panel);
  assert.ok(!promisesAll || knowsPool,
    "POOL-REFUND LABEL: '" + label.trim() + "' tells the changer the writer gets all of seg.charged back, but in a pool-paid " +
    "part settleRefund returns only own_paid to the writer and the rest to the pool");
});
