// =====================================================================
// Red-team (Impersonator) attack tests, SwarmTales fix check @ 00eec36.
// AB-053 stopped the opener from undoing an ADMIN hide (hidden_by 3). The
// same move still works against the copy checker's (moderator's) hide: the
// writer who is also the story's opener, or whom the opener made an
// editor, acts as their own moderator.
//
// Attack 1 (opener = writer): Alice opens a story and writes a copied part.
//   The checker hides it with the moderator key (set_segment_hidden,
//   hidden_by 2). Alice calls restore_segment (allowed: hidden_by != 3),
//   then remove_segment: refundable() sees hidden == false, so she gets the
//   full Ink back. docs/ADMIN_POWERS.md: "Removing a part the admin or the
//   checker hid refunds nothing." (Also: restore sets seg.restored, and the
//   checker never hides a restored part again, so she may simply keep it.)
// Attack 2 (editor = writer): Bob writes the copied part in Alice's story;
//   Alice makes Bob an editor (set_editor). Bob restores his own
//   checker-hidden part and removes it for a full refund.
//
// Each test asserts the SAFE behaviour and FAILS while the attack works.
// If the fix is "restore_segment refuses a writer restoring their own
// part", wrap the restore call in expect(...).toThrow + rollbackTransaction
// (as Stories.audit-rt-ins-restore.spec.ts does); the refund checks stay.
// Copy into stories/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM, Storage } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, COPYRIGHT, STORIES, allowCalls, authorize, checkpoint, configure, mintsTo, openPublic, reset, segment, write,
} from "./auditFixHelpers";

const SEGMENTS_SPACE_ID: u32 = 3;
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt"); // moderator (copy checker)
const COPIED = "A page copied word for word from somebody else's novel.";

// AssemblyScript has no closures: values for the expect() callbacks live here.
let gId: u64 = 0;
let gSeq: u64 = 0;

function u64Key(value: u64): Uint8Array {
  const key = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    key[i] = <u8>(v & 0xff);
    v = v >> 8;
  }
  return key;
}
function pairKey(a: u64, b: u64): Uint8Array {
  const out = new Uint8Array(16);
  const ka = u64Key(a);
  const kb = u64Key(b);
  for (let i = 0; i < 8; i++) { out[i] = ka[i]; out[8 + i] = kb[i]; }
  return out;
}

function aliceWrites(id: u64, text: string): u64 {
  authorize(ALICE);
  allowCalls(1);
  const seq = new Stories().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, 0)).value;
  checkpoint();
  return seq;
}
function hideAs(actor: Uint8Array): void {
  authorize(actor);
  new Stories().set_segment_hidden(new stories.set_segment_hidden_arguments(actor, gId, gSeq, true, COPYRIGHT, "copied text: 5 of 5 phrases found"));
  checkpoint();
}
function restoreAs(actor: Uint8Array): void {
  authorize(actor);
  new Stories().restore_segment(new stories.restore_segment_arguments(actor, gId, gSeq, "it's fine"));
  checkpoint();
}
function removeAs(actor: Uint8Array): void {
  authorize(actor);
  allowCalls(1);
  new Stories().remove_segment(new stories.remove_segment_arguments(actor, gId, gSeq));
  checkpoint();
}
function aliceRestores(): void {
  authorize(ALICE);
  new Stories().restore_segment(new stories.restore_segment_arguments(ALICE, gId, gSeq, "it's fine"));
}

describe("RT-IMP modrestore: the writer acts as their own moderator", () => {
  beforeEach(() => {
    reset(); configure();
    authorize(STORIES);
    new Stories().set_moderation(new stories.set_moderation_arguments(BOT, 3, 5));
    checkpoint();
    gId = openPublic();
  });

  it("a writer-opener gets no refund for a part the checker hid by restoring it first", () => {
    gSeq = aliceWrites(gId, COPIED);
    hideAs(BOT);
    expect(segment(gId, gSeq).hidden_by).toBe(2, "harness: the moderator hid the part");
    const before = mintsTo(ALICE);
    restoreAs(ALICE);
    removeAs(ALICE);
    expect(mintsTo(ALICE) - before).toBe(0,
      "RT-IMP modrestore 1: Alice undid the checker's hide on her own part and removed it for a full refund");
  });

  it("a writer the opener made an editor gets no refund for their own checker-hidden part", () => {
    authorize(ALICE);
    new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, BOB, true));
    checkpoint();
    gSeq = write(BOB, gId, COPIED);
    hideAs(BOT);
    const before = mintsTo(BOB);
    restoreAs(BOB);
    removeAs(BOB);
    expect(mintsTo(BOB) - before).toBe(0,
      "RT-IMP modrestore 2: editor Bob undid the checker's hide on his own part and removed it for a full refund");
  });
});
