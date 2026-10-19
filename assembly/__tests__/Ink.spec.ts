// =====================================================================
// Storyloom Ink — tests
//
// These run in the Koinos "mock VM" on your own computer. No blockchain,
// wallet or tokens are needed. Run with:  koinos-sdk-as-cli run-tests
//
// Note for readers: AssemblyScript test functions can't use local
// variables from outside the function, so shared values are defined at
// the top of the file and each test builds what it needs.
// =====================================================================

import { Base58, MockVM, authority, chain, Protobuf } from "@koinos/sdk-as";
import { Ink } from "../Ink";
import { ink } from "../proto/ink";

// Fake addresses for testing (25-byte Koinos format).
const CONTRACT_ID = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"); // the Ink contract / deploy key (admin)
const SHOP = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqG");        // Shop contract
const STORIES = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqK");     // Stories contract
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqL");       // a writer
const MALLORY = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqM");     // a stranger / attacker

// Reason bit masks (bit number = reason number).
const SHOP_REASONS: u32 =
  (1 << ink.mint_reason.MINT_PURCHASE) |
  (1 << ink.mint_reason.MINT_MEMBERSHIP) |
  (1 << ink.mint_reason.MINT_STARTER) |
  (1 << ink.mint_reason.MINT_PROMO);
const STORIES_REASONS: u32 = 1 << ink.mint_reason.MINT_REFUND;

// ---------- helpers ----------

function callAs(account: Uint8Array): void {
  MockVM.setCaller(new chain.caller_data(account, chain.privilege.user_mode));
}

function callDirectly(): void {
  // A user transaction calling Ink directly has no calling contract.
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
}

function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([
    new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true),
  ]);
}

// Approve Shop and Stories as minters, and Stories as a burner (as admin).
function setupMintersAndBurners(): void {
  authorize(CONTRACT_ID);
  callDirectly();
  const c = new Ink();
  c.set_minter(new ink.set_minter_arguments(SHOP, SHOP_REASONS));
  c.set_minter(new ink.set_minter_arguments(STORIES, STORIES_REASONS));
  c.set_burner(new ink.set_burner_arguments(STORIES, true));
  MockVM.setAuthorities([]);
}

function balanceOf(account: Uint8Array): u64 {
  return new Ink().balance_of(new ink.balance_of_arguments(account)).value;
}

function supply(): u64 {
  return new Ink().total_supply(new ink.total_supply_arguments()).value;
}

// A failed call rolls the mock chain back to the last checkpoint, and the
// mock forgets the contract id unless it was saved. Call this after the
// setup you want to keep, and before a call you expect to fail.
function checkpoint(): void {
  MockVM.commitTransaction();
}

// ---------- tests ----------

describe("Ink: token details", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
  });

  it("reports name, symbol, decimals and zero starting supply", () => {
    const c = new Ink();
    expect(c.name(new ink.name_arguments()).value).toBe("Storyloom Ink");
    expect(c.symbol(new ink.symbol_arguments()).value).toBe("INK");
    expect(c.decimals(new ink.decimals_arguments()).value).toBe(0);
    expect(c.total_supply(new ink.total_supply_arguments()).value).toBe(0);
    expect(c.balance_of(new ink.balance_of_arguments(ALICE)).value).toBe(0);
  });

  it("starts with the contract's own account as admin, unpaused", () => {
    const cfg = new Ink().get_config(new ink.get_config_arguments());
    expect(Base58.encode(cfg.admin!)).toBe(Base58.encode(CONTRACT_ID));
    expect(cfg.paused).toBe(false);
  });

  it("returns the public token description", () => {
    const info = new Ink().get_info(new ink.get_info_arguments());
    expect(info.name).toBe("Storyloom Ink");
    expect(info.symbol).toBe("INK");
    expect(info.decimals).toBe(0);
    expect(info.description).toBe(
      "Non-transferable writing allowance for Storyloom. 1 INK = 1 character. No cash value. Creative use only."
    );
  });
});

describe("Ink: minting", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
    setupMintersAndBurners();
  });

  it("lets the Shop mint a pack purchase", () => {
    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, 15000, ink.mint_reason.MINT_PURCHASE, "pack:M"));
    expect(balanceOf(ALICE)).toBe(15000);
    expect(supply()).toBe(15000);
  });

  it("records PROMO mints publicly in the event", () => {
    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, 1000, ink.mint_reason.MINT_PROMO, "campaign:1"));

    const events = MockVM.getEvents();
    const last = events[events.length - 1];
    expect(last.name).toBe("ink.mint_event");
    const evt = Protobuf.decode<ink.mint_event>(last.data!, ink.mint_event.decode);
    expect(evt.reason).toBe(ink.mint_reason.MINT_PROMO);
    expect(evt.value).toBe(1000);
    expect(evt.memo).toBe("campaign:1");
    expect(Base58.encode(evt.minter!)).toBe(Base58.encode(SHOP));
  });

  it("lets Stories mint a REFUND", () => {
    callAs(STORIES);
    new Ink().mint(new ink.mint_arguments(ALICE, 250, ink.mint_reason.MINT_REFUND, "story:1:seg:7"));
    expect(balanceOf(ALICE)).toBe(250);
  });

  it("blocks Stories from minting anything except refunds", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(STORIES, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 99999, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
  });

  it("blocks the Shop from minting refunds", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 500, ink.mint_reason.MINT_REFUND, ""));
    }).toThrow();
  });

  it("blocks a stranger contract from minting", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(MALLORY, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(MALLORY, 1000000, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
  });

  it("blocks direct minting, even by the admin", () => {
    expect(() => {
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, CONTRACT_ID, true),
      ]);
      MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 1000, ink.mint_reason.MINT_PROMO, ""));
    }).toThrow();
  });

  it("rejects a zero amount", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 0, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
  });

  it("rejects an unknown reason", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 10, ink.mint_reason.MINT_REASON_UNSPECIFIED, ""));
    }).toThrow();
  });
});

describe("Ink: burning", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
    setupMintersAndBurners();
    // Give Alice 1,000 Ink to work with.
    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, 1000, ink.mint_reason.MINT_PROMO, "campaign:1"));
  });

  it("lets Stories burn Ink for a contribution Alice signed", () => {
    callAs(STORIES);
    authorize(ALICE);
    new Ink().burn(new ink.burn_arguments(ALICE, 342, ink.burn_reason.BURN_CONTRIBUTION, "story:1"));
    expect(balanceOf(ALICE)).toBe(658);
    expect(supply()).toBe(658);

    const events = MockVM.getEvents();
    expect(events[events.length - 1].name).toBe("ink.burn_event");
  });

  it("refuses to burn if Alice did not sign", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(STORIES, chain.privilege.user_mode));
      MockVM.setAuthorities([]);
      new Ink().burn(new ink.burn_arguments(ALICE, 100, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
  });

  it("refuses to burn more Ink than Alice has", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(STORIES, chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 1001, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
  });

  it("refuses a burn from a contract that is not an approved burner", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(MALLORY, chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 100, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
  });

  it("refuses a direct burn call with no Storyloom contract involved", () => {
    expect(() => {
      MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 100, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
  });
});

describe("Ink: admin controls", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
  });

  it("refuses minter changes from a non-admin", () => {
    expect(() => {
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, MALLORY, true),
      ]);
      new Ink().set_minter(new ink.set_minter_arguments(MALLORY, 0b111110));
    }).toThrow();
  });

  it("rejects an invalid reasons mask", () => {
    expect(() => {
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, CONTRACT_ID, true),
      ]);
      new Ink().set_minter(new ink.set_minter_arguments(SHOP, 0b1)); // bit 0 is not a real reason
    }).toThrow();
  });

  it("can remove a minter", () => {
    setupMintersAndBurners();
    authorize(CONTRACT_ID);
    new Ink().set_minter(new ink.set_minter_arguments(SHOP, 0));
    expect(new Ink().get_minter_reasons(new ink.get_minter_reasons_arguments(SHOP)).value).toBe(0);
  });

  it("pause stops minting", () => {
    setupMintersAndBurners();
    authorize(CONTRACT_ID);
    new Ink().set_paused(new ink.set_paused_arguments(true));
    expect(new Ink().get_config(new ink.get_config_arguments()).paused).toBe(true);

    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 10, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
  });

  it("hands admin to a new address; the old admin loses control", () => {
    authorize(CONTRACT_ID);
    new Ink().set_admin(new ink.set_admin_arguments(ALICE));
    expect(Base58.encode(new Ink().get_config(new ink.get_config_arguments()).admin!)).toBe(Base58.encode(ALICE));

    // New admin works.
    authorize(ALICE);
    new Ink().set_burner(new ink.set_burner_arguments(STORIES, true));
    expect(new Ink().is_burner(new ink.is_burner_arguments(STORIES)).value).toBe(true);

    // Old admin no longer works.
    expect(() => {
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, CONTRACT_ID, true),
      ]);
      new Ink().set_paused(new ink.set_paused_arguments(true));
    }).toThrow();
  });
});

// 64 a's, then one more. Memo limit is 64 characters.
const MEMO_64 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MEMO_65 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROMO_ONLY: u32 = 1 << ink.mint_reason.MINT_PROMO;
const ALL_MINT_REASONS: u32 = 0b111110;

describe("Ink: extra mint checks", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
    setupMintersAndBurners();
  });

  it("lets the Shop mint membership and starter Ink, and balances add up", () => {
    callAs(SHOP);
    const c = new Ink();
    c.mint(new ink.mint_arguments(ALICE, 100, ink.mint_reason.MINT_MEMBERSHIP, "month:1"));
    c.mint(new ink.mint_arguments(ALICE, 50, ink.mint_reason.MINT_STARTER, "book:1"));
    c.mint(new ink.mint_arguments(ALICE, 25, ink.mint_reason.MINT_PURCHASE, "pack:S"));
    expect(balanceOf(ALICE)).toBe(175);
    expect(supply()).toBe(175);
  });

  it("accepts a 64 character memo and a missing memo", () => {
    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, 1, ink.mint_reason.MINT_PURCHASE, MEMO_64));
    new Ink().mint(new ink.mint_arguments(ALICE, 1, ink.mint_reason.MINT_PURCHASE, null));
    expect(balanceOf(ALICE)).toBe(2);
  });

  it("rejects a memo longer than 64 characters", () => {
    checkpoint();
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 1, ink.mint_reason.MINT_PURCHASE, MEMO_65));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(0);
  });

  it("rejects a missing or wrong-sized recipient", () => {
    checkpoint();
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(null, 10, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(new Uint8Array(24), 10, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(0);
    expect(supply()).toBe(0);
  });

  it("honors a mask that allows only PROMO", () => {
    authorize(CONTRACT_ID);
    new Ink().set_minter(new ink.set_minter_arguments(SHOP, PROMO_ONLY));
    expect(new Ink().get_minter_reasons(new ink.get_minter_reasons_arguments(SHOP)).value).toBe(PROMO_ONLY);

    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, 5, ink.mint_reason.MINT_PROMO, "campaign:2"));
    expect(balanceOf(ALICE)).toBe(5);
    checkpoint();

    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 5, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(5);
  });

  it("stops minting after the minter is removed, without crediting a failed mint", () => {
    authorize(CONTRACT_ID);
    new Ink().set_minter(new ink.set_minter_arguments(SHOP, 0));
    checkpoint();

    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 80, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(0);
  });

  it("rejects a mint that would overflow the total supply", () => {
    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, u64.MAX_VALUE, ink.mint_reason.MINT_PURCHASE, ""));
    expect(balanceOf(ALICE)).toBe(u64.MAX_VALUE);
    checkpoint();

    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      new Ink().mint(new ink.mint_arguments(ALICE, 1, ink.mint_reason.MINT_PURCHASE, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(u64.MAX_VALUE);
    expect(supply()).toBe(u64.MAX_VALUE);
  });
});

describe("Ink: extra burn checks", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
    setupMintersAndBurners();
    callAs(SHOP);
    new Ink().mint(new ink.mint_arguments(ALICE, 1000, ink.mint_reason.MINT_PROMO, "campaign:1"));
  });

  it("pause stops burning, and unpause allows it again", () => {
    authorize(CONTRACT_ID);
    new Ink().set_paused(new ink.set_paused_arguments(true));
    checkpoint();

    expect(() => {
      MockVM.setCaller(new chain.caller_data(STORIES, chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 10, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(1000);

    authorize(CONTRACT_ID);
    new Ink().set_paused(new ink.set_paused_arguments(false));
    callAs(STORIES);
    authorize(ALICE);
    new Ink().burn(new ink.burn_arguments(ALICE, 10, ink.burn_reason.BURN_CONTRIBUTION, ""));
    expect(balanceOf(ALICE)).toBe(990);
  });

  it("does not let the Shop burn, and does not let the admin burn directly", () => {
    checkpoint();
    expect(() => {
      MockVM.setCaller(new chain.caller_data(SHOP, chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 10, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();

    expect(() => {
      MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, CONTRACT_ID, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 10, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(1000);
  });

  it("rejects a zero burn, a missing reason, and an unknown reason", () => {
    callAs(STORIES);
    authorize(ALICE);
    checkpoint();
    expect(() => {
      new Ink().burn(new ink.burn_arguments(ALICE, 0, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
    expect(() => {
      new Ink().burn(new ink.burn_arguments(ALICE, 1, ink.burn_reason.BURN_REASON_UNSPECIFIED, ""));
    }).toThrow();
    expect(() => {
      new Ink().burn(new ink.burn_arguments(ALICE, 1, <ink.burn_reason>3, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(1000);
  });

  it("records a burn and can use up the whole balance", () => {
    // BURN_OTHER is accepted today. The proto comment calls it reserved.
    callAs(STORIES);
    authorize(ALICE);
    new Ink().burn(new ink.burn_arguments(ALICE, 1000, ink.burn_reason.BURN_OTHER, "future"));
    expect(balanceOf(ALICE)).toBe(0);
    expect(supply()).toBe(0);

    const events = MockVM.getEvents();
    const last = events[events.length - 1];
    expect(last.name).toBe("ink.burn_event");
    const evt = Protobuf.decode<ink.burn_event>(last.data!, ink.burn_event.decode);
    expect(evt.reason).toBe(ink.burn_reason.BURN_OTHER);
    expect(evt.value).toBe(1000);
    expect(evt.memo).toBe("future");
    expect(Base58.encode(evt.burner!)).toBe(Base58.encode(STORIES));
    expect(Base58.encode(evt.from!)).toBe(Base58.encode(ALICE));
  });

  it("rejects a burn for a wrong-sized owner address", () => {
    checkpoint();
    expect(() => {
      MockVM.setCaller(new chain.caller_data(STORIES, chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(new Uint8Array(24), 10, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(1000);
  });

  it("stops burning after the burner is removed", () => {
    authorize(CONTRACT_ID);
    new Ink().set_burner(new ink.set_burner_arguments(STORIES, false));
    expect(new Ink().is_burner(new ink.is_burner_arguments(STORIES)).value).toBe(false);
    expect(new Ink().is_burner(new ink.is_burner_arguments(SHOP)).value).toBe(false);
    checkpoint();

    expect(() => {
      MockVM.setCaller(new chain.caller_data(STORIES, chain.privilege.user_mode));
      MockVM.setAuthorities([
        new MockVM.MockAuthority(authority.authorization_type.contract_call, ALICE, true),
      ]);
      new Ink().burn(new ink.burn_arguments(ALICE, 10, ink.burn_reason.BURN_CONTRIBUTION, ""));
    }).toThrow();
    expect(balanceOf(ALICE)).toBe(1000);
  });
});

describe("Ink: extra admin checks", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
  });

  it("refuses burner, pause, and admin changes from a stranger", () => {
    checkpoint();
    MockVM.setAuthorities([
      new MockVM.MockAuthority(authority.authorization_type.contract_call, MALLORY, true),
    ]);
    expect(() => {
      new Ink().set_burner(new ink.set_burner_arguments(MALLORY, true));
    }).toThrow();
    expect(() => {
      new Ink().set_paused(new ink.set_paused_arguments(true));
    }).toThrow();
    expect(() => {
      new Ink().set_admin(new ink.set_admin_arguments(MALLORY));
    }).toThrow();
    expect(new Ink().get_config(new ink.get_config_arguments()).paused).toBe(false);
    expect(Base58.encode(new Ink().get_config(new ink.get_config_arguments()).admin!)).toBe(Base58.encode(CONTRACT_ID));
  });

  it("does not let anyone claim admin; only the contract address can take the first step", () => {
    checkpoint();
    expect(() => {
      MockVM.setAuthorities([]);
      new Ink().set_admin(new ink.set_admin_arguments(MALLORY));
    }).toThrow();
    expect(Base58.encode(new Ink().get_config(new ink.get_config_arguments()).admin!)).toBe(Base58.encode(CONTRACT_ID));

    authorize(CONTRACT_ID);
    new Ink().set_admin(new ink.set_admin_arguments(ALICE));
    expect(Base58.encode(new Ink().get_config(new ink.get_config_arguments()).admin!)).toBe(Base58.encode(ALICE));
  });

  it("rejects a new admin that is not a 25 byte address", () => {
    authorize(CONTRACT_ID);
    checkpoint();
    expect(() => {
      new Ink().set_admin(new ink.set_admin_arguments(new Uint8Array(24)));
    }).toThrow();
    expect(() => {
      new Ink().set_admin(new ink.set_admin_arguments(null));
    }).toThrow();
    expect(Base58.encode(new Ink().get_config(new ink.get_config_arguments()).admin!)).toBe(Base58.encode(CONTRACT_ID));
  });

  it("rejects reason bits that are not real mint reasons", () => {
    authorize(CONTRACT_ID);
    checkpoint();
    expect(() => {
      new Ink().set_minter(new ink.set_minter_arguments(SHOP, <u32>1 << 6));
    }).toThrow();
    expect(() => {
      new Ink().set_minter(new ink.set_minter_arguments(SHOP, ALL_MINT_REASONS | (<u32>1 << 6)));
    }).toThrow();
    expect(new Ink().get_minter_reasons(new ink.get_minter_reasons_arguments(SHOP)).value).toBe(0);
  });

  it("accepts every real mint reason and publishes the minter event", () => {
    authorize(CONTRACT_ID);
    new Ink().set_minter(new ink.set_minter_arguments(SHOP, ALL_MINT_REASONS));
    expect(new Ink().get_minter_reasons(new ink.get_minter_reasons_arguments(SHOP)).value).toBe(ALL_MINT_REASONS);

    const events = MockVM.getEvents();
    const last = events[events.length - 1];
    expect(last.name).toBe("ink.minter_set_event");
    const evt = Protobuf.decode<ink.minter_set_event>(last.data!, ink.minter_set_event.decode);
    expect(evt.reasons_mask).toBe(ALL_MINT_REASONS);
    expect(Base58.encode(evt.account!)).toBe(Base58.encode(SHOP));
  });

  it("still lets the admin remove a minter while minting is paused", () => {
    setupMintersAndBurners();
    authorize(CONTRACT_ID);
    new Ink().set_paused(new ink.set_paused_arguments(true));
    new Ink().set_minter(new ink.set_minter_arguments(SHOP, 0));
    expect(new Ink().get_minter_reasons(new ink.get_minter_reasons_arguments(SHOP)).value).toBe(0);
    expect(new Ink().get_config(new ink.get_config_arguments()).paused).toBe(true);
  });
});
