// Re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md) L-20: after a
// sponsor refusal, the page retries with the user's own mana only when the
// sponsored transaction is unknown to the node, and says why a second
// confirmation opens.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SPONSOR_FALLBACK_NOTE, afterSponsorRefusal } from "../src/lib/sponsor.js";
import { appSource, fnBody } from "./helpers/appSource.js";

const src = (rel) => readFileSync(new URL("../src/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("L-20: a refused sponsored transaction the node knows is waited for, not sent again", async () => {
  const seen = [];
  assert.equal(await afterSponsorRefusal("0x1220aa", async (id) => { seen.push(id); return { transaction: { id } }; }), "landed");
  assert.deepEqual(seen, ["0x1220aa"]);
  assert.equal(await afterSponsorRefusal("0x1220aa", async () => null), "retry");
  assert.equal(await afterSponsorRefusal("0x1220aa", async () => { throw new Error("node down"); }), "retry", "the shared nonce keeps a retry safe");
  assert.equal(await afterSponsorRefusal("", async () => ({})), "retry");
});

test("L-20: Kondor and the test wallet check the node, then say why a second confirmation opens", () => {
  for (const file of ["wallet.js", "testWallet.js"]) {
    const s = src(file);
    const i = s.indexOf("if (!isSponsorRefusal(error)) throw error;");
    assert.ok(i > 0, file);
    const after = s.slice(i, i + 500);
    assert.match(after, /afterSponsorRefusal\(error\.transactionId, lookupTransaction\)\) === "landed"/, file);
    assert.match(after, /onProgress\(\{ phase: "sponsor-refused" \}\)/, file);
  }
  assert.match(src("wallet.js"), /throw withTransactionId\(error, prepared\.id\)/);
  assert.match(src("testWallet.js"), /e\.transactionId = tx\.transaction\.id;/);
  assert.match(fnBody(appSource().replace(/\r\n/g, "\n"), "send"), /progress\.phase === "sponsor-refused"[\s\S]*SPONSOR_FALLBACK_NOTE/);
  assert.match(SPONSOR_FALLBACK_NOTE, /confirm it once more\. Only one of the two can ever go through/);
});
