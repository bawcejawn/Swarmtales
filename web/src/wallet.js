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
import { getProvider, read as chainRead, verifiedChain } from "./chain.js";
import { VAULT_MANA_CEILING } from "./lib/money.js";
import {
  VAULT_MANA_EXPLANATION,
  VaultError,
  createVaultSession,
  fetchVaultConfig,
  vaultDisconnect,
  vaultManaDecision,
  vaultPairingDecision,
  vaultRequest,
  vaultRequestStatus,
  vaultStatus,
} from "./lib/vaultApi.js";

export { VAULT_MANA_EXPLANATION };

export const KONDOR_HINT_MAINNET = "If Kondor refuses the signature, tick Use free mana in its window.";
export const KONDOR_HINT_TESTNET = "If Kondor keeps asking to “Refresh check”, press Use free mana, or switch off Optimize mana under Technical details.";
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
    signAndSend: async (operations) => {
      if (!address) throw new Error("Connect Kondor first.");
      const chainId = verifiedChain();
      if (!chainId) throw new Error("The chain id has not been checked yet. Nothing was signed.");
      const mana = await getProvider().getAccountRc(address);
      const signer = getSigner(address, { provider: getProvider() });
      const tx = new Transaction({
        signer,
        provider: getProvider(),
        options: {
          chainId,
          payer: address,
          rcLimit: String(mana || "0"),
          sendAbis: false,
          broadcast: true,
        },
      });
      for (const op of operations) await tx.pushOperation(op);
      const prepared = await tx.prepare();
      const sent = await signer.sendTransaction(prepared, { broadcast: true, sendAbis: false });
      const transaction = sent.transaction || prepared;
      return {
        transactionId: transaction.id,
        receipt: sent.receipt || null,
      };
    },
  };
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
    if (credentials) pollTimer = setTimeout(poll, 2000);
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
      credentials = { sessionId: saved.sessionId, secret: saved.secret };
      expiresAt = saved.expiresAt || 0;
      pairingUri = typeof saved.uri === "string" ? saved.uri : "";
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
