// Audit Bot red-team (Impersonator) attack test RT-IMP-NAMES (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack: act in another wallet's name, or get a wallet credited/blamed for someone else's change,
// through the entry points changed on this branch:
//   edit_segment (writer only), revise_part (refuses the writer), set_citation (records the setter),
//   set_reading_place (requireDirectCall), takedown strike naming, set_addresses (Ink once).
// Asserts the SAFE behaviour; expected to PASS (all blocked). Copy into stories/assembly/__tests__/.
import { Base58, MockVM, chain } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, MALLORY, STORIES, INK, SHOP, COPYRIGHT, authorize, checkpoint, configure, directly,
  openPublic, reset, revise, segment, strikes, write, writerMonth, okCall, results, allowCalls,
} from "./auditFixHelpers";
import { reviewedTakedown, ownEditArgs } from "./reviewed";

const EVIL_APP = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");
const OTHER_INK = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const NEW_SHOP = Base58.decode("1N3NuxjKStJwaNXs7im3hkn2f1R2URvcnu");
const BOBS = "Bob's own careful words about the lighthouse keeper.";

let gId: u64 = 0;
let gSeq: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);
let gSigner: Uint8Array = new Uint8Array(0);

function editAs(): void {        // edit_segment naming gWho, signed by gSigner
  authorize(gSigner);
  allowCalls(2);
  const t = "Bob's own careful words about the lighthouse.";
  new Stories().edit_segment(ownEditArgs(gWho, gId, gSeq, t, <u64>t.length));
}
function editViaApp(): void {    // Bob's own signature, but through another contract
  MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode));
  gSigner = BOB; gWho = BOB;
  editAs();
}
function reviseAs(): void {      // revise_part naming gWho, signed by gSigner
  authorize(gSigner);
  results([writerMonth(), okCall(), okCall()]);
  const t = "Bob's own careful words about the keeper's daughter.";
  const price: u64 = 15 * 2;     // whatever: the authority / writer checks come first
  new Stories().revise_part(new stories.revise_part_arguments(gWho, gId, gSeq, t, price, true, 0, "", false));
}
function citeAs(): void {
  authorize(gSigner);
  new Stories().set_citation(new stories.set_citation_arguments(gWho, gId, gSeq, "Mallory says this is quoted"));
}
function placeViaApp(): void {
  MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode));
  authorize(BOB);
  new Stories().set_reading_place(new stories.set_reading_place_arguments(BOB, gId, 1, 1, 50));
}
function placeAs(): void {
  authorize(MALLORY);
  new Stories().set_reading_place(new stories.set_reading_place_arguments(BOB, gId, 1, 1, 50));
}
function strikeNamed(): void {
  authorize(STORIES);
  new Stories().takedown_segment(reviewedTakedown(gId, gSeq, COPYRIGHT, "notice", gWho, false));
}
function setAddr(): void {
  authorize(gSigner);
  new Stories().set_addresses(new stories.set_addresses_arguments(gWho, NEW_SHOP));
}

function refused(fn: () => void, message: string): void {
  expect(fn).toThrow(message);
  MockVM.rollbackTransaction();
  directly();
}

describe("RT-IMP-NAMES: acting in another wallet's name on the changed entry points", () => {
  beforeEach(() => { reset(); configure(); gId = openPublic(); gSeq = write(BOB, gId, BOBS); });

  it("edit_segment: only Bob, signing for himself, directly", () => {
    gWho = BOB; gSigner = MALLORY;
    refused(editAs, "RT-IMP-NAMES: Mallory edited Bob's part in Bob's name");
    gWho = ALICE; gSigner = ALICE;
    refused(editAs, "RT-IMP-NAMES: the opener edited Bob's part for free");
    refused(editViaApp, "RT-IMP-NAMES: an app contract edited Bob's part with Bob's signature");
    expect(segment(gId, gSeq).text!).toBe(BOBS);
    expect(segment(gId, gSeq).version_count).toBe(0);
  });

  it("revise_part: Bob can't 'change' his own part; Mallory can't change it in Cara's name", () => {
    gWho = BOB; gSigner = BOB;
    refused(reviseAs, "RT-IMP-NAMES: the writer used revise_part on his own part");
    gWho = CARA; gSigner = MALLORY;
    refused(reviseAs, "RT-IMP-NAMES: Mallory changed Bob's part in Cara's name");
    expect(segment(gId, gSeq).edited_by_others).toBe(false, "RT-IMP-NAMES: Cara was recorded as a changer");
    expect(segment(gId, gSeq).paid_changes).toBe(0);
  });

  it("set_citation: a stranger can't cite in the opener's name, and isn't recorded as a changer", () => {
    gWho = ALICE; gSigner = MALLORY;
    refused(citeAs, "RT-IMP-NAMES: Mallory set a citation in the opener's name");
    gWho = MALLORY; gSigner = MALLORY;
    refused(citeAs, "RT-IMP-NAMES: a stranger set a citation on Bob's part");
    expect(segment(gId, gSeq).edited_by_others).toBe(false, "RT-IMP-NAMES: a refused citation still recorded a changer");
  });

  it("set_reading_place: no app contract and no stranger saves Bob's place", () => {
    refused(placeViaApp, "RT-IMP-NAMES: an app contract saved a reading place with Bob's signature");
    refused(placeAs, "RT-IMP-NAMES: Mallory saved a reading place in Bob's name");
    const p = new Stories().get_reading_place(new stories.get_reading_place_arguments(BOB, gId));
    expect(p.seq).toBe(0, "RT-IMP-NAMES: Bob's reading place was written by someone else");
  });

  it("takedown: only the writer or a wallet that changed THIS part can be struck", () => {
    const other = write(BOB, gId, "Bob's second part, which Mallory will change.");
    revise(MALLORY, gId, other, "Bob's second part, which Mallory changed a lot.");
    write(CARA, gId, "Cara writes her own part, nothing else.");
    // Part gSeq is untouched: Mallory (changer of another part) and Cara (another writer) are not strikable for it.
    gWho = MALLORY;
    refused(strikeNamed, "RT-IMP-NAMES: Mallory was struck for a part she never changed (she changed another one)");
    gWho = CARA;
    refused(strikeNamed, "RT-IMP-NAMES: Cara was struck for Bob's part");
    gWho = ALICE;
    refused(strikeNamed, "RT-IMP-NAMES: the opener was struck for Bob's part");
    expect(strikes(MALLORY) + strikes(CARA) + strikes(ALICE)).toBe(0);
    // On the changed part: Cara is still not strikable; Mallory is.
    gSeq = other; gWho = CARA;
    refused(strikeNamed, "RT-IMP-NAMES: Cara was struck for a part only Bob and Mallory wrote");
  });

  it("set_addresses: no stranger, no app contract, and the Ink address never changes", () => {
    gWho = INK; gSigner = MALLORY;
    refused(setAddr, "RT-IMP-NAMES: Mallory changed the contract addresses");
    gWho = OTHER_INK; gSigner = STORIES;
    refused(setAddr, "RT-IMP-NAMES: the admin pointed Stories at a second Ink contract");
    const cfg = new Stories().get_config(new stories.get_config_arguments());
    expect(Base58.encode(cfg.ink!)).toBe(Base58.encode(INK));
    expect(Base58.encode(cfg.shop!)).toBe(Base58.encode(SHOP));
  });
});
