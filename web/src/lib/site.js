/**
 * The site's own address (audit M-7, W1-07).
 *
 * Every absolute link the page builds (share links, invite links, the book
 * address recorded on chain) starts from ONE configured address, SITE.url in
 * web/src/config.js, never from the address bar. So a query string, a hash,
 * a local preview or a copy of the site served somewhere else never ends up
 * in a link or on chain.
 */

/**
 * The checked site address: https, a host, a path ending in "/", and no
 * query string, hash, user name or password. Throws on anything else.
 */
export function canonicalBase(siteUrl) {
  let url;
  try {
    url = new URL(String(siteUrl || ""));
  } catch {
    throw new Error("SITE.url must be a full https:// address.");
  }
  if (url.protocol !== "https:") throw new Error("SITE.url must start with https://.");
  if (url.username || url.password) throw new Error("SITE.url must not contain a user name or password.");
  if (url.search || url.hash || String(siteUrl).includes("?") || String(siteUrl).includes("#")) {
    throw new Error("SITE.url must not contain ? or #.");
  }
  if (!url.pathname.endsWith("/")) throw new Error("SITE.url must end with /.");
  return url.origin + url.pathname;
}

/** An address inside the site: base + "#/" + route (route without a leading "#/"). */
export function siteLink(siteUrl, route) {
  return canonicalBase(siteUrl) + "#/" + String(route || "").replace(/^#?\/?/, "");
}

/**
 * The domain for a GitHub Pages CNAME file, or "" while the site is still on
 * <user>.github.io (no custom domain: no CNAME).
 */
export function customDomain(siteUrl) {
  const host = new URL(canonicalBase(siteUrl)).hostname;
  return /\.github\.io$/i.test(host) ? "" : host;
}
