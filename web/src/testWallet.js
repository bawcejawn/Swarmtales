/**
 * Test wallet: a throwaway key kept in this browser, for the TESTNET ONLY.
 *
 * Why it exists: some Kondor versions can't estimate mana on the Foundation
 * testnet and loop on "Refresh check". This lets anyone test SwarmTales in
 * the browser without depending on an extension.
 *
 * Rules:
 *   - It refuses to exist on mainnet (createTestWallet returns null).
 *   - The key is random, made here, and stored only in this browser's
 *     localStorage. It is never sent anywhere. Clearing site data loses it.
 *   - It is play money: only send it test KOIN.
 */
import { Signer, Transaction, utils } from "koilib";
import { freeMana, getProvider, lookupTransaction, sponsorFunding, verifiedChain } from "./chain.js";
import { afterSponsorRefusal, isSponsorRefusal } from "./lib/sponsor.js";

/**
 * The most mana one test-wallet transaction may use: 30 mana, as for Kondor.
 * Measured SwarmTales writes use well under 5. A lower cap keeps the rest
 * free while the node holds this transaction's limit for a few minutes.
 */
export const TEST_WALLET_MANA_CAP = 3000000000n;

const KEY_STORE = "swarmtales.testwallet.v1";

function loadKey() {
  try {
    const hex = localStorage.getItem(KEY_STORE);
    return hex && /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  } catch {
    return null;
  }
}

function saveKey(hex) {
  localStorage.setItem(KEY_STORE, hex);
}

function newKeyHex() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return utils.toHexString(bytes);
}

function signerFor(hex) {
  return new Signer({ privateKey: hex, provider: getProvider() });
}

/** The address of the stored test key, or null. */
export function storedTestAddress() {
  const hex = loadKey();
  return hex ? signerFor(hex).getAddress() : null;
}

export function createTestWallet(network) {
  if (!network || network.mainnet) return null;
  let address = null;
  return {
    id: "testwallet",
    label: "Test wallet",
    /** Make a new key if there is none, then use it. */
    connect: async () => {
      let hex = loadKey();
      if (!hex) {
        hex = newKeyHex();
        saveKey(hex);
      }
      address = signerFor(hex).getAddress();
      return address;
    },
    disconnect: async () => {
      address = null;
    },
    /** Delete the key from this browser. Any tKOIN on it is lost. */
    forget: () => {
      address = null;
      try {
        localStorage.removeItem(KEY_STORE);
      } catch {
        /* nothing stored */
      }
    },
    getAddress: () => address,
    restore: () => {
      const hex = loadKey();
      address = hex ? signerFor(hex).getAddress() : null;
    },
    signAndSend: async (operations, options = {}) => {
      const hex = loadKey();
      if (!hex || !address) throw new Error("Create the test wallet first.");
      const chainId = verifiedChain();
      if (!chainId) throw new Error("The chain id has not been checked yet. Nothing was signed.");
      const signer = signerFor(hex);
      // The mana sponsor pays when it will (lib/sponsor.js). If it says no on
      // the trial run, the action runs again with the test wallet's own mana.
      // Both transactions use the wallet's next nonce, so at most one of them
      // can ever be included.
      const funding = await sponsorFunding(address, operations);
      if (funding) {
        try {
          return await testWalletSend(signer, chainId, operations, funding);
        } catch (error) {
          if (!isSponsorRefusal(error)) throw error;
          // It may have gone through after all (audit L-20): then wait for it.
          if ((await afterSponsorRefusal(error.transactionId, lookupTransaction)) === "landed") {
            return { transactionId: error.transactionId, receipt: null, sponsored: true };
          }
          if (options.onProgress) options.onProgress({ phase: "sponsor-refused" });
        }
      }
      const mana = await freeMana(address);
      if (mana.free === 0n) {
        throw new Error(mana.reserved > 0n
          ? "The test wallet's mana is held for its last transaction for a few minutes. Try again shortly, or send it more tKOIN."
          : "The test wallet has no mana. Send it some tKOIN first.");
      }
      const rcLimit = mana.free < TEST_WALLET_MANA_CAP ? mana.free : TEST_WALLET_MANA_CAP;
      return testWalletSend(signer, chainId, operations, { payer: address, rcLimit });
    },
  };
}

/**
 * ONE signed transaction (audit W1-08). The node first runs it without
 * adding it to a block (broadcast false), so a refusal shows the contract's
 * reason and costs nothing. Then the very same signed transaction is sent.
 * The node never holds a second, different signed transaction it could send
 * instead (a sponsor refusal and the user-paid retry share one nonce).
 */
async function testWalletSend(signer, chainId, operations, funding) {
  const provider = getProvider();
  const options = { chainId, payer: funding.payer, rcLimit: funding.rcLimit.toString() };
  if (funding.payee) options.payee = funding.payee;
  const tx = new Transaction({ signer, provider, options });
  for (const op of operations) await tx.pushOperation(op);
  await tx.prepare();
  await tx.sign();
  const signed = JSON.parse(JSON.stringify(tx.transaction));
  try {
    const { receipt: trial } = await provider.sendTransaction(signed, false);
    if (trial && trial.reverted) return { transactionId: "", receipt: trial };
    const receipt = await tx.send();
    return { transactionId: tx.transaction.id, receipt: receipt || null, sponsored: !!funding.payee };
  } catch (error) {
    // Kept so a sponsor refusal can be checked against the node (audit L-20).
    const e = error instanceof Error ? error : new Error(String((error && error.message) || error));
    e.transactionId = tx.transaction.id;
    throw e;
  }
}

/**
 * On a mainnet build, delete any test-wallet key this browser kept from the
 * testnet (AB-014). The same key is a valid mainnet key, and it sits in plain
 * localStorage, so it should not outlive the test version.
 */
export function forgetTestWalletOnMainnet(network, storage) {
  if (!network || !network.mainnet) return;
  try {
    storage.removeItem(KEY_STORE);
  } catch {
    /* storage blocked: nothing to remove */
  }
}
