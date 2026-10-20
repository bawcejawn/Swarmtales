# Using the SwarmTales website

This page is a folder of files. There is no SwarmTales server, no database, and no account to create on our side. Your browser talks to the public Koinos node. Your wallet signs. The page never asks for a private key.

Ink is a writing allowance. It is not money. It cannot be sent, sold, or cashed out.

The copy in this repository is pointed at the **Koinos Foundation testnet**. The banner at the top of the page says so. The coins there are play money.

## Run it on your own computer (Windows)

You need [Node.js](https://nodejs.org/) 20 or newer. The install includes `npm`.

1. Open the Start menu, type `cmd`, and open Command Prompt.
2. Go to the project folder. If you cloned it to your user folder, that is:

```bat
cd %USERPROFILE%\Swarmtales\web
```

3. Install the page's libraries once:

```bat
npm.cmd install
```

4. Start the page:

```bat
npm.cmd run dev
```

5. Open the address it prints. It looks like `http://127.0.0.1:4173/`.

If PowerShell says scripts are disabled, use `npm.cmd` as written above. You do not need to change the execution policy for this page.

To check the page without leaving it running:

```bat
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

`npm test` checks the Ink counter and the wallet rules. `npm run build` writes a `dist` folder. `npm run preview` serves that folder. Close the window, or press Ctrl+C, when you are done.

On Linux or macOS the same commands are `npm install`, `npm test`, `npm run build`, and `npm run dev`, from the `web` folder.

## What the pages do

- **Home** shows your address, test KOIN, mana, Ink, and membership after you connect a wallet.
- **Stories** lists stories the chain knows about, including unlisted ones. Open a story to read the text. The text is stored on the chain, in pieces of up to 10 segments per read. A private story's text is still readable by anyone who asks the node. Private only limits who may write.
- **Open a story** opens a Short Story. The page asks the chain what the opening text will cost, then your wallet signs two calls in one transaction: approve the Shop for the price, then open the story.
- **Shop** buys one Writer month. A wallet can claim a promo once, ever. The first month of a new Writer term mints its Ink immediately; later months are claimed with a separate call this first page does not offer yet.
- **Promo link** (`#/promo/<id>?k=…`) and **invite link** (`#/join/<story>/<invite>?k=…`) are opened from a link someone shares. The key after the `#` never reaches a server. The page signs a request naming your wallet, so a copied link cannot be reused for anyone else. `deploy/deploy.js test-promo` prints a ready-made promo link.

The Ink number next to the writing box is the same count the contract uses. A letter costs 1. Most emoji cost 2. ⭐ costs 1. A skin tone or a flag costs 4. A family such as 👨‍👩‍👧 costs 8.

## Wallets

Pick one in **Connect a wallet**.

### Kondor (a computer)

[Kondor](https://chrome.google.com/webstore/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl) is a browser extension. Set it to the same network as the banner (testnet, for this copy). It opens a popup to sign. If it refuses, tick **Use free mana** in that popup. The page cannot tick that box for you.

If the account has under 1 mana, the page still opens Kondor, and it says so. The measured testnet writes use about 0.09 to 0.58 mana. That measurement was made outside this page. This page does not measure mana by signing.

Disconnect only forgets the address in this browser tab. Kondor has no separate "disconnect this site" call.

### KOIN Vault (a phone)

KOIN Vault is the phone wallet at [koinvault.app](https://koinvault.app/). There is no extension. The official connection is the wallet's own free HTTPS address, `https://koinvault.app/api/dapp/`. No account to register, no project id, and no server of ours in the middle.

Checked on 19 October 2026:

- `https://koinvault.app/api/config` answered that the live wallet is version 0.3.0, commit `9670f2c0e07e`, network **mainnet**, `testnet: false`, and that website connections are open.
- The wallet does not offer an injected provider, and it does not offer a way for this page to pick testnet.
- A WalletConnect-style library exists for Koinos, and it asks for a WalletConnect Cloud project id. That id is a free account on someone else's relay. This page does not use it.
- Vault only accepts the pairing page from an **HTTPS** site. A page opened as `http://127.0.0.1` is refused by Vault. That is Vault's rule.
- A pairing lasts 30 minutes from the moment the code is created. Polling does not extend it. The code is drawn on this page. Do not share your screen while it is visible. The session secret stays in this browser tab, not in the address bar.
- Vault builds the transaction. This page cannot choose who pays the mana. SwarmTales is not on Vault's sponsor list, so the connected account pays. Vault's own limit for that case is about **100 mana**, even though a SwarmTales write uses less than 1. If the account is under 100, this page stops before asking Vault to sign and explains that in plain words.
- After you pair, the link that opens the app is `https://koinvault.app/`, not the pairing code.

**This testnet copy will not create a Vault pairing.** Pairing a mainnet wallet against testnet contract addresses could send a real mainnet transaction to whatever lives at those addresses on mainnet. The button stays off and the page explains why. Use Kondor for the testnet.

When `web/src/config.js` is switched to mainnet, and the page is served over HTTPS, and Vault's config still says mainnet, the button will pair. A real phone approval has not been tried from this repository. Carl needs to do that once on a phone.

## GitHub Pages

The workflow `.github/workflows/pages.yml` builds `web/` on every pull request (tests and build only). It publishes only when that workflow runs on the `main` branch.

GitHub will not publish until you flip one setting yourself:

1. Open the repository on GitHub.
2. Settings → Pages → Build and deployment → Source.
3. Choose **GitHub Actions**.

The repository has to stay public. Pages on a public repository is free. The address will be `https://bawcejawn.github.io/Swarmtales/`. Paths in the build are relative, so a custom domain later is a `CNAME` file added at that time. Do not add one yet.

The first publish happens after this is merged to `main` and the setting above is on. If the workflow already ran before the setting was changed, open the Actions tab and run **Pages** again.

## Point the same page at mainnet later

Edit only `web/src/config.js`.

1. Set `ACTIVE` to `"mainnet"`.
2. Replace every address under `contracts` with the mainnet contract. Leave none of the testnet addresses in place. A testnet address can belong to someone else on mainnet, and the page refuses to run if any of them are still there.
3. Set `paymentSymbol` and `paymentDecimals` to the token the Shop actually charges (KOIN, vUSDT, or vUSDC).

No other file needs to change for the addresses. Build again with `npm run build`.

KOIN Vault signs on mainnet only. Kondor must be set to mainnet in the extension. Real tokens are at risk on that network. This code is unaudited.
