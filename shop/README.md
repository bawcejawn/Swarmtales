# SwarmTales Shop

This folder is the Shop contract. Ink, the writing allowance, lives in the parent folder. The contract code is still named Shop.

The repository README explains what is built, what is only planned, how to build and test, and how to request testnet coins.

From this folder:

```bash
yarn install
yarn build:debug
yarn test
```

Those commands are the same on Windows PowerShell, Linux, and macOS. Success means `build/debug/contract.wasm` exists and the test report ends with **51 pass** and **0 fail**. Nothing is deployed, and the tests do not need tokens.
