// The browser signs promo and invite links the same way the Shop and
// Stories contracts recover them. This test recovers each signature with
// its own copy of the recovery the chain runs (@noble/secp256k1, as in the
// Koinos mock VM; not koilib's Signer, which made the signature) and
// checks it lands on the link key's address, and NOT on a copy aimed at a
// different wallet. That is the on-chain check for fixes H2 and H3.

import test from "node:test";
import assert from "node:assert/strict";
import { utils } from "koilib";
import * as secp from "@noble/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
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
// What the contract does: sha256 the message, recover the compressed public
// key from the 65-byte compact signature (first byte = recovery id + 31), and
// turn it into a Koinos address (version 0, ripemd160(sha256(key)), checksum).
// The same steps as @koinos/mock-vm's util.js, without its dependencies (AB-018).
function recoverAddress(message, signature) {
  const digest = sha256(message);
  const recovery = signature[0] - 31;
  const sig = new secp.Signature(BigInt("0x" + utils.toHexString(signature.slice(1, 33))), BigInt("0x" + utils.toHexString(signature.slice(33, 65))));
  const publicKey = secp.Point.fromHex(secp.recoverPublicKey(digest, sig.toHex(), recovery)).toRawBytes(true);
  const payload = new Uint8Array(21);
  payload.set(ripemd160(sha256(publicKey)), 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const address = new Uint8Array(25);
  address.set(payload);
  address.set(checksum, 21);
  return utils.encodeBase58(address);
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

// A fixed known-answer vector (AB-026). The recovery above uses the same
// secp256k1 library koilib signs with, so on its own it is not an
// independent check. These bytes are pinned: test link key 0 from
// scripts/gen-link-fixtures.mjs (sha256("swarmtales-test-link-0"), a public,
// worthless key) signing story 1, invite 1, for BOB. The same signature is
// inviteSig(0, 1, 1) in stories/assembly/__tests__/linkFixtures.ts, which the
// Stories contract tests accept through the Koinos mock VM.
const KAT_SECRET = "L26euVCoKXxVKqZeDasczL9x1BvLQ96xKLTexv1specUvvvD3km4";
const KAT_ADDRESS = "13da3M8X4nTyxAVMGYmxFdqGqtmmdy8H8B";
const KAT_DIGEST = "3e48710bf75d77a87124272827285063664b0991f6f914a039bd27331c99050e";
const KAT_SIGNATURE = "20a28f83a35497b258225415d8deb51caa5c0d0a08314d3633c3fafef17f621495463153250a3b6076bce9e77507e50bc1aa5a4813f643050b988f9682a6d90f7a";

test("an invite signature matches a fixed known-answer vector", async () => {
  assert.equal(linkKeyAddress(KAT_SECRET), KAT_ADDRESS);
  assert.equal(utils.toHexString(sha256(inviteMsg(STORIES, "1", "1", BOB))), KAT_DIGEST);
  const sig = await signInviteJoin(KAT_SECRET, STORIES, "1", "1", BOB);
  assert.equal(utils.toHexString(sig), KAT_SIGNATURE);
  assert.equal(recoverAddress(inviteMsg(STORIES, "1", "1", BOB), utils.toUint8Array(KAT_SIGNATURE)), KAT_ADDRESS);
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
