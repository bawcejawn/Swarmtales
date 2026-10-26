/**
 * KOIN Vault's public website API.
 *
 * Official method (checked 19 October 2026 against
 * https://koinvault.app/api/config and the wallet's website-integration guide):
 * plain HTTPS JSON at https://koinvault.app/api/dapp/*. No npm SDK, no injected
 * provider, no WalletConnect project id, no account to create.
 *
 * The wallet's own server builds, signs with the user's passkey, and broadcasts.
 * It chooses the payer. This page cannot set a payer. Unknown contracts,
 * including SwarmTales, are paid from the connected account's own mana, and
 * Vault requires about 100 mana to be available before it will accept the request.
 *
 * The live deployment reports network "mainnet" and testnet false. A site
 * cannot ask it to use the testnet.
 *
 * The session secret is a bearer credential. It must never appear in an error.
 */

export const VAULT_ORIGIN = "https://koinvault.app";
export const VAULT_API = VAULT_ORIGIN + "/api/dapp/";
export const MAX_VAULT_OPERATIONS = 6;
export const MAX_VAULT_JSON_BYTES = 48 * 1024;

/** Shown before a Vault submit when the account is under Vault's 100 mana ceiling. */
export const VAULT_MANA_EXPLANATION =
  "KOIN Vault pays for SwarmTales from your account's own mana. It will not sponsor these contracts, and this page cannot choose a different payer. Vault refuses the request unless about 100 mana is available, even though the write itself uses less than 1 mana. Mana refills over about five days from the KOIN in the account. Wait for it to refill, or connect an account that already has 100 mana.";

export class VaultError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "VaultError";
    this.status = status;
  }
}

export function scrubSecret(text, credentials) {
  let out = String(text ?? "");
  if (!credentials) return out;
  for (const value of [credentials.secret, credentials.sessionId]) {
    if (value) out = out.split(value).join("[redacted]");
  }
  return out;
}

export function assertVaultUri(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new VaultError("KOIN Vault returned an unexpected link.");
  }
  if (parsed.origin !== VAULT_ORIGIN || parsed.pathname !== "/") {
    throw new VaultError("KOIN Vault returned an unexpected link.");
  }
  return parsed.toString();
}

/**
 * Whether this page may pair Vault.
 * `page` is the selected network ({ mainnet, id }).
 * `vaultConfig` is the JSON from GET /api/config.
 * `protocol` is the page's location.protocol ("https:" or "http:").
 */
export function vaultPairingDecision(page, vaultConfig, protocol) {
  if (protocol !== "https:") {
    return {
      ok: false,
      reason: "KOIN Vault only connects from an HTTPS website. This copy is being served over plain HTTP, which Vault refuses. Use Kondor here, or open the published GitHub Pages site on your phone.",
    };
  }
  if (!vaultConfig || vaultConfig.ok !== true) {
    return { ok: false, reason: "KOIN Vault did not confirm its network, so this page will not pair with it." };
  }
  if (!vaultConfig.features || vaultConfig.features.openDappConnections !== true) {
    return { ok: false, reason: "KOIN Vault is not accepting website connections right now." };
  }
  const vaultMainnet = vaultConfig.testnet === false && vaultConfig.network === "mainnet";
  if (!vaultMainnet) {
    return {
      ok: false,
      reason: "KOIN Vault reported a network this page does not recognise (" + (vaultConfig.network || "unset") + "). Nothing was paired.",
    };
  }
  if (!page || !page.mainnet) {
    return {
      ok: false,
      reason: "KOIN Vault only signs on Koinos mainnet. This page is on the testnet, and Vault cannot be pointed at the testnet. Use Kondor on a computer for these testnet contracts. After the addresses in web/src/config.js are switched to mainnet, this button will pair Vault.",
    };
  }
  return { ok: true, reason: "" };
}

/** Block a Vault submit when the account cannot cover Vault's 100 mana ceiling. */
export function vaultManaDecision(rc, ceiling) {
  let have;
  try {
    have = BigInt(rc);
  } catch {
    return {
      blocked: true,
      message: "This page could not read your mana, so it will not ask KOIN Vault to sign.",
    };
  }
  const need = BigInt(ceiling);
  if (have < need) {
    return { blocked: true, message: VAULT_MANA_EXPLANATION };
  }
  return { blocked: false, message: "" };
}

export function toRelayOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new VaultError("KOIN Vault needs at least one contract call.");
  }
  if (operations.length > MAX_VAULT_OPERATIONS) {
    throw new VaultError("KOIN Vault accepts at most " + MAX_VAULT_OPERATIONS + " contract calls at once.");
  }
  const relay = operations.map((op) => {
    const call = op && op.call_contract;
    if (!call || !call.contract_id || call.entry_point == null || call.args == null) {
      throw new VaultError("A contract call was not encoded.");
    }
    return {
      call_contract: {
        contract_id: call.contract_id,
        entry_point: call.entry_point,
        args: call.args,
      },
    };
  });
  const bytes = new TextEncoder().encode(JSON.stringify(relay)).length;
  if (bytes > MAX_VAULT_JSON_BYTES) {
    throw new VaultError("That text is too large for one KOIN Vault request.");
  }
  return relay;
}

async function call(path, request, options) {
  const fetchImpl = (options && options.fetchImpl) || fetch;
  const credentials = request.credentials;
  const query = request.query ? "?" + new URLSearchParams(request.query).toString() : "";
  const init = {
    method: request.method,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  };
  if (request.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(request.body);
  }
  let response;
  try {
    response = await fetchImpl(VAULT_API + path + query, init);
  } catch {
    throw new VaultError("Could not reach KOIN Vault.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new VaultError("KOIN Vault returned a response that was not JSON.", response.status);
  }
  const json = body && typeof body === "object" ? body : {};
  if (!response.ok || json.ok !== true) {
    const text = typeof json.error === "string" && json.error
      ? json.error
      : "KOIN Vault error (HTTP " + response.status + ")";
    throw new VaultError(scrubSecret(text, credentials), response.status);
  }
  return json;
}

export async function fetchVaultConfig(fetchImpl) {
  const doFetch = fetchImpl || fetch;
  let response;
  try {
    response = await doFetch(VAULT_ORIGIN + "/api/config", { credentials: "omit", cache: "no-store" });
  } catch {
    throw new VaultError("Could not reach KOIN Vault.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new VaultError("KOIN Vault returned a response that was not JSON.", response.status);
  }
  if (!response.ok || !body || body.ok !== true) {
    throw new VaultError("KOIN Vault did not confirm its network.", response.status);
  }
  return body;
}

export async function createVaultSession(name, fetchImpl) {
  const json = await call("create", { method: "POST", body: { name } }, { fetchImpl });
  if (typeof json.sessionId !== "string" || typeof json.secret !== "string" || typeof json.uri !== "string" || typeof json.expiresAt !== "number") {
    throw new VaultError("KOIN Vault returned an unexpected create response.");
  }
  const uri = assertVaultUri(json.uri);
  return { sessionId: json.sessionId, secret: json.secret, expiresAt: json.expiresAt, uri };
}

/**
 * Status calls carry the session secret. They are sent in a POST body (or,
 * failing that, a GET query string) so the secret stays out of URLs, where
 * servers, proxies and logs keep it (audit W1-05).
 *
 * KOIN Vault's published integration (checked 19 October 2026) uses GET with
 * ?sessionId=&secret= for status and request-status. Whether it also accepts
 * the same fields as a JSON POST is not documented, so the first status call
 * of a session tries POST, and only if Vault answers with an explicit "not
 * this way" status (404, 405, 415 or 501) does it use GET for the rest of
 * that session. A network error, a refused cross-origin request, a 400 or a
 * non-JSON answer is reported, never retried with the secret in a URL
 * (audit L-22; owner decision 5, confirmed on launch day).
 * credentials.transport remembers the choice ("post" or "get").
 */
const UNSUPPORTED_POST = new Set([404, 405, 415, 501]);

async function authedCall(path, fields, credentials, fetchImpl) {
  const body = { sessionId: credentials.sessionId, secret: credentials.secret, ...fields };
  if (credentials.transport !== "get") {
    try {
      const json = await call(path, { method: "POST", body, credentials }, { fetchImpl });
      credentials.transport = "post";
      return json;
    } catch (error) {
      const probing = credentials.transport !== "post";
      const unsupported = error instanceof VaultError && error.status != null && UNSUPPORTED_POST.has(error.status);
      if (!probing || !unsupported) throw error;
    }
  }
  const json = await call(path, { method: "GET", query: body, credentials }, { fetchImpl });
  credentials.transport = "get";
  return json;
}

export async function vaultStatus(credentials, fetchImpl) {
  const json = await authedCall("status", {}, credentials, fetchImpl);
  if (typeof json.connected !== "boolean" || typeof json.expiresAt !== "number") {
    throw new VaultError("KOIN Vault returned an unexpected status.");
  }
  return {
    connected: json.connected,
    address: typeof json.address === "string" ? json.address : null,
    expiresAt: json.expiresAt,
    connectedAt: typeof json.connectedAt === "number" ? json.connectedAt : null,
  };
}

export async function vaultRequest(credentials, operations, fetchImpl) {
  const json = await call("request", {
    method: "POST",
    body: {
      sessionId: credentials.sessionId,
      secret: credentials.secret,
      operations: toRelayOperations(operations),
      mana: "auto",
    },
    credentials,
  }, { fetchImpl });
  const funding = json.funding;
  if (typeof json.requestId !== "string" || typeof json.expiresAt !== "number" || !funding ||
      (funding.payer !== "sponsor" && funding.payer !== "wallet")) {
    throw new VaultError("KOIN Vault returned an unexpected request response.");
  }
  return {
    requestId: json.requestId,
    expiresAt: json.expiresAt,
    funding: {
      payer: funding.payer,
      address: String(funding.address || ""),
      maxMana: String(funding.maxMana || ""),
      rcLimit: String(funding.rcLimit || ""),
    },
  };
}

const REQUEST_STATUSES = ["pending", "submitting", "approved", "rejected", "failed", "signed"];

export async function vaultRequestStatus(credentials, requestId, fetchImpl) {
  const json = await authedCall("request-status", { requestId }, credentials, fetchImpl);
  if (typeof json.status !== "string" || !REQUEST_STATUSES.includes(json.status)) {
    throw new VaultError("KOIN Vault returned an unexpected request status.");
  }
  return {
    status: json.status,
    txid: typeof json.txid === "string" ? json.txid : null,
    error: typeof json.error === "string" ? scrubSecret(json.error, credentials) : null,
  };
}

export async function vaultDisconnect(credentials, fetchImpl) {
  try {
    await call("disconnect", {
      method: "POST",
      body: { sessionId: credentials.sessionId, secret: credentials.secret },
      credentials,
    }, { fetchImpl });
  } catch (error) {
    if (error instanceof VaultError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}

function b64url(value) {
  return String(value ?? "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Is `transaction` (read back from a Koinos node by its id) exactly what this
 * page asked KOIN Vault to sign (audit W1-04)? A buggy or hostile Vault
 * endpoint could answer "approved" with the id of some other transaction;
 * the page must not then say "Done". Checks: the id, the chain, and the
 * contract calls themselves (same count, order, contract, entry point and
 * argument bytes). Returns "" when it matches, else the reason.
 */
export function vaultTransactionMismatch(transaction, requested, { txid, chainId }) {
  if (!transaction || typeof transaction !== "object") return "the network has no such transaction";
  const idOf = (v) => String(v || "").toLowerCase().replace(/^0x/, "");
  if (!idOf(txid) || idOf(transaction.id) !== idOf(txid)) return "its id is different";
  const header = transaction.header || {};
  if (chainId && header.chain_id !== chainId) return "it is for a different chain";
  const ops = Array.isArray(transaction.operations) ? transaction.operations : [];
  const want = toRelayOperations(requested);
  if (ops.length !== want.length) return "it has " + ops.length + " contract calls, not " + want.length;
  for (let i = 0; i < want.length; i++) {
    const got = ops[i] && ops[i].call_contract;
    const exp = want[i].call_contract;
    if (!got) return "call " + (i + 1) + " is not a contract call";
    if (String(got.contract_id) !== String(exp.contract_id)) return "call " + (i + 1) + " goes to a different contract";
    if (Number(got.entry_point) !== Number(exp.entry_point)) return "call " + (i + 1) + " calls a different function";
    if (b64url(got.args) !== b64url(exp.args)) return "call " + (i + 1) + " has different details";
  }
  return "";
}
