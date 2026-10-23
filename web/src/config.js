/**
 * The only place network and contract addresses live.
 *
 * Testnet is selected. To point this page at mainnet later:
 *   1. Set ACTIVE to "mainnet".
 *   2. Replace every address in `contracts` with the mainnet contract.
 *      Do not leave a testnet address in the list. Those addresses can
 *      belong to someone else on mainnet.
 *   3. Set paymentSymbol to the token you enabled in the Shop (KOIN, vUSDT, …)
 *      and paymentDecimals to that token's decimals. At startup the page
 *      reads both from the chain (the token's decimals() and the Shop's
 *      get_asset) and shows no prices if they differ from what is set here.
 *
 * No other file needs to change for mainnet. For a custom domain, see
 * SITE.url below.
 *
 * KOIN Vault only signs on mainnet. This page refuses to pair it while
 * ACTIVE is "testnet", because Vault cannot be pointed at the testnet.
 */

import { canonicalBase } from "./lib/site.js";

export const NETWORKS = {
  testnet: {
    id: "testnet",
    name: "Koinos testnet",
    rpc: "https://testnet.koinosfoundation.org",
    chainId: "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==",
    mainnet: false,
  },
  mainnet: {
    id: "mainnet",
    name: "Koinos mainnet",
    rpc: "https://api.koinos.io",
    chainId: "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==",
    mainnet: true,
  },
};

export const ACTIVE = "testnet";

/**
 * The security-fixed contracts, deployed fresh to the Foundation testnet on
 * 19 October 2026 (rehearsal in docs/TESTNET_REHEARSAL.md). Stories was
 * replaced on 20 October 2026 with the moderation release
 * (docs/TESTNET_UPGRADE_MODERATION.md); the previous Stories (15YAvN…) is
 * retired and has no Ink rights. The older, pre-fix copies (195trf…, 1Jfgg…,
 * 1JHak…) are no longer used by this site.
 */
export const TESTNET_ADDRESSES = {
  ink: "1EbuyYK1kso7GbZamHCU2LRhXaEyePkXpf",
  shop: "14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD",
  stories: "1MJz8k1jSgbf1QU9Zdyfip1M7nuXJP3eCZ",
  treasury: "18MhKFHohFqVNpy7m7XvDRqZgLgVspyRF6",
  paymentToken: "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju",
};

export const contracts = {
  ink: TESTNET_ADDRESSES.ink,
  shop: TESTNET_ADDRESSES.shop,
  stories: TESTNET_ADDRESSES.stories,
  treasury: TESTNET_ADDRESSES.treasury,
  paymentToken: TESTNET_ADDRESSES.paymentToken,
  paymentSymbol: "tKOIN",
  paymentDecimals: 8,
};

export const network = NETWORKS[ACTIVE];

const ADDRESS_RE = /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/;

export function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

/** Human-readable problems with the selected config. Empty means usable. */
export function configProblems() {
  const problems = [];
  if (!network) {
    problems.push('ACTIVE must be "testnet" or "mainnet".');
    return problems;
  }
  for (const key of ["ink", "shop", "stories", "treasury", "paymentToken"]) {
    if (!isAddress(contracts[key])) problems.push(key + " is not a Koinos address.");
  }
  if (!Number.isInteger(contracts.paymentDecimals) || contracts.paymentDecimals < 0 || contracts.paymentDecimals > 18) {
    problems.push("paymentDecimals must be a whole number from 0 to 18.");
  }
  try {
    canonicalBase(SITE.url);
  } catch (error) {
    problems.push(error.message);
  }
  if (network.mainnet) {
    for (const key of Object.keys(TESTNET_ADDRESSES)) {
      if (contracts[key] === TESTNET_ADDRESSES[key]) {
        problems.push(key + " is still the testnet address. Replace it before using mainnet.");
      }
    }
  }
  return problems;
}

/** Stop if the node is not the chain this page was configured for. */
export function assertExpectedChain(actual) {
  if (!network) throw new Error('ACTIVE must be "testnet" or "mainnet".');
  if (actual !== network.chainId) {
    throw new Error(
      "This page expected chain id " + network.chainId + " (" + network.name + ") but the node reported " +
        actual + ". Nothing will be signed."
    );
  }
}

/**
 * Site settings that are not contract addresses.
 *
 * url: the ONE address of this site (audit M-7). Every absolute link the page
 * makes starts from it: share links, invite links, and the book address that
 * finishing a story records on chain. It must be https, end with "/", and
 * have no ? or #. The build also puts it in the page as its canonical
 * address.
 *
 * To move the site to its own domain (e.g. swarmtales.example, once bought):
 *   1. At the domain seller, add DNS records for GitHub Pages: for the bare
 *      domain, four A records 185.199.108.153, 185.199.109.153,
 *      185.199.110.153, 185.199.111.153 (and optionally AAAA records
 *      2606:50c0:8000::153 ... 8003::153); for www, a CNAME record pointing
 *      to bawcejawn.github.io.
 *   2. On GitHub: Settings > Pages > Custom domain: type the domain, Save,
 *      wait for the DNS check, then tick "Enforce HTTPS".
 *      (Optional but recommended: verify the domain under your GitHub
 *      account's Settings > Pages, so nobody else can claim it.)
 *   3. Change url below to "https://<your domain>/" and push to main.
 *      The build then also writes a CNAME file with that domain into the
 *      published site (it writes none while url is a github.io address).
 *   4. Check the site opens at the new address, and that a share link on a
 *      story page starts with it. Links made before the move still point to
 *      the github.io address, which GitHub redirects to the new domain.
 * The asset paths are relative ("./"), so the same build works at
 * bawcejawn.github.io/Swarmtales/ and at the root of a custom domain.
 *
 * copyrightEmail: where rights holders send copyright notices. It appears
 * on the "Report copied text" page, and finished books (which can't be
 * reported on chain) point readers there too. Use an address you check (a
 * free one is fine). It must also be the email in the US Copyright Office
 * DMCA agent registration. Leave "" until it exists; the page then says so.
 *
 * adminPowersUrl: the public list of what the admin and moderator keys can
 * and cannot do (docs/ADMIN_POWERS.md), linked from the footer (W1-11).
 */
export const SITE = {
  url: "https://bawcejawn.github.io/Swarmtales/",
  copyrightEmail: "",
  termsPath: "terms/",
  sourceUrl: "https://github.com/bawcejawn/Swarmtales",
  adminPowersUrl: "https://github.com/bawcejawn/Swarmtales/blob/main/docs/ADMIN_POWERS.md",
};
