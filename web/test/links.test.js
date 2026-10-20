// The browser signs promo and invite links the same way the Shop and
// Stories contracts recover them. This test recovers each signature with
// the mock VM's own secp256k1 code (the exact logic the contract runs) and
// checks it lands on the link key's address, and NOT on a copy aimed at a
// different wallet. That is the on-chain check for fixes H2 and H3.

import test from "node:test";
import assert from "node:assert/strict";
import { utils } from "koilib";
import mv from "@koinos/mock-vm/src/util.js";
import { signPromoClaim, signInviteJoin, generateLinkKey, linkKeyAddress, linkSecretFromHash, buildPromoLink, buildInviteLink } from "../src/lib/links.js";

const SHOP = "1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS";
const STORIES = "16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt";
const ALICE = "1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq";
const BOB = "1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf";

const enc = new TextEncoder();
function u64(n) {
  const o = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; }
  return o;
}
function cat(parts) {
  let t = 0;
  for (const p of parts) t += p.length;
  const o = new Uint8Array(t);
  let at = 0;
  for (const p of parts) { o.set(p, at); at += p.length; }
  return o;
}
// What the contract does: hash the message to a multihash, recover the signer.
function recoverAddress(message, signature) {
  const multihash = mv.hashSHA256(message);
  return mv.bitcoinAddress(mv.recoverPublicKey(multihash, signature));
}
const promoMsg = (shop, id, acct) => cat([enc.encode("swarmtales/promo/v1"), utils.decodeBase58(shop), u64(id), utils.decodeBase58(acct)]);
const inviteMsg = (st, sid, iid, acct) => cat([enc.encode("swarmtales/invite/v1"), utils.decodeBase58(st), u64(sid), u64(iid), utils.decodeBase58(acct)]);

test("a generated link key's secret and address agree", () => {
  const key = generateLinkKey();
  assert.equal(linkKeyAddress(key.secret), key.address);
  assert.equal(key.secret.length >= 51 && key.secret.length <= 52, true);
});

test("a promo signature recovers to the link key and is bound to one wallet", async () => {
  const key = generateLinkKey();
  const sig = await signPromoClaim(key.secret, SHOP, "3", ALICE);
  assert.equal(sig.length, 65);
  assert.equal(recoverAddress(promoMsg(SHOP, "3", ALICE), sig), key.address);
  // The same signature aimed at a different wallet does not recover to the key.
  assert.notEqual(recoverAddress(promoMsg(SHOP, "3", BOB), sig), key.address);
  // Nor does it carry to a different campaign.
  assert.notEqual(recoverAddress(promoMsg(SHOP, "4", ALICE), sig), key.address);
});

test("an invite signature recovers to the link key and is bound to one wallet", async () => {
  const key = generateLinkKey();
  const sig = await signInviteJoin(key.secret, STORIES, "12", "4", ALICE);
  assert.equal(recoverAddress(inviteMsg(STORIES, "12", "4", ALICE), sig), key.address);
  assert.notEqual(recoverAddress(inviteMsg(STORIES, "12", "4", BOB), sig), key.address);
  assert.notEqual(recoverAddress(inviteMsg(STORIES, "12", "5", ALICE), sig), key.address);
});

test("link secrets ride in the # fragment, not a server query", () => {
  const promo = buildPromoLink("https://swarmtales.example/", "3", "WIFSECRET");
  assert.equal(promo.includes("#/promo/3?k=WIFSECRET"), true);
  assert.equal(linkSecretFromHash("#/promo/3?k=WIFSECRET"), "WIFSECRET");
  const invite = buildInviteLink("https://swarmtales.example/", "12", "4", "WIFSECRET");
  assert.equal(invite.includes("#/join/12/4?k=WIFSECRET"), true);
  assert.equal(linkSecretFromHash("#/join/12/4?k=WIFSECRET"), "WIFSECRET");
  assert.equal(linkSecretFromHash("#/shop"), "");
});
