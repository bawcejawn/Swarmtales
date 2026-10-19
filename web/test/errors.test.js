import assert from "node:assert/strict";
import test from "node:test";
import { explainFailure } from "../src/lib/errors.js";

test("contract sentences are rewritten in plain words and the original is kept", () => {
  const text = explainFailure(new Error('STORIES: an active Writer membership is required'));
  assert.match(text, /Writer month/);
  assert.match(text, /STORIES: an active Writer membership is required/);
});

test("a rejected signature and a dead network get their own sentences", () => {
  assert.match(explainFailure(new Error("The user rejected the request")), /did not sign/);
  assert.match(explainFailure(new Error("Failed to fetch")), /did not answer/);
});

test("an unknown contract sentence is shown as the contract wrote it", () => {
  assert.equal(explainFailure(new Error("SHOP: shop is paused")), "SHOP: shop is paused");
});
