// Audit Bot red-team (Web attacker) test: what the page promises vs. what
// the contracts do, for the per-campaign promo rule and the "remove the whole
// part" refund label. main.js is too DOM-heavy to import, so these read its
// source (the decisions are one expression each).
//
// 1) Legacy promo claim. Shop.claim_promo (Shop.ts:497) refuses a wallet whose
//    pre-upgrade claim (promoClaimed == campaign_id) was THIS campaign, even
//    though get_campaign_claimed(campaign, wallet) is false for it (commit
//    6086bbc). renderPromo (main.js ~2421-2427) decides "already claimed" ONLY
//    from get_campaign_claimed, and passes alreadyClaimed: false to
//    assessPromo. So that wallet sees "Claim free Ink", signs, pays mana, and
//    is refused. state.account.promo (chain.js:124, get_promo_claimed) holds
//    that campaign id and is already loaded.
//    SAFE: renderPromo also treats state.account.promo === campaignId as claimed.
//
// 2) "Remove the whole part instead (N Ink; <writer> gets all N back)"
//    (main.js changePanel ~1332) uses changePrice().refund = seg.charged. In a
//    pool-paid part (seg.fund_paid) the contract's settleRefund sends only
//    own_paid to the writer and the rest to the story's pool
//    (Stories.ts ~2092-2105). The page tells the changer the writer gets
//    everything back, a false justification for a paid removal.
//    SAFE: the label (or changePrice) accounts for fund_paid / own_paid.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function body(start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "can't find " + start + " in main.js");
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b > a ? b : undefined);
}

test("RT-WEB: a wallet whose pre-upgrade promo claim was this campaign is not offered a claim the Shop refuses", () => {
  const promo = body("function renderPromo(", "function renderJoin(");
  const usesLegacy = /state\.account\.promo\b[^;\n]*campaignId|campaignId[^;\n]*state\.account\.promo\b/.test(promo);
  assert.ok(usesLegacy,
    "LEGACY-PROMO: renderPromo decides 'already claimed' only from get_campaign_claimed; a wallet with " +
    "promoClaimed == this campaign (claimed before per-campaign records) is shown 'Claim free Ink' and Shop.claim_promo refuses it");
});

test("RT-WEB: the 'remove the whole part' label does not promise the writer Ink that goes to the pool", () => {
  const panel = body("function changePanel(", "function versionLabel(");
  const label = panel.slice(panel.indexOf("removeAll.textContent"), panel.indexOf("\n", panel.indexOf("removeAll.textContent")));
  assert.ok(label.length > 0, "can't find the remove label");
  const promisesAll = /gets all/.test(label);
  const knowsPool = /fund_paid|own_paid|toPool|toWriter/.test(panel);
  assert.ok(!promisesAll || knowsPool,
    "POOL-REFUND LABEL: '" + label.trim() + "' tells the changer the writer gets all of seg.charged back, but in a pool-paid " +
    "part settleRefund returns only own_paid to the writer and the rest to the pool");
});
