// Audit 2026-10 W1-06: the link key after # leaves the address bar (and the
// current history entry) as soon as the page reads it.
import assert from "node:assert/strict";
import test from "node:test";
import { captureLinkSecret } from "../src/lib/links.js";

function fakeWindow(hash) {
  const replaced = [];
  const win = {
    location: { pathname: "/Swarmtales/", search: "", hash },
    history: {
      state: null,
      replaceState: (state, title, url) => {
        replaced.push(url);
        win.location.hash = url.slice(url.indexOf("#"));
      },
    },
  };
  return { win, replaced };
}

test("W1-06: the key is taken out of the URL at once and kept for the page", () => {
  const store = new Map();
  const { win, replaced } = fakeWindow("#/promo/3?k=5Jabcdef&x=1");
  assert.equal(captureLinkSecret(win, store), "5Jabcdef");
  assert.deepEqual(replaced, ["/Swarmtales/#/promo/3?x=1"]);
  assert.ok(!win.location.hash.includes("5Jabcdef"));
  // A re-render (the key is no longer in the URL) still finds it, without rewriting history again.
  assert.equal(captureLinkSecret(win, store), "5Jabcdef");
  assert.equal(replaced.length, 1);
});

test("W1-06: other routes don't get the key, and pages without one are left alone", () => {
  const store = new Map([["#/join/1/2", "KEY"]]);
  const { win, replaced } = fakeWindow("#/stories/1");
  assert.equal(captureLinkSecret(win, store), "");
  assert.deepEqual(replaced, []);
  const blocked = fakeWindow("#/join/1/2?k=NEW");
  blocked.win.history.replaceState = () => { throw new Error("SecurityError"); };
  assert.equal(captureLinkSecret(blocked.win, store), "NEW", "a blocked history API doesn't break the page");
});
