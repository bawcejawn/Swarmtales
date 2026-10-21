// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ e5255c6.
// Attack: the Ink address is now set once (AB-037), but the Shop address in
// Stories still changes with the admin key alone (set_addresses, Stories.ts
// ~1614). Stories calls the Shop INSIDE users' own signed transactions:
//   - open_story -> Shop.pay_open_fee (the opener signed),
//   - contribute / edit_segment growth / revise_part -> Shop.get_membership
//     and Shop.get_promo_claimed (every non-privileged writer signed).
// Koinos checks a plain wallet's authority by "is its signature on the
// transaction", whatever contract asks (the reason for rule H1 in the
// Stories header). A Shop the admin swapped in therefore runs with every
// writer's and opener's signature present: it can transfer their KOIN /
// stablecoins (a KCS token that falls back to checkAuthority), mint nothing
// but drain everything, answer "Writer member" for everyone (no revenue),
// or revert every write (DoS). One stolen Stories ADMIN key (not the
// contract key) = a wallet drainer on the next write of every user.
// Claims: Stories header "It never moves stablecoins and holds no money";
// docs/ADMIN_POWERS.md lists "Set the Shop contract address" with no warning.
// Asserts the SAFE behaviour: once wired, the Shop address cannot be
// re-pointed by the admin key alone (set once like Ink, or behind a delay /
// the contract key). FAILS on the current code.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import { INK, SHOP, STORIES, authorize, configure, reset } from "./auditFixHelpers";

// A contract the (thief holding the) Stories admin key uploaded.
const EVIL_SHOP = Base58.decode("1Htyn9WgqXQcxjCWSBtGzX5bUkSWAbocvM") // audit: was "112Au...", which decodes to 24 bytes and was refused as an invalid address;

function repointShop(): void {
  authorize(STORIES);
  new Stories().set_addresses(new stories.set_addresses_arguments(INK, EVIL_SHOP));
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null || a.length != b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] != b[i]) return false;
  return true;
}

describe("RT-INS shop swap: the Stories admin re-points Shop at a drainer", () => {
  beforeEach(() => { reset(); configure(); });

  it("refuses to re-point the Shop that runs inside every writer's signed transaction", () => {
    expect(repointShop).toThrow(
      "RT-INS shopswap: the admin key alone swapped Stories' Shop; the new Shop runs with every opener's and writer's signature");
    MockVM.rollbackTransaction();
    const cfg = new Stories().get_config(new stories.get_config_arguments());
    expect(sameBytes(cfg.shop, SHOP)).toBe(true, "RT-INS shopswap: Stories now calls a Shop nobody reviewed");
  });
});
