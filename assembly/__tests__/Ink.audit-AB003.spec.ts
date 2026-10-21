// =====================================================================
// Audit Bot attack test for AB-003 / AB-016 (SwarmTales fix check, b002091).
//
// AB-003 was fixed with documents. This test checks what the contract
// actually allows against two claims in them:
//   1. ADMIN_POWERS.md: the Ink admin "cannot move or burn anyone's Ink
//      directly"; strangers cannot appoint minters.            (holds)
//   2. KEY_CUSTODY.md section 6: if the admin key is lost, "the contract
//      key proposes a new admin; the new admin accepts".
// After the two-step handover the contract key is no longer admin, so
// claim 2 needs a code re-upload instead. The second test asserted the
// documented recovery and FAILED on b002091 (the document was wrong).
// AB-025 fix: section 6 now says a lost admin needs a code re-upload with
// the contract key, so the test asserts that the contract key is refused.
// =====================================================================
import { Base58, MockVM, authority, chain } from "@koinos/sdk-as";
import { Ink } from "../Ink";
import { ink } from "../proto/ink";

const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const ADMIN = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");
const NEW_ADMIN = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const EVIL_APP = Base58.decode("112AujjxBp3etKBgsfu9gwcfAxRYM2ve8c");

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function directly(): void { MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode)); }
function undo(): void { MockVM.rollbackTransaction(); MockVM.commitTransaction(); }
function adminOf(): string { return Base58.encode(new Ink().get_config(new ink.get_config_arguments()).admin!); }

function handOver(): void {
  directly();
  authorize(INK);
  new Ink().set_admin(new ink.set_admin_arguments(ADMIN));
  checkpoint();
  authorize(ADMIN);
  new Ink().accept_admin(new ink.accept_admin_arguments());
  checkpoint();
}

describe("AUDIT AB-003: what the Ink keys can really do after the handover", () => {
  beforeEach(() => { MockVM.reset(); MockVM.setContractId(INK); directly(); checkpoint(); });

  it("a stranger, or an app in the admin's name, cannot appoint a minter or accept admin", () => {
    handOver();
    authorize(MALLORY);
    expect(() => { new Ink().set_minter(new ink.set_minter_arguments(MALLORY, 2)); }).toThrow();
    undo();
    authorize(ADMIN);
    MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode));
    expect(() => { new Ink().set_minter(new ink.set_minter_arguments(MALLORY, 2)); }).toThrow();
    undo();
    directly();
    authorize(MALLORY);
    expect(() => { new Ink().accept_admin(new ink.accept_admin_arguments()); }).toThrow();
    undo();
    expect(adminOf()).toBe(Base58.encode(ADMIN));
  });

  it("KEY_CUSTODY.md recovery: with the admin key lost, the contract key alone cannot propose a new admin", () => {
    handOver();
    // The admin key is lost. Section 6 says only a code re-upload with the
    // contract key restores admin: set_admin by the contract key is refused.
    authorize(INK);
    expect(() => { new Ink().set_admin(new ink.set_admin_arguments(NEW_ADMIN)); }).toThrow(
      "AB-025: after a handover the contract key could still propose a new admin; KEY_CUSTODY.md section 6 says it cannot"
    );
    undo();
    expect(adminOf()).toBe(Base58.encode(ADMIN));
  });
});
