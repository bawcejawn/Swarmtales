# SwarmTales multisig wallet

A small contract that turns one fresh Koinos wallet into a **2-of-3** (or m-of-n) wallet. It is
meant to be the admin of the Ink, Shop and Stories contracts, so no single lost or stolen key can
change their settings.

It is uploaded onto a fresh wallet with all three authority flags on (calls, paying for
transactions, code uploads). The upload and `setup` (the first signers) go in **one** transaction,
signed by that wallet's own key, so there's no moment without signers. After setup:

- every call, payment or code upload by the multisig needs `threshold` distinct current signers on
  the transaction (the wallet's own key no longer counts);
- a call counts only when the contract asking for the multisig's authority was called straight from
  the transaction. Contract code running inside a signed transaction (a contract wallet as fee
  payer, or a contract that one of the operations calls) gets nothing (audit H-1);
- `set_signers` changes the signers or threshold with the current quorum **and the signature of
  every signer it adds** (proof they hold the key; audit L-16), and only straight from the
  transaction. With 2 of 3 this replaces a lost or leaked signer;
- 3 to 10 signers, threshold at least 2 and **less than** the number of signers (so one lost key
  never locks the wallet), no duplicates, valid addresses (checksum checked), and the multisig
  can't be its own signer.

What the signatures cover: the signers approve the whole transaction, so every operation in it
and its payer. The multisig doesn't narrow that further; the deploy tool shows every decoded
operation before anyone signs, and refuses a contract wallet as payer for a multisig transaction.

The deploy tool's `--prepare` / `cosign` / `submit` flow collects the signatures.

**Status:** written and tested (23 tests); not yet deployed. The deploy-tool command for the
one-transaction upload + setup and the testnet rehearsal come once the owner has made the signer
wallets.

## Build and test

```bash
npx yarn@1.22.22 install --frozen-lockfile
npx yarn@1.22.22 build:release
npx yarn@1.22.22 test
```

The tests use real secp256k1 signatures from `scripts/make-test-fixtures.js` (test-only keys
derived from public labels; never fund them).

## Known limit

Signatures aren't part of a Koinos transaction id, so whoever relays a transaction could append a
malformed 65-byte signature; if the chain can't recover a key from it, the transaction fails. This can delay a
multisig action but never authorize one. Submit through a trusted node (the deploy tool does).
