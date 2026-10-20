/**
 * Signed invite and promo links (security fixes H2 and H3).
 *
 * A link carries a fresh, single-purpose PRIVATE key in its # fragment,
 * which never reaches any web server. Only the matching PUBLIC address is
 * stored on chain. To claim a promo or join a private story, the viewer's
 * browser signs a message that names THEIR wallet, so a copied link
 * signature cannot be replayed for anyone else.
 *
 * The signed message must match Shop.promoDigest and Stories.inviteDigest
 * byte for byte:
 *   promo:  "swarmtales/promo/v1"  || shop(25)    || campaignId(8, BE)              || wallet(25)
 *   invite: "swarmtales/invite/v1" || stories(25) || storyId(8, BE) || inviteId(8, BE) || wallet(25)
 * The link key signs sha256(message). (The contract hashes the message to
 * a multihash and recovers the signer; the 32 bytes it recovers against
 * are this same sha256.)
 */

import { Signer, utils } from "koilib";

const PROMO_DOMAIN = "swarmtales/promo/v1";
const INVITE_DOMAIN = "swarmtales/invite/v1";

const encoder = new TextEncoder();

function addressBytes(address) {
  const bytes = utils.decodeBase58(address);
  if (bytes.length !== 25) throw new Error("A Koinos address is 25 bytes.");
  return bytes;
}

function u64BE(value) {
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function promoMessage(shopAddress, campaignId, account) {
  return concat([encoder.encode(PROMO_DOMAIN), addressBytes(shopAddress), u64BE(campaignId), addressBytes(account)]);
}

function inviteMessage(storiesAddress, storyId, inviteId, account) {
  return concat([encoder.encode(INVITE_DOMAIN), addressBytes(storiesAddress), u64BE(storyId), u64BE(inviteId), addressBytes(account)]);
}

/**
 * A new single-purpose link key. `secret` goes in the link's # fragment;
 * `address` is what the admin stores on chain (the campaign's link_signer,
 * or an invite's link_signer).
 */
export function generateLinkKey() {
  // 32 bytes straight from the browser's secure random source (AB-013).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const signer = new Signer({ privateKey: utils.toHexString(bytes) });
  return { secret: signer.getPrivateKey("wif"), address: signer.getAddress() };
}

/** The address a link secret controls, for display or verification. */
export function linkKeyAddress(secret) {
  return Signer.fromWif(secret).getAddress();
}

/** Sign a promo claim for `account` with the link key from the link. */
export async function signPromoClaim(secret, shopAddress, campaignId, account) {
  const signer = Signer.fromWif(secret);
  const hash = await sha256(promoMessage(shopAddress, campaignId, account));
  return signer.signHash(hash);
}

/** Sign an invite join for `account` with the link key from the link. */
export async function signInviteJoin(secret, storiesAddress, storyId, inviteId, account) {
  const signer = Signer.fromWif(secret);
  const hash = await sha256(inviteMessage(storiesAddress, storyId, inviteId, account));
  return signer.signHash(hash);
}

/**
 * Read the link secret from a URL hash route's query, e.g.
 *   #/promo/3?k=<wif>      → { key: "<wif>" }
 *   #/join/12/4?k=<wif>    → { key: "<wif>" }
 * The secret lives after the #, so it is never sent to a web server.
 */
export function linkSecretFromHash(hash) {
  const q = (hash || "").indexOf("?");
  if (q < 0) return "";
  const params = new URLSearchParams(hash.slice(q + 1));
  return params.get("k") || "";
}

/** Build the shareable links. The site base is whatever page is open. */
export function buildPromoLink(base, campaignId, secret) {
  return base + "#/promo/" + campaignId + "?k=" + encodeURIComponent(secret);
}

export function buildInviteLink(base, storyId, inviteId, secret) {
  return base + "#/join/" + storyId + "/" + inviteId + "?k=" + encodeURIComponent(secret);
}

/**
 * Which invite holds this link's key (AB-008). Looks at the story's invites
 * from `before` (next_invite_id read before sending) up to the current
 * counter, and returns the id whose link_signer is `linkSigner`, or null.
 * The id is read back from the chain, never guessed, so a link is only
 * shown for an invite that exists and opens with this key.
 */
export async function findInviteId({ before, linkSigner, readInvite, readNextId, max = 20 }) {
  const first = Math.max(1, Number(before) || 1);
  const next = Number(await readNextId().catch(() => 0)) || 0;
  for (let id = first; id < next && id < first + max; id++) {
    const invite = await readInvite(id).catch(() => null);
    if (invite && invite.link_signer === linkSigner) return id;
  }
  return null;
}

/**
 * The page's hash without the link secret (?k=...), so it can be put back
 * in the address bar after the page has read it: the secret then stays out
 * of browser history and of anything that copies the URL (AB-013).
 */
export function hashWithoutSecret(hash) {
  const q = (hash || "").indexOf("?");
  if (q < 0) return hash || "";
  const params = new URLSearchParams(hash.slice(q + 1));
  params.delete("k");
  const rest = params.toString();
  return hash.slice(0, q) + (rest ? "?" + rest : "");
}
