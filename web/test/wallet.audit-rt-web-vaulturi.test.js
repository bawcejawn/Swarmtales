// Audit Bot red-team (Web attacker) test: KOIN Vault pairing link restored
// from sessionStorage without the origin check.
// Attack: a fresh pairing link is checked with assertVaultUri
// (vaultApi.js:200), but restore() takes saved.uri from sessionStorage as is
// (wallet.js:271) and getPairingUri() hands it to main.js:3546-3548, which
// renders it as the "Open KOIN Vault" <a href> and the pairing QR code. A
// value planted in sessionStorage (any same-origin page on the shared
// github.io origin, or a future bug) becomes a javascript: link or a
// phishing "KOIN Vault" link/QR on the real SwarmTales page.
// Mocks only (fetch, sessionStorage, location). Asserts the SAFE behaviour.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";

const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
};
if (!globalThis.location) globalThis.location = { protocol: "https:" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const path = String(url);
  const body = path.includes("/status")
    ? { ok: true, connected: false, expiresAt: Date.now() + 600000 }
    : { ok: true };
  return { ok: true, status: 200, json: async () => body };
};

const { createVaultWallet } = await import("../src/wallet.js");

test.after(() => {
  globalThis.fetch = realFetch;
});

for (const planted of [
  "javascript:alert(document.domain)",
  "https://koinvault.app.evil.example/",
  "https://evil.example/?koinvault.app",
]) {
  test("RT-WEB: a restored Vault pairing link is never shown unless it is https://koinvault.app/ (" + planted + ")", async () => {
    const w = createVaultWallet({ mainnet: true, id: "mainnet" });
    await w.restore({ kind: "koinvault", sessionId: "s1", secret: "x1", expiresAt: Date.now() + 600000, address: null, uri: planted });
    const shown = w.getPairingUri();
    await w.disconnect(); // stops the poll timer
    if (shown) {
      const u = new URL(shown);
      assert.equal(u.origin, "https://koinvault.app", "pairing link shown on the page points to " + shown);
    }
  });
}
