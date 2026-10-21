import assert from "node:assert/strict";
import test from "node:test";
import { Signer, utils } from "koilib";
import { generateLinkKey, hashWithoutSecret, linkSecretFromHash } from "../src/lib/links.js";

// AB-013: link keys come from 32 bytes of crypto.getRandomValues, and the
// secret leaves the address bar (and history) once the page has read it.

test("a link key is 32 random bytes from crypto.getRandomValues", () => {
  const real = crypto.getRandomValues;
  crypto.getRandomValues = (bytes) => bytes.fill(7);
  let key;
  try {
    key = generateLinkKey();
  } finally {
    crypto.getRandomValues = real;
  }
  const expected = new Signer({ privateKey: utils.toHexString(new Uint8Array(32).fill(7)) });
  assert.equal(key.secret, expected.getPrivateKey("wif"));
  assert.equal(key.address, expected.getAddress());
  assert.notEqual(generateLinkKey().secret, generateLinkKey().secret);
});

test("the secret is removed from the hash, and everything else stays", () => {
  assert.equal(hashWithoutSecret("#/join/4/2?k=5Kabc"), "#/join/4/2");
  assert.equal(hashWithoutSecret("#/promo/3?ref=x&k=5Kabc"), "#/promo/3?ref=x");
  assert.equal(hashWithoutSecret("#/promo/3?k=5Kabc&ref=x"), "#/promo/3?ref=x");
  assert.equal(hashWithoutSecret("#/stories/1"), "#/stories/1");
  assert.equal(linkSecretFromHash(hashWithoutSecret("#/join/4/2?k=5Kabc")), "");
});
