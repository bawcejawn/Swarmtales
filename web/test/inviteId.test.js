import assert from "node:assert/strict";
import test from "node:test";
import { findInviteId } from "../src/lib/links.js";

// AB-008: the invite link must carry the id of the invite whose link key is
// this link's key, read back from the chain, not a guess from a counter
// read before sending.

const OURS = "1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt";   // this link's key address
const OTHER = "17tbkL7b9mGGQeYszdDqpZFWxYSh6R3zs3";  // another link's key

// A fake chain: invites by id, and the story's next_invite_id.
function chain(invites) {
  const ids = Object.keys(invites).map(Number);
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  return {
    readNextId: async () => next,
    readInvite: async (id) => invites[id] || null,
  };
}

test("an invite made in another tab first: the link gets the id that holds our key", async () => {
  const c = chain({ 5: { link_signer: OTHER }, 6: { link_signer: OURS } });
  assert.equal(await findInviteId({ before: 5, linkSigner: OURS, ...c }), 6);
});

test("our invite never reached the chain: no id, so no broken link is shown", async () => {
  const c = chain({ 5: { link_signer: OTHER } });
  assert.equal(await findInviteId({ before: 5, linkSigner: OURS, ...c }), null);
});

test("nothing on chain yet at all: no id", async () => {
  const c = chain({});
  assert.equal(await findInviteId({ before: 1, linkSigner: OURS, ...c }), null);
});

test("the usual case: the invite is at the id read before sending", async () => {
  const c = chain({ 4: { link_signer: OTHER }, 5: { link_signer: OURS } });
  assert.equal(await findInviteId({ before: 5, linkSigner: OURS, ...c }), 5);
});

test("a read that fails is skipped, not trusted", async () => {
  const c = chain({ 5: { link_signer: OTHER }, 6: { link_signer: OURS } });
  const flaky = { ...c, readInvite: async (id) => { if (id === 5) throw new Error("node busy"); return c.readInvite(id); } };
  assert.equal(await findInviteId({ before: 5, linkSigner: OURS, ...flaky }), 6);
});
