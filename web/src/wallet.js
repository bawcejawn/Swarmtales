/**
 * Wallet adapter.
 *
 * connect() asks the wallet for an address.
 * getAddress() returns that address, or null.
 * read() always uses the public RPC. Neither wallet is asked to read.
 * signAndSend() asks the wallet to sign the already-encoded calls and broadcast them.
 * The page never sees a private key.
 */
import { Transaction } from "koilib";
import { getSigner, getAccounts } from "kondor-js";
import { abisFor, freeMana, getProvider, lookupTransaction, read as chainRead, sponsorFunding, verifiedChain } from "./chain.js";
import { afterSponsorRefusal, isSponsorRefusal } from "./lib/sponsor.js";
import { VAULT_MANA_CEILING } from "./lib/money.js";
import {
  VAULT_MANA_EXPLANATION,
  VaultError,
  assertVaultUri,
  createVaultSession,
  fetchVaultConfig,
  vaultDisconnect,
  vaultManaDecision,
  vaultPairingDecision,
  vaultRequest,
  vaultRequestStatus,
  vaultStatus,
  vaultTransactionMismatch,
} from "./lib/vaultApi.js";

export { VAULT_MANA_EXPLANATION };

export const KONDOR_HINT_MAINNET = "If Kondor refuses the signature, tick Use free mana in its window.";
export const KONDOR_HINT_TESTNET = "If Kondor keeps asking to “Refresh check”, cancel it and use the Test wallet (testnet only) in the wallet window.";
/** Kept for older imports: the hint for the network this page uses. */
export function kondorHint(mainnet) {
  return mainnet ? KONDOR_HINT_MAINNET : KONDOR_HINT_TESTNET;
}

const SESSION_KEY = "swarmtales.wallet";

export function loadSavedSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.kind !== "kondor" && parsed.kind !== "koinvault" && parsed.kind !== "testwallet")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(value) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

export function clearSavedSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createKondorWallet() {
  let address = null;
  return {
    id: "kondor",
    label: "Kondor",
    /**
     * Every account Kondor shares with this site. Kondor decides which
     * accounts to share; the page then lets the person pick one.
     */
    listAccounts: async () => {
      const accounts = await withTimeout(
        getAccounts(),
        60000,
        "Kondor did not answer. Install the Kondor extension, unlock it, set it to this network, and try again."
      );
      const list = (Array.isArray(accounts) ? accounts : [])
        .filter((a) => a && typeof a.address === "string" && a.address)
        .map((a) => ({ address: a.address, name: typeof a.name === "string" ? a.name : "" }));
      const seen = new Set();
      const unique = list.filter((a) => (seen.has(a.address) ? false : seen.add(a.address)));
      if (!unique.length) throw new Error("Kondor did not share an address.");
      return unique;
    },
    useAccount: (chosen) => {
      if (!chosen || typeof chosen !== "string") throw new Error("Pick an account.");
      address = chosen;
      saveSession({ kind: "kondor", address });
      return address;
    },
    disconnect: async () => {
      address = null;
      clearSavedSession();
    },
    getAddress: () => address,
    restore: (saved) => {
      if (saved && saved.kind === "kondor" && saved.address) address = saved.address;
    },
    read: (name, method, args) => chainRead(name, method, args),
    signAndSend: async (operations, options = {}) => {
      if (!address) throw new Error("Connect Kondor first.");
      const chainId = verifiedChain();
      if (!chainId) throw new Error("The chain id has not been checked yet. Nothing was signed.");
      // The mana sponsor pays when it will (lib/sponsor.js). If it says no
      // before the transaction is in a block, the same action is asked again
      // with the user's own mana. Both use the user's next nonce, so at most
      // one of them can ever be included.
      const funding = await sponsorFunding(address, operations);
      if (funding) {
        try {
          return await kondorSend(address, chainId, operations, funding);
        } catch (error) {
          if (!isSponsorRefusal(error)) throw error;
          // It may have gone through after all (audit L-20): then wait for it.
          if ((await afterSponsorRefusal(error.transactionId, lookupTransaction)) === "landed") {
            return { transactionId: error.transactionId, receipt: null, sponsored: true };
          }
          if (options.onProgress) options.onProgress({ phase: "sponsor-refused" });
        }
      }
      return kondorSend(address, chainId, operations, null);
    },
  };
}

/** error, as an Error carrying the transaction id it is about. */
export function withTransactionId(error, transactionId) {
  const e = error instanceof Error ? error : new Error(String((error && error.message) || error));
  e.transactionId = transactionId;
  return e;
}

async function kondorSend(address, chainId, operations, funding) {
  let rcLimit;
  if (funding) {
    rcLimit = funding.rcLimit;
  } else {
    // Kondor measures the exact mana itself where it can. The ceiling here
    // is what's free right now, at most 30 mana, never the whole balance,
    // so one action can't block the next while it waits for a block.
    const mana = await freeMana(address);
    const ceiling = 3000000000n;
    rcLimit = mana.free < ceiling ? mana.free : ceiling;
  }
  const signer = getSigner(address, { provider: getProvider() });
  // The contracts' ABIs go to Kondor, so its confirm window can show each
  // call by name with its arguments (the price cap, the Ink amount, the
  // recipient) instead of raw bytes (audit M-9).
  const abis = abisFor(operations);
  const tx = new Transaction({
    signer,
    provider: getProvider(),
    options: {
      chainId,
      payer: funding ? funding.payer : address,
      ...(funding ? { payee: funding.payee } : {}),
      rcLimit: rcLimit.toString(),
      sendAbis: true,
      broadcast: true,
    },
  });
  for (const op of operations) await tx.pushOperation(op);
  const prepared = await tx.prepare();
  let sent;
  try {
    sent = await signer.sendTransaction(prepared, { broadcast: true, sendAbis: true, abis });
  } catch (error) {
    // The id is the hash of the header, so it is known before signing: kept
    // so a sponsor refusal can be checked against the node (audit L-20).
    throw withTransactionId(error, prepared.id);
  }
  const transaction = sent.transaction || prepared;
  return {
    transactionId: transaction.id,
    receipt: sent.receipt || null,
    sponsored: !!funding,
  };
}

/**
 * Before the page reports a KOIN Vault request as sent, read the transaction
 * Vault named back from the Koinos node and check it is the one this page
 * asked for: same id, chain and contract calls (audit W1-04). Throws if it
 * differs, or if the node doesn't have it within `waitMs`.
 */
export async function verifyVaultTransaction(txid, operations, chainId, deps = {}) {
  const lookup = deps.lookup || lookupTransaction;
  const wait = deps.sleep || sleep;
  const waitMs = deps.waitMs == null ? 90000 : deps.waitMs;
  const now = deps.now || Date.now;
  const until = now() + waitMs;
  for (;;) {
    const row = await lookup(txid).catch(() => null);
    const transaction = row && row.transaction;
    if (transaction) {
      const why = vaultTransactionMismatch(transaction, operations, { txid, chainId });
      if (why) {
        throw new Error("KOIN Vault reported transaction " + txid + " as sent, but it is not what this page asked for (" + why +
          "). This page does not count it as done. Check your account on a block explorer.");
      }
      return transaction;
    }
    if (now() >= until) {
      throw new Error("KOIN Vault says it sent transaction " + txid + ", but the network doesn't show it yet, so this page can't check it. " +
        "Look it up on a block explorer before you try again, so nothing is sent twice.");
    }
    await wait(3000);
  }
}

export function createVaultWallet(pageNetwork) {
  let address = null;
  let credentials = null;
  let expiresAt = 0;
  let pairingUri = "";
  let pollTimer = 0;
  let onChange = () => {};

  function stopPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = 0;
    }
  }

  function remember() {
    if (!credentials) return;
    saveSession({
      kind: "koinvault",
      address,
      sessionId: credentials.sessionId,
      secret: credentials.secret,
      expiresAt,
      uri: pairingUri,
    });
  }

  async function poll() {
    stopPoll();
    if (!credentials) return;
    try {
      const status = await vaultStatus(credentials);
      expiresAt = status.expiresAt || expiresAt;
      if (!status.connected || !status.address) {
        if (address) {
          address = null;
          credentials = null;
          pairingUri = "";
          clearSavedSession();
          onChange({ phase: "ended", reason: "KOIN Vault disconnected this site." });
          return;
        }
      } else if (address && status.address !== address) {
        address = null;
        credentials = null;
        pairingUri = "";
        clearSavedSession();
        onChange({ phase: "ended", reason: "KOIN Vault switched accounts. Connect again." });
        return;
      } else if (!address && status.connected) {
        address = status.address;
        remember();
        onChange({ phase: "connected", address, expiresAt });
      } else {
        remember();
        onChange({ phase: address ? "connected" : "pairing", address, expiresAt });
      }
    } catch (error) {
      if (error instanceof VaultError && (error.status === 404 || error.status === 410)) {
        address = null;
        credentials = null;
        pairingUri = "";
        clearSavedSession();
        onChange({ phase: "ended", reason: "The KOIN Vault session expired. Pair again." });
        return;
      }
      onChange({ phase: "degraded", address, expiresAt });
    }
    // Every status call carries the session secret: ask every 2 seconds
    // while pairing, then every 10 seconds once connected (W1-05).
    if (credentials) pollTimer = setTimeout(poll, address ? 10000 : 2000);
  }

  return {
    id: "koinvault",
    label: "KOIN Vault",
    setListener: (fn) => {
      onChange = fn;
    },
    connect: async () => {
      const config = await fetchVaultConfig();
      const decision = vaultPairingDecision(pageNetwork, config, location.protocol);
      if (!decision.ok) {
        const error = new Error(decision.reason);
        error.code = "vault-blocked";
        throw error;
      }
      stopPoll();
      const session = await createVaultSession("SwarmTales");
      credentials = { sessionId: session.sessionId, secret: session.secret };
      expiresAt = session.expiresAt;
      pairingUri = session.uri;
      address = null;
      remember();
      onChange({ phase: "pairing", uri: session.uri, expiresAt });
      poll();
      return session;
    },
    disconnect: async () => {
      stopPoll();
      const current = credentials;
      address = null;
      credentials = null;
      expiresAt = 0;
      pairingUri = "";
      clearSavedSession();
      if (current) await vaultDisconnect(current);
    },
    getAddress: () => address,
    getExpiry: () => expiresAt,
    getPairingUri: () => (address ? "" : pairingUri),
    read: (name, method, args) => chainRead(name, method, args),
    restore: async (saved) => {
      if (!saved || saved.kind !== "koinvault" || !saved.sessionId || !saved.secret) return;
      const decision = vaultPairingDecision(pageNetwork, { ok: true, network: "mainnet", testnet: false, features: { openDappConnections: true } }, location.protocol);
      if (!decision.ok) {
        clearSavedSession();
        return;
      }
      // A saved pairing link passes the same check as a fresh one (AB-042):
      // anything but https://koinvault.app/ drops the whole saved session.
      let uri = "";
      if (typeof saved.uri === "string" && saved.uri) {
        try {
          uri = assertVaultUri(saved.uri);
        } catch {
          clearSavedSession();
          return;
        }
      }
      credentials = { sessionId: saved.sessionId, secret: saved.secret };
      expiresAt = saved.expiresAt || 0;
      pairingUri = uri;
      address = saved.address || null;
      await poll();
    },
    signAndSend: async (operations, hooks) => {
      if (!address || !credentials) throw new Error("Connect KOIN Vault first.");
      const chainId = verifiedChain();
      if (!chainId) throw new Error("The chain id has not been checked yet. Nothing was signed.");
      const mana = await getProvider().getAccountRc(address);
      const manaDecision = vaultManaDecision(mana, VAULT_MANA_CEILING);
      if (manaDecision.blocked) {
        throw new Error(manaDecision.message);
      }
      const created = await vaultRequest(credentials, operations);
      if (hooks && hooks.onProgress) {
        hooks.onProgress({
          phase: "awaiting-approval",
          expiresAt: created.expiresAt,
          funding: created.funding,
        });
      }
      let sawSubmitting = false;
      const deadline = created.expiresAt;
      while (Date.now() < deadline + 5000) {
        let status;
        try {
          status = await vaultRequestStatus(credentials, created.requestId);
        } catch (error) {
          if (error instanceof VaultError && error.status === 404) {
            if (sawSubmitting) {
              throw new Error("KOIN Vault lost track of this request after it started sending. It may still reach the chain. Check the account on a block explorer before you try again.");
            }
            throw new Error("KOIN Vault dropped this request before it was approved. Nothing was sent.");
          }
          if (Date.now() > deadline) break;
          await sleep(2000);
          continue;
        }
        if (status.status === "submitting") {
          sawSubmitting = true;
          if (hooks && hooks.onProgress) hooks.onProgress({ phase: "submitting" });
        } else if (status.status === "approved") {
          if (!status.txid) throw new Error("KOIN Vault approved the request but did not return a transaction id.");
          if (hooks && hooks.onProgress) hooks.onProgress({ phase: "verifying" });
          await verifyVaultTransaction(status.txid, operations, chainId);
          return { transactionId: status.txid, receipt: null };
        } else if (status.status === "rejected") {
          throw new Error("You declined this in KOIN Vault. Nothing was sent.");
        } else if (status.status === "failed") {
          const extra = status.error ? " " + status.error : "";
          const id = status.txid ? " Transaction id: " + status.txid + "." : "";
          throw new Error("KOIN Vault could not finish the transaction." + extra + id);
        }
        await sleep(2000);
      }
      if (sawSubmitting) {
        throw new Error("KOIN Vault started sending this and then stopped answering. Check the account on a block explorer before you try again.");
      }
      throw new Error("The KOIN Vault request expired before it was approved. Nothing was sent.");
    },
  };
}
