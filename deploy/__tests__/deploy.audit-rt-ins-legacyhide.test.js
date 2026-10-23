// Red-team (Insider) attack tests for deploy.js hide / takedown, fix check @ d82364b.
//
// D1 (moderator key holder): docs/ADMIN_POWERS.md says an admin hide "can be
//   unhidden only by the admin, never by the moderator". A pre-upgrade hide
//   (hidden_by 0, not by reports) may be the admin's: restore_segment and
//   lib.legacyPartNotes treat it so. lib.hidePlan lets the MODERATOR key
//   unhide it ("UNHIDE (hidden by the admin or the checker, before hidden_by
//   existed)"), and the contract accepts it (see
//   Stories.audit-rt-ins-legacyunhide.spec.ts). The checker itself never
//   needs this (it only unhides hidden_by 2).
// D2 (anyone who can make a part's history unreadable, or a flaky node):
//   cmdTakedown carries on when get_versions fails. A legacy part changed by
//   someone else shows that ONLY in its versions (AB-052), so with no
//   versions takedownStrike says "Changed by others: no" and the tool goes
//   straight to "strike for <writer>". The dry run only catches it while the
//   part has <= 61 versions (see Stories.audit-rt-ins-legacypad.spec.ts for
//   how the writer's free edits pass that). Safe: when the history could
//   not be read for a part that has versions, the tool must stop for an
//   explicit --strike / --no-strike, as it does for a changed part.
// Each test asserts the SAFE behaviour and FAILS while the attack works.
// Copy into deploy/__tests__/ and run: node --test deploy/__tests__/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../lib");

const DEPLOY_JS = fs.readFileSync(path.join(__dirname, "..", "deploy.js"), "utf8");
const ADMIN = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";
const MOD = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";
const BOB = "1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1";

function functionSource(name) {
  const start = DEPLOY_JS.indexOf("async function " + name + "(");
  assert.ok(start >= 0, name + " not found in deploy.js");
  return DEPLOY_JS.slice(start, DEPLOY_JS.indexOf("\nasync function ", start + 10));
}

test("RT-INS D1: the moderator key can't unhide a pre-upgrade hide that may be the admin's", () => {
  const legacy = { author: BOB, status: 1, hidden: true, hidden_by: 0, hidden_by_reports: false };
  assert.throws(() => lib.hidePlan(legacy, false, MOD, ADMIN), /admin/i,
    "RT-INS D1: deploy.js hide --unhide with the moderator key undoes a pre-upgrade (possibly admin) hide");
  // The admin still can, and a pre-upgrade reports hide stays the moderator's to undo.
  assert.match(lib.hidePlan(legacy, false, ADMIN, ADMIN), /^UNHIDE/);
  assert.match(lib.hidePlan({ ...legacy, hidden_by_reports: true }, false, MOD, ADMIN), /^UNHIDE/);
});

test("RT-INS D2: takedown stops for a strike choice when the part's history could not be read", () => {
  const body = functionSource("cmdTakedown");
  const signerAt = body.indexOf("getSigner(");
  assert.ok(signerAt > 0, "harness: cmdTakedown asks for the admin key");
  const beforeKey = body.slice(0, signerAt);
  // Some refusal that depends on historyError and on no --strike / --no-strike, before the key prompt.
  const guarded = /if\s*\([^)]*historyError[^)]*\)[\s\S]{0,400}lib\.fail\(/.test(beforeKey) &&
    /historyError[\s\S]{0,200}(!strike|noStrike|needsChoice)|(!strike|noStrike|needsChoice)[\s\S]{0,200}historyError/.test(beforeKey);
  assert.ok(guarded,
    "RT-INS D2: with unreadable history the tool prints 'Changed by others: no' for a legacy-changed part and sends an automatic strike on the writer");
});
