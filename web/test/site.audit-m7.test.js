// Audit 2026-10 M-7 and W1-07: every absolute link starts from SITE.url, never
// from the address bar, so a query string or hash never reaches a link or the
// on-chain book address; one config value moves the site to its own domain.
import assert from "node:assert/strict";
import test from "node:test";
import { SITE, configProblems } from "../src/config.js";
import { canonicalBase, customDomain, siteLink } from "../src/lib/site.js";
import { buildInviteLink } from "../src/lib/links.js";

test("the configured site address is a clean https base", () => {
  assert.equal(canonicalBase(SITE.url), SITE.url);
  assert.deepEqual(configProblems(), []);
});

test("W1-07: query strings, hashes and other shapes are refused, never carried into links", () => {
  for (const bad of [
    "https://bawcejawn.github.io/Swarmtales/?utm_source=x",
    "https://bawcejawn.github.io/Swarmtales/#/stories/1",
    "https://bawcejawn.github.io/Swarmtales",
    "http://bawcejawn.github.io/Swarmtales/",
    "https://user:pw@example.org/",
    "javascript:alert(1)//",
    "",
  ]) {
    assert.throws(() => canonicalBase(bad), /SITE\.url/, bad);
  }
  const link = siteLink("https://swarmtales.example/", "stories/7/book");
  assert.equal(link, "https://swarmtales.example/#/stories/7/book");
  assert.equal(buildInviteLink(canonicalBase(SITE.url), 3, 4, "K").startsWith(SITE.url + "#/join/3/4?k="), true);
});

test("M-7: a CNAME is only produced for a custom domain", () => {
  assert.equal(customDomain("https://bawcejawn.github.io/Swarmtales/"), "");
  assert.equal(customDomain("https://swarmtales.example/"), "swarmtales.example");
});

test("M-7: the build writes the canonical link, and a CNAME file only once SITE.url is a custom domain", async () => {
  const config = (await import("../vite.config.js")).default;
  const plugin = config.plugins.find((p) => p && p.name === "swarmtales-site-address");
  assert.ok(plugin, "site-address plugin");
  const html = plugin.transformIndexHtml('<meta property="og:type" content="website" />');
  assert.match(html, new RegExp('<link rel="canonical" href="' + SITE.url.replace(/[.]/g, "\\.") + '"'));
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
  assert.equal(emitted.length, customDomain(SITE.url) ? 1 : 0);
  assert.equal(config.base, "./", "relative assets work on github.io/<repo>/ and on a custom domain root");
});
