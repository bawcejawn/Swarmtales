// Audit Bot red-team (Web attacker) test: malicious invite/promo links.
// Attacks:
//  1. A link with the key twice (?k=A&k=B) or URL-encoded: after the page
//     reads it (main.js:2327-2339) no copy of any key may stay in the address bar.
//  2. A hostile link supplies its OWN key: the page signs with it, but the
//     signature is bound to the domain, contract, ids and the viewer's wallet
//     (links.js:59-65), so it can't be reused for a promo instead of an invite,
//     another story/invite, or another wallet.
// Asserts the SAFE behaviour. Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";
import { Signer, utils } from "koilib";
import { generateLinkKey, hashWithoutSecret, linkSecretFromHash, signInviteJoin, signPromoClaim } from "../src/lib/links.js";

test("RT-WEB: no copy of a link key survives in the address bar", () => {
  for (const h of ["#/join/4/2?k=AAA&k=BBB", "#/promo/3?k=5K%2Babc&x=1", "#/join/4/2?x=1&k=AAA&k=BBB&y=2"]) {
    const left = hashWithoutSecret(h);
    assert.equal(linkSecretFromHash(left), "", left);
    assert.ok(!/AAA|BBB|5K/.test(left), "a key stayed in " + left);
  }
});

test("RT-WEB: a link-key signature can't be replayed across purpose, story, invite or wallet", async () => {
  const key = generateLinkKey();
  const stories = "1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ";
  const shop = "14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD";
  const alice = new Signer({ privateKey: utils.toHexString(new Uint8Array(32).fill(1)) }).getAddress();
  const bob = new Signer({ privateKey: utils.toHexString(new Uint8Array(32).fill(2)) }).getAddress();
  const hex = (b) => utils.toHexString(b);
  const base = hex(await signInviteJoin(key.secret, stories, 1, 1, alice));
  const others = [
    hex(await signInviteJoin(key.secret, stories, 1, 1, bob)),
    hex(await signInviteJoin(key.secret, stories, 2, 1, alice)),
    hex(await signInviteJoin(key.secret, stories, 1, 2, alice)),
    hex(await signInviteJoin(key.secret, shop, 1, 1, alice)),
    hex(await signPromoClaim(key.secret, shop, 1, alice)),
  ];
  for (const o of others) assert.notEqual(o, base);
  assert.equal(new Set(others).size, others.length);
});
