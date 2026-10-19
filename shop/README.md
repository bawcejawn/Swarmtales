# SwarmTales Shop

This folder is the Shop contract. Ink, the writing allowance, lives in the parent folder. The contract code is still named Shop.

The repository README explains what the Shop enforces, the mainnet vUSDT and vUSDC addresses, the starting prices, and how to get Koinos testnet KOIN without running a testnet node.

From this folder:

```bash
yarn install
yarn build:debug
yarn test
```

Those commands are the same on Windows PowerShell, Linux, and macOS. Success means `build/debug/contract.wasm` exists and the test report ends with **39 pass** and **0 fail**. Nothing is deployed, and the tests do not need tokens.
