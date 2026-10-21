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
import { freeMana, getProvider, manaLimit, verifiedChain } from "./chain.js";

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
    signAndSend: async (operations) => {
      const hex = loadKey();
      if (!hex || !address) throw new Error("Create the test wallet first.");
      const chainId = verifiedChain();
      if (!chainId) throw new Error("The chain id has not been checked yet. Nothing was signed.");
      const provider = getProvider();
      const signer = signerFor(hex);
      const mana = await freeMana(address);
      if (mana.free === 0n) {
        throw new Error(mana.reserved > 0n
          ? "The test wallet's mana is held for its last transaction for a few minutes. Try again shortly, or send it more tKOIN."
          : "The test wallet has no mana. Send it some tKOIN first.");
      }
      const build = async (rcLimit) => {
        const tx = new Transaction({ signer, provider, options: { chainId, payer: address, rcLimit: rcLimit.toString() } });
        for (const op of operations) await tx.pushOperation(op);
        await tx.prepare();
        await tx.sign();
        return tx;
      };
      // 1) Dry run: the node runs it without adding it to a block, and says
      //    how much mana it used. A refusal here shows the contract's reason.
      const dry = await build(mana.free);
      const { receipt: trial } = await provider.sendTransaction(dry.transaction, false);
      if (trial && trial.reverted) return { transactionId: "", receipt: trial };
      // 2) The real one asks for only that much (plus a margin), so the next
      //    action isn't blocked while this one waits for a block.
      const tx = await build(manaLimit(trial.rc_used || "0", mana.free));
      const receipt = await tx.send();
      return { transactionId: tx.transaction.id, receipt: receipt || null };
    },
  };
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
