/**
 * The only place network and contract addresses live.
 *
 * Testnet is selected. To point this page at mainnet later:
 *   1. Set ACTIVE to "mainnet".
 *   2. Replace every address in `contracts` with the mainnet contract.
 *      Do not leave a testnet address in the list. Those addresses can
 *      belong to someone else on mainnet.
 *   3. Set paymentSymbol to the token you enabled in the Shop (KOIN, vUSDT, …)
 *      and paymentDecimals to that token's decimals.
 *
 * No other file needs to change. Paths stay relative, so a custom domain
 * is a CNAME file added later, not a code change.
 *
 * KOIN Vault only signs on mainnet. This page refuses to pair it while
 * ACTIVE is "testnet", because Vault cannot be pointed at the testnet.
 */

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
 * 19 October 2026 (rehearsal in docs/TESTNET_REHEARSAL.md). The older,
 * pre-fix copies (195trf…, 1Jfgg…, 1JHak…) are no longer used by this site.
 */
export const TESTNET_ADDRESSES = {
  ink: "1EbuyYK1kso7GbZamHCU2LRhXaEyePkXpf",
  shop: "14zbNPeH6Janw4gneuEhieXVmaQBsk8WDD",
  stories: "15YAvNkBACg7PpiEkCYVN95fnajbp1EkwZ",
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
 * copyrightEmail: where rights holders send copyright notices. It appears
 * on the "Report copied text" page. Use an address you check (a free one is
 * fine). It must also be the email in the US Copyright Office DMCA agent
 * registration. Leave "" until it exists; the page then says so.
 */
export const SITE = {
  copyrightEmail: "",
  termsPath: "terms/",
};
