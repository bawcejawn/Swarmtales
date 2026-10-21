// =====================================================================
// Stories — moderation tests (October 2026)
//
//   - Every new part needs the "I wrote this" confirmation and the current
//     Terms of Use version; a wallet's accepted version is recorded.
//   - The same exact text cannot go into one story twice.
//   - Admin or moderator may hide/unhide at any stage; hidden parts block
//     finalizing and are not refunded when removed (a part hidden by
//     writer reports alone is: see Stories.funds.spec.ts, AB-012).
//   - Admin alone may take a part down for good, at any stage, without a
//     refund. Locked stories reopen; finalized stories need a new PDF.
//   - Reports: once per wallet per part; only writers count; enough of
//     them hide the part automatically.
//   - Every action is a public event.
// =====================================================================

import { Base58, MockVM, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";

const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");   // opener
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");     // writer
const CAROL = Base58.decode("1GG3wjVP4fCkDBsdeK95LCBfDhNhGigZm3");   // writer
const DAVE = Base58.decode("13ZhCsVeBFFm5jbHRynyrR2AjULxUUtwfd");    // writer
const READER = Base58.decode("17tbkL7b9mGGQeYszdDqpZFWxYSh6R3zs3");  // has never written
const BOT = Base58.decode("1KTTsD354hZMEuZkYvVoEevDV6xuPaoEtt");     // moderator key
const EVIL_APP = Base58.decode("112AujjxBp3etKBgsfu9gwcfAxRYM2ve8c");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const MINT_ENTRY: u32 = 3698268091;
const SHORT = stories.story_kind.KIND_SHORT;
const PUBLIC = stories.visibility.VISIBILITY_PUBLIC;
const COPYRIGHT = stories.moderation_reason.REASON_COPYRIGHT;
const SPAM = stories.moderation_reason.REASON_SPAM;
const NO_REASON = stories.moderation_reason.REASON_UNSPECIFIED;
const DIRECT_ONLY = "STORIES: call SwarmTales directly from your wallet, not through another contract";

// ---------- helpers ----------

let FILL_COUNTER: i32 = 0;
function chars(n: i32): string {
  FILL_COUNTER++;
  let tag = "";
  let c = FILL_COUNTER;
  while (c > 0) {
    tag += String.fromCharCode(98 + c % 25);
    c = c / 25;
  }
  if (tag.length >= n) return tag.substring(0, n);
  return tag + "a".repeat(n - tag.length);
}

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function directly(): void { MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode)); }
function viaOtherContract(): void { MockVM.setCaller(new chain.caller_data(EVIL_APP, chain.privilege.user_mode)); }
function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  MockVM.setCallContractResults(list);
}
function writerAnswer(): system_calls.exit_arguments {
  const m = new stories.shop_membership(2, START + 365 * DAY, 0, 0, 0);
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(m, stories.shop_membership.encode)));
}
function c(): Stories { return new Stories(); }
function story(id: u64): stories.story { return c().get_story(new stories.get_story_arguments(id)); }
function seg(id: u64, seq: u64): stories.segment { return c().get_segment(new stories.get_segment_arguments(id, seq)); }
function cfg(): stories.config { return c().get_config(new stories.get_config_arguments()); }

function fails(fn: () => void, message: string): void {
  expect(fn).toThrow();
  const got = MockVM.getErrorMessage();
  expect(got != null ? got! : "").toBe(message);
  MockVM.rollbackTransaction();
  MockVM.commitTransaction();
}

function countEvents(name: string): i32 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let n = 0;
  for (let i = 0; i < events.length; i++) if (events[i].name == name) n++;
  return n;
}

function mints(): i32 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let n = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "stories.external_call_event") continue;
    const ev = Protobuf.decode<stories.external_call_event>(events[i].data!, stories.external_call_event.decode);
    if (ev.entry_point == MINT_ENTRY) n++;
  }
  return n;
}

function lastModeration(): stories.moderation_event {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].name == "stories.moderation_event") {
      return Protobuf.decode<stories.moderation_event>(events[i].data!, stories.moderation_event.decode);
    }
  }
  return new stories.moderation_event();
}

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(STORIES);
  setTime(START);
  directly();
  checkpoint();
  authorize(STORIES);
  c().set_addresses(new stories.set_addresses_arguments(INK, SHOP));
  c().add_category(new stories.add_category_arguments("Fantasy"));
  // Written for the original 2,000 per-part cap.
  c().set_limits(new stories.set_limits_arguments(2000, 1000, 3, 60, 30));
  checkpoint();
}

function open(text: string): u64 {
  directly(); authorize(ALICE); allowCalls(2);
  const id = c().open_story(new stories.open_story_arguments(
    ALICE, SHORT, "My Tale", 10000, 1, 0, PUBLIC, 0, 0, text, false, <u64>text.length, USDT, true, cfg().terms_version
  )).value;
  checkpoint();
  return id;
}

function openerWrites(id: u64, text: string): u64 {
  directly(); authorize(ALICE); allowCalls(1);
  const seq = c().contribute(new stories.contribute_arguments(ALICE, id, text, false, false, <u64>text.length, true, cfg().terms_version)).value;
  checkpoint();
  return seq;
}

function writerWrites(who: Uint8Array, id: u64, text: string): u64 {
  directly(); authorize(who);
  MockVM.setCallContractResults([writerAnswer(), okCall()]);
  const seq = c().contribute(new stories.contribute_arguments(who, id, text, false, false, <u64>text.length, true, cfg().terms_version)).value;
  checkpoint();
  return seq;
}

function setModerator(): void {
  directly(); authorize(STORIES);
  c().set_moderation(new stories.set_moderation_arguments(BOT, 3, 3));
  checkpoint();
}

function hide(by: Uint8Array, id: u64, seq: u64, hidden: bool): void {
  directly(); authorize(by);
  c().set_segment_hidden(new stories.set_segment_hidden_arguments(by, id, seq, hidden, hidden ? COPYRIGHT : NO_REASON, "matched a known book"));
  checkpoint();
}

function report(who: Uint8Array, id: u64, seq: u64): void {
  directly(); authorize(who);
  c().report_segment(new stories.report_segment_arguments(who, id, seq, COPYRIGHT, "looks copied"));
  checkpoint();
}

function takedown(id: u64, seq: u64): void {
  directly(); authorize(STORIES);
  c().takedown_segment(new stories.takedown_segment_arguments(id, seq, COPYRIGHT, "notice 2026-001"));
  checkpoint();
}

function keep(seq: u64): stories.final_item { return new stories.final_item(seq, stories.final_mode.FINAL_UNCHANGED, "", 0); }
function drop(seq: u64): stories.final_item { return new stories.final_item(seq, stories.final_mode.FINAL_REMOVED, "", 0); }

function pdfHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(i + 1);
  return h;
}

function termsHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = <u8>(200 - i);
  return h;
}

// Opening (28) + 4 x 2,000 + 1,972 = 10,000: story locks.
function fillAndLock(id: u64): void {
  for (let i = 0; i < 4; i++) openerWrites(id, chars(2000));
  openerWrites(id, chars(1972));
}

function closeStory(id: u64): void {
  directly(); authorize(ALICE); allowCalls(1);
  c().close_story(new stories.close_story_arguments(ALICE, id, USDT));
  checkpoint();
}

function batch(id: u64, items: stories.final_item[]): void {
  directly(); authorize(ALICE); allowCalls(items.length);
  c().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, id, items));
  checkpoint();
}

function finalize(id: u64): void {
  directly(); authorize(ALICE);
  c().finalize(new stories.finalize_arguments(ALICE, id, "ipfs://book", pdfHash()));
  checkpoint();
}

const OPENING = "A lantern swung in the dark.";   // 28 characters

// ---------- rights confirmation and Terms of Use ----------

describe("Moderation: rights confirmation and Terms of Use", () => {
  beforeEach(() => { reset(); });

  it("refuses a part or an opening without the 'I wrote this' confirmation", () => {
    fails(() => {
      authorize(ALICE); allowCalls(2);
      c().open_story(new stories.open_story_arguments(ALICE, SHORT, "Tale", 10000, 1, 0, PUBLIC, 0, 0, OPENING, false, 28, USDT, false, 0));
    }, "STORIES: confirm that you wrote this text or have the right to use it");
    open(OPENING);
    fails(() => {
      authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, "The second sentence of it.", false, false, 26, false, 0));
    }, "STORIES: confirm that you wrote this text or have the right to use it");
    expect(seg(1, 1).rights_confirmed).toBe(true);
  });

  it("lets only the admin publish terms, with a higher version, a 32-byte hash and a link", () => {
    fails(() => { authorize(BOB); c().set_terms(new stories.set_terms_arguments(1, termsHash(), "https://x/terms")); }, "STORIES: admin authority required");
    fails(() => { authorize(STORIES); c().set_terms(new stories.set_terms_arguments(0, termsHash(), "https://x/terms")); },
      "STORIES: a new Terms of Use version must be higher than the current one");
    fails(() => { authorize(STORIES); c().set_terms(new stories.set_terms_arguments(1, new Uint8Array(31), "https://x/terms")); },
      "STORIES: Terms of Use hash must be 32 bytes");
    fails(() => { authorize(STORIES); c().set_terms(new stories.set_terms_arguments(1, termsHash(), "")); },
      "STORIES: Terms of Use link must be 1 to 200 plain characters");
    fails(() => { viaOtherContract(); authorize(STORIES); c().set_terms(new stories.set_terms_arguments(1, termsHash(), "https://x/terms")); }, DIRECT_ONLY);
    directly(); authorize(STORIES);
    c().set_terms(new stories.set_terms_arguments(1, termsHash(), "https://x/terms"));
    checkpoint();
    expect(cfg().terms_version).toBe(1);
    expect(cfg().terms_uri).toBe("https://x/terms");
    expect(countEvents("stories.terms_event")).toBe(1);
  });

  it("requires the current terms version and records each wallet's latest acceptance once", () => {
    directly(); authorize(STORIES);
    c().set_terms(new stories.set_terms_arguments(1, termsHash(), "https://x/terms"));
    checkpoint();
    fails(() => {
      authorize(ALICE); allowCalls(2);
      c().open_story(new stories.open_story_arguments(ALICE, SHORT, "Tale", 10000, 1, 0, PUBLIC, 0, 0, OPENING, false, 28, USDT, true, 0));
    }, "STORIES: the Terms of Use have changed; reload the page and accept the current version");
    open(OPENING);
    openerWrites(1, "The second sentence of it.");
    expect(c().get_terms_accepted(new stories.get_terms_accepted_arguments(ALICE)).value).toBe(1);
    expect(seg(1, 2).terms_version).toBe(1);
    // One acceptance event for Alice, not one per part.
    expect(countEvents("stories.terms_accepted_event")).toBe(1);

    directly(); authorize(STORIES);
    c().set_terms(new stories.set_terms_arguments(2, termsHash(), "https://x/terms-v2"));
    checkpoint();
    fails(() => {
      authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, "A third sentence of it all.", false, false, 27, true, 1));
    }, "STORIES: the Terms of Use have changed; reload the page and accept the current version");
    openerWrites(1, "A third sentence of it all.");
    expect(c().get_terms_accepted(new stories.get_terms_accepted_arguments(ALICE)).value).toBe(2);
  });
});

// ---------- duplicate text ----------

describe("Moderation: the same exact text cannot go into one story twice", () => {
  beforeEach(() => { reset(); });

  it("refuses a repeat in the same story but allows it in another story", () => {
    open(OPENING);
    const line = "Everyone in the village heard it.";
    openerWrites(1, line);
    fails(() => {
      authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, line, false, false, <u64>line.length, true, 0));
    }, "STORIES: this exact text is already in this story");
    fails(() => {
      authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, OPENING, false, false, 28, true, 0));
    }, "STORIES: this exact text is already in this story");
    open("A different story opens here today.");
    openerWrites(2, line);
    expect(story(2).segment_count).toBe(2);
  });

  it("still refuses re-posting text that was removed", () => {
    open(OPENING);
    const line = "This line will be removed later on.";
    openerWrites(1, line);
    directly(); authorize(ALICE); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    checkpoint();
    fails(() => {
      authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, line, false, false, <u64>line.length, true, 0));
    }, "STORIES: this exact text is already in this story");
  });
});

// ---------- hide and unhide ----------

describe("Moderation: hide and unhide", () => {
  beforeEach(() => { reset(); });

  it("lets only the admin set the moderator and a threshold of 1 to 20", () => {
    fails(() => { authorize(BOB); c().set_moderation(new stories.set_moderation_arguments(BOT, 3, 3)); }, "STORIES: admin authority required");
    fails(() => { authorize(STORIES); c().set_moderation(new stories.set_moderation_arguments(BOT, 0, 3)); }, "STORIES: report threshold must be 1 to 20");
    fails(() => { authorize(STORIES); c().set_moderation(new stories.set_moderation_arguments(BOT, 21, 3)); }, "STORIES: report threshold must be 1 to 20");
    fails(() => { authorize(STORIES); c().set_moderation(new stories.set_moderation_arguments(STORIES, 3, 3)); }, "STORIES: the moderator cannot be the Stories contract");
    setModerator();
    expect(Base58.encode(cfg().moderator!)).toBe(Base58.encode(BOT));
    expect(cfg().report_threshold).toBe(3);
    // Empty turns the moderator off.
    directly(); authorize(STORIES);
    c().set_moderation(new stories.set_moderation_arguments(new Uint8Array(0), 3, 3));
    checkpoint();
    expect(cfg().moderator!.length).toBe(0);
  });

  it("lets the moderator and the admin hide and unhide, at any stage, with a public event", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob adds a sentence of his own.");
    setModerator();
    hide(BOT, 1, 2, true);
    expect(seg(1, 2).hidden).toBe(true);
    expect(seg(1, 2).moderation_reason).toBe(COPYRIGHT);
    expect(story(1).hidden_count).toBe(1);
    const ev = lastModeration();
    expect(ev.action).toBe(stories.moderation_action.ACTION_HIDE);
    expect(Base58.encode(ev.by!)).toBe(Base58.encode(BOT));
    expect(Base58.encode(ev.author!)).toBe(Base58.encode(BOB));
    expect(ev.note).toBe("matched a known book");
    hide(STORIES, 1, 2, false);
    expect(seg(1, 2).hidden).toBe(false);
    expect(story(1).hidden_count).toBe(0);
    expect(lastModeration().action).toBe(stories.moderation_action.ACTION_UNHIDE);
  });

  it("refuses hiding by anyone else, through another contract, twice, or without a reason", () => {
    open(OPENING);
    setModerator();
    fails(() => {
      authorize(BOB);
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(BOB, 1, 1, true, COPYRIGHT, ""));
    }, "STORIES: only the admin or the moderator may do this");
    fails(() => {
      authorize(ALICE); // the opener is not a moderator
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(ALICE, 1, 1, true, COPYRIGHT, ""));
    }, "STORIES: only the admin or the moderator may do this");
    fails(() => {
      authorize(BOB); // BOT not signing
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, 1, 1, true, COPYRIGHT, ""));
    }, "STORIES: moderator has not authorized this");
    fails(() => {
      viaOtherContract(); authorize(BOT);
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, 1, 1, true, COPYRIGHT, ""));
    }, DIRECT_ONLY);
    fails(() => {
      directly(); authorize(BOT);
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, 1, 1, true, NO_REASON, ""));
    }, "STORIES: give a reason");
    hide(BOT, 1, 1, true);
    fails(() => {
      directly(); authorize(BOT);
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, 1, 1, true, COPYRIGHT, ""));
    }, "STORIES: part is already hidden");
  });

  it("refuses a note longer than 200 characters", () => {
    open(OPENING);
    setModerator();
    fails(() => {
      directly(); authorize(BOT);
      c().set_segment_hidden(new stories.set_segment_hidden_arguments(BOT, 1, 1, true, COPYRIGHT, "x".repeat(201)));
    }, "STORIES: note must be at most 200 characters");
  });

  it("works while Stories is paused, so moderation never waits", () => {
    open(OPENING);
    setModerator();
    directly(); authorize(STORIES);
    c().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    hide(BOT, 1, 1, true);
    expect(seg(1, 1).hidden).toBe(true);
  });

  it("never refunds a hidden part that an editor removes", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob adds a sentence of his own.");
    setModerator();
    hide(BOT, 1, 2, true);
    const before = mints();
    directly(); authorize(ALICE); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    checkpoint();
    expect(mints()).toBe(before);
    expect(story(1).hidden_count).toBe(0);
    expect(story(1).total_refunded).toBe(0);
  });
});

// ---------- finishing gate ----------

describe("Moderation: hidden parts block finishing a story", () => {
  beforeEach(() => { reset(); });

  it("only lets the final edit remove a hidden part, with no refund, and refuses to finalize while any part is hidden", () => {
    open(OPENING);         // seq 1
    fillAndLock(1);        // seq 2..6
    setModerator();
    hide(BOT, 1, 3, true);
    closeStory(1);
    fails(() => {
      authorize(ALICE); allowCalls(3);
      c().submit_final_batch(new stories.submit_final_batch_arguments(ALICE, 1, [keep(1), keep(2), keep(3)]));
    }, "STORIES: a hidden part can only be removed in the final edit (or unhidden first)");
    const before = mints();
    batch(1, [keep(1), keep(2), drop(3), keep(4), keep(5), keep(6)]);
    expect(mints()).toBe(before);   // no refund for the hidden part
    expect(story(1).hidden_count).toBe(0);
    finalize(1);
    expect(story(1).status).toBe(stories.story_status.STATUS_FINALIZED);
  });

  it("refuses to finalize until a hidden part is unhidden", () => {
    open(OPENING);
    fillAndLock(1);
    closeStory(1);
    batch(1, [keep(1), keep(2), keep(3), keep(4), keep(5), keep(6)]);
    setModerator();
    hide(BOT, 1, 2, true);   // the checker flags it at the last moment
    fails(() => {
      authorize(ALICE);
      c().finalize(new stories.finalize_arguments(ALICE, 1, "ipfs://book", pdfHash()));
    }, "STORIES: some parts are hidden while they are checked; unhide or remove them first");
    hide(BOT, 1, 2, false);
    finalize(1);
    expect(story(1).status).toBe(stories.story_status.STATUS_FINALIZED);
  });
});

// ---------- takedown ----------

describe("Moderation: admin takedown", () => {
  beforeEach(() => { reset(); });

  it("clears an open story's part for good, without a refund, and records it", () => {
    open(OPENING);
    const line = "Bob pastes a paragraph from a novel.";
    writerWrites(BOB, 1, line);
    const usedBefore = story(1).used_chars;
    const before = mints();
    takedown(1, 2);
    const s = seg(1, 2);
    expect(s.taken_down).toBe(true);
    expect(s.status).toBe(stories.segment_status.SEGMENT_REMOVED);
    expect(s.text).toBe("");
    expect(s.moderation_reason).toBe(COPYRIGHT);
    expect(mints()).toBe(before);
    expect(story(1).used_chars).toBe(usedBefore - <u64>line.length);
    expect(story(1).total_refunded).toBe(0);
    expect(c().get_contributor_total(new stories.get_contributor_total_arguments(1, BOB)).value).toBe(0);
    const ev = lastModeration();
    expect(ev.action).toBe(stories.moderation_action.ACTION_TAKEDOWN);
    expect(ev.note).toBe("notice 2026-001");
    expect(ev.text_hash!.length).toBe(32);
  });

  it("is admin-only, direct-only, needs a reason, and happens once", () => {
    open(OPENING);
    setModerator();
    fails(() => { authorize(BOT); c().takedown_segment(new stories.takedown_segment_arguments(1, 1, COPYRIGHT, "")); }, "STORIES: admin authority required");
    fails(() => { authorize(ALICE); c().takedown_segment(new stories.takedown_segment_arguments(1, 1, COPYRIGHT, "")); }, "STORIES: admin authority required");
    fails(() => { viaOtherContract(); authorize(STORIES); c().takedown_segment(new stories.takedown_segment_arguments(1, 1, COPYRIGHT, "")); }, DIRECT_ONLY);
    fails(() => { directly(); authorize(STORIES); c().takedown_segment(new stories.takedown_segment_arguments(1, 1, NO_REASON, "")); }, "STORIES: give a reason");
    fails(() => { directly(); authorize(STORIES); c().takedown_segment(new stories.takedown_segment_arguments(1, 9, COPYRIGHT, "")); }, "STORIES: unknown segment");
    takedown(1, 1);
    fails(() => { directly(); authorize(STORIES); c().takedown_segment(new stories.takedown_segment_arguments(1, 1, COPYRIGHT, "")); }, "STORIES: part was already taken down");
  });

  it("reopens a locked story when a takedown frees space", () => {
    open(OPENING);
    fillAndLock(1);
    expect(story(1).status).toBe(stories.story_status.STATUS_LOCKED);
    takedown(1, 3);
    expect(story(1).status).toBe(stories.story_status.STATUS_OPEN);
    expect(story(1).used_chars).toBe(8000);
  });

  it("works on a finalized story: credits drop and a new PDF is needed", () => {
    open(OPENING);
    fillAndLock(1);
    closeStory(1);
    batch(1, [keep(1), keep(2), keep(3), keep(4), keep(5), keep(6)]);
    finalize(1);
    const survBefore = c().get_surviving_total(new stories.get_surviving_total_arguments(1, ALICE)).value;
    takedown(1, 2);
    expect(c().get_surviving_total(new stories.get_surviving_total_arguments(1, ALICE)).value).toBe(survBefore - 2000);
    expect(seg(1, 2).final_mode).toBe(stories.final_mode.FINAL_REMOVED);
    expect(story(1).needs_new_pdf).toBe(true);
    expect(story(1).status).toBe(stories.story_status.STATUS_FINALIZED);

    fails(() => { authorize(ALICE); c().replace_pdf(new stories.replace_pdf_arguments(1, "ipfs://book2", pdfHash())); }, "STORIES: admin authority required");
    directly(); authorize(STORIES);
    c().replace_pdf(new stories.replace_pdf_arguments(1, "ipfs://book2", pdfHash()));
    checkpoint();
    expect(story(1).pdf_uri).toBe("ipfs://book2");
    expect(story(1).needs_new_pdf).toBe(false);
    fails(() => { directly(); authorize(STORIES); c().replace_pdf(new stories.replace_pdf_arguments(1, "ipfs://book3", pdfHash())); },
      "STORIES: this story does not need a new PDF");
  });

  it("during the final edit, a not-yet-processed part is simply skipped", () => {
    open(OPENING);
    fillAndLock(1);
    closeStory(1);
    batch(1, [keep(1), keep(2)]);
    takedown(1, 4);
    batch(1, [keep(3), keep(5), keep(6)]);   // 4 is folded in automatically
    finalize(1);
    expect(story(1).status).toBe(stories.story_status.STATUS_FINALIZED);
    expect(seg(1, 4).final_mode).toBe(stories.final_mode.FINAL_REMOVED);
  });

  it("removes a hidden part's hold on finishing", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob adds a sentence of his own.");
    setModerator();
    hide(BOT, 1, 2, true);
    takedown(1, 2);
    expect(story(1).hidden_count).toBe(0);
    expect(seg(1, 2).hidden).toBe(false);
  });
});

// ---------- reports ----------

describe("Moderation: reports", () => {
  beforeEach(() => { reset(); });

  it("hides a part after 3 reports from wallets that have written, and logs every report", () => {
    open(OPENING);                                            // Alice: seq 1
    writerWrites(BOB, 1, "Bob writes a line of his own here.");     // seq 2
    writerWrites(CAROL, 1, "Carol answers with her own line now.");  // seq 3
    writerWrites(DAVE, 1, "Dave pastes a page from some novel.");    // seq 4
    report(READER, 1, 4);   // logged, but has never written: does not count
    expect(seg(1, 4).report_count).toBe(0);
    report(BOB, 1, 4);
    report(CAROL, 1, 4);
    expect(seg(1, 4).hidden).toBe(false);
    report(ALICE, 1, 4);
    expect(seg(1, 4).report_count).toBe(3);
    expect(seg(1, 4).hidden).toBe(true);
    expect(story(1).hidden_count).toBe(1);
    expect(countEvents("stories.report_event")).toBe(4);
    expect(lastModeration().action).toBe(stories.moderation_action.ACTION_REPORT_HIDE);
    expect(c().has_reported(new stories.has_reported_arguments(1, 4, BOB)).value).toBe(true);
  });

  it("refuses reporting your own part, twice, without a reason, or a hidden part", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a line of his own here.");
    fails(() => { directly(); authorize(BOB); c().report_segment(new stories.report_segment_arguments(BOB, 1, 2, SPAM, "")); },
      "STORIES: you cannot report your own part");
    fails(() => { directly(); authorize(ALICE); c().report_segment(new stories.report_segment_arguments(ALICE, 1, 2, NO_REASON, "")); },
      "STORIES: give a reason");
    fails(() => { directly(); authorize(READER); c().report_segment(new stories.report_segment_arguments(ALICE, 1, 2, SPAM, "")); },
      "STORIES: reporter has not authorized this");
    fails(() => { viaOtherContract(); authorize(ALICE); c().report_segment(new stories.report_segment_arguments(ALICE, 1, 2, SPAM, "")); }, DIRECT_ONLY);
    report(ALICE, 1, 2);
    fails(() => { directly(); authorize(ALICE); c().report_segment(new stories.report_segment_arguments(ALICE, 1, 2, SPAM, "")); },
      "STORIES: you already reported this part");
    setModerator();
    hide(BOT, 1, 2, true);
    fails(() => { directly(); authorize(READER); c().report_segment(new stories.report_segment_arguments(READER, 1, 2, SPAM, "")); },
      "STORIES: this part is already hidden while it is checked");
  });

  it("needs new reports after the moderator unhides a part", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a line of his own here.");
    writerWrites(CAROL, 1, "Carol answers with her own line now.");
    writerWrites(DAVE, 1, "Dave writes an honest line as well.");
    setModerator();
    directly(); authorize(STORIES);
    c().set_moderation(new stories.set_moderation_arguments(BOT, 2, 3));
    checkpoint();
    report(BOB, 1, 4);
    report(CAROL, 1, 4);
    expect(seg(1, 4).hidden).toBe(true);
    hide(BOT, 1, 4, false);   // the checker found nothing
    expect(seg(1, 4).report_count).toBe(0);
    report(ALICE, 1, 4);
    expect(seg(1, 4).hidden).toBe(false);
  });
});

// ---------- repeat-infringer policy ----------

describe("Moderation: strikes and blocking", () => {
  beforeEach(() => { reset(); });

  it("blocks a wallet automatically at the fifth takedown (the default limit), and logs it", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob pastes page one of a novel here.");     // 2
    writerWrites(BOB, 1, "Bob pastes page two of a novel here.");     // 3
    writerWrites(BOB, 1, "Bob pastes page three of a novel now.");    // 4
    writerWrites(BOB, 1, "Bob pastes page four of a novel here.");    // 5
    writerWrites(BOB, 1, "Bob pastes page five of a novel here.");    // 6
    takedown(1, 2);
    takedown(1, 3);
    takedown(1, 4);
    takedown(1, 5);
    expect(c().get_account_status(new stories.get_account_status_arguments(BOB)).strikes).toBe(4);
    expect(c().get_account_status(new stories.get_account_status_arguments(BOB)).blocked).toBe(false);
    takedown(1, 6);
    const st = c().get_account_status(new stories.get_account_status_arguments(BOB));
    expect(st.strikes).toBe(5);
    expect(st.blocked).toBe(true);
    expect(countEvents("stories.account_blocked_event")).toBe(1);
    fails(() => {
      directly(); authorize(BOB); MockVM.setCallContractResults([writerAnswer(), okCall()]);
      c().contribute(new stories.contribute_arguments(BOB, 1, "Bob tries to write again today.", false, false, 31, true, 0));
    }, "STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
    fails(() => {
      directly(); authorize(BOB);
      c().report_segment(new stories.report_segment_arguments(BOB, 1, 1, SPAM, ""));
    }, "STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
  });

  it("follows the strike limit the admin sets", () => {
    directly(); authorize(STORIES);
    c().set_moderation(new stories.set_moderation_arguments(BOT, 3, 1));
    checkpoint();
    fails(() => { authorize(STORIES); c().set_moderation(new stories.set_moderation_arguments(BOT, 3, 0)); }, "STORIES: strike limit must be 1 to 20");
    open(OPENING);
    writerWrites(BOB, 1, "Bob pastes page one of a novel here.");
    takedown(1, 2);
    expect(c().get_account_status(new stories.get_account_status_arguments(BOB)).blocked).toBe(true);
  });

  it("lets only the admin block and unblock by hand", () => {
    open(OPENING);
    fails(() => { authorize(BOT); c().set_blocked(new stories.set_blocked_arguments(BOB, true, "")); }, "STORIES: admin authority required");
    directly(); authorize(STORIES);
    c().set_blocked(new stories.set_blocked_arguments(ALICE, true, "spam wave"));
    checkpoint();
    fails(() => {
      directly(); authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, "Alice writes one more line.", false, false, 27, true, 0));
    }, "STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
    fails(() => { directly(); authorize(STORIES); c().set_blocked(new stories.set_blocked_arguments(ALICE, true, "")); }, "STORIES: wallet is already blocked");
    directly(); authorize(STORIES);
    c().set_blocked(new stories.set_blocked_arguments(ALICE, false, "appeal accepted"));
    checkpoint();
    openerWrites(1, "Alice writes one more line.");
    expect(story(1).segment_count).toBe(2);
  });
});

// ---------- AB-001: rewritten text is the rewriter's responsibility ----------

function addEditor(id: u64, who: Uint8Array): void {
  directly(); authorize(ALICE);
  c().set_editor(new stories.set_editor_arguments(ALICE, id, who, true));
  checkpoint();
}

function rewrite(as: Uint8Array, id: u64, seq: u64, text: string): void {
  directly(); authorize(as); allowCalls(1);
  c().edit_segment(new stories.edit_segment_arguments(as, id, seq, text, <u64>text.length));
  checkpoint();
}

function strikes(who: Uint8Array): u32 {
  return c().get_account_status(new stories.get_account_status_arguments(who)).strikes;
}

describe("Moderation: a takedown strikes whoever put the words there (AB-001)", () => {
  beforeEach(() => { reset(); });

  it("strikes the editor, not the writer, when an editor rewrote the part", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");     // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Carol pastes a line from a famous book");   // different words, about the same length
    takedown(1, 2);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(CAROL)).toBe(1);
  });

  it("cannot be used to block a writer: five rewrites block the editor instead", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes the first of five scenes.");    // 2
    writerWrites(BOB, 1, "Bob writes the second of five scenes.");   // 3
    writerWrites(BOB, 1, "Bob writes the third of five scenes.");    // 4
    writerWrites(BOB, 1, "Bob writes the fourth of five scenes.");   // 5
    writerWrites(BOB, 1, "Bob writes the fifth of five scenes.");    // 6
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Carol pastes page one of a novel here.");
    rewrite(CAROL, 1, 3, "Carol pastes page two of a novel here..");
    rewrite(CAROL, 1, 4, "Carol pastes page three of a novel..");
    rewrite(CAROL, 1, 5, "Carol pastes page four of a novel...");
    rewrite(CAROL, 1, 6, "Carol pastes page five of a novel...");
    for (let seq: u64 = 2; seq <= 6; seq++) takedown(1, seq);
    expect(c().get_account_status(new stories.get_account_status_arguments(BOB)).blocked).toBe(false);
    expect(c().get_account_status(new stories.get_account_status_arguments(CAROL)).blocked).toBe(true);
    writerWrites(BOB, 1, "Bob can still write after all of this.");
    expect(story(1).segment_count).toBe(7);
  });

  it("strikes the opener who rewrote a writer's part in the final edit", () => {
    open(OPENING);                                                     // 1: 28
    const line = "Bob writes a scene for the final edit.";             // 2: 38
    writerWrites(BOB, 1, line);
    for (let i = 0; i < 4; i++) openerWrites(1, chars(2000));          // 3..6
    openerWrites(1, chars(1972 - line.length));                       // 7: story locks
    closeStory(1);
    const swapped = "Alice swaps in a page from a novel....";
    batch(1, [keep(1), new stories.final_item(2, stories.final_mode.FINAL_EDITED, swapped, <u64>swapped.length)]);
    takedown(1, 2);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(ALICE)).toBe(1);
  });

  it("still strikes the editor after they rewrote the part and then removed it", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Carol pastes a line from a famous book");
    directly(); authorize(CAROL); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(CAROL, 1, 2));
    checkpoint();
    takedown(1, 2);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(CAROL)).toBe(1);
  });

  it("strikes the writer when nobody rewrote the part, even if an editor removed it", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob pastes a paragraph from a novel.");
    addEditor(1, CAROL);
    directly(); authorize(CAROL); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(CAROL, 1, 2));
    checkpoint();
    takedown(1, 2);
    expect(strikes(BOB)).toBe(1);
    expect(strikes(CAROL)).toBe(0);
  });

  it("records the rewriter on the part and the struck wallet in the event", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");     // 2
    openerWrites(1, "Alice writes a scene of her own here.");          // 3
    addEditor(1, CAROL);
    expect(seg(1, 2).text_by).toBeNull();
    rewrite(CAROL, 1, 2, "Carol pastes a line from a famous book");
    expect(seg(1, 2).author!).toStrictEqual(BOB);
    expect(seg(1, 2).text_by!).toStrictEqual(CAROL);
    rewrite(ALICE, 1, 3, "Alice fixes a typo in her own scene..");    // a writer editing their own part
    expect(seg(1, 3).text_by).toBeNull();
    takedown(1, 2);
    const ev = lastModeration();
    expect(ev.author!).toStrictEqual(BOB);
    expect(ev.struck!).toStrictEqual(CAROL);
    takedown(1, 3);
    expect(lastModeration().struck!).toStrictEqual(ALICE);
    expect(strikes(ALICE)).toBe(1);
  });
});

// ---------- AB-023: only adding or replacing words moves the strike ----------

function takedownStriking(id: u64, seq: u64, who: Uint8Array): void {
  directly(); authorize(STORIES);
  c().takedown_segment(new stories.takedown_segment_arguments(id, seq, COPYRIGHT, "notice 2026-002", who));
  checkpoint();
}

describe("Moderation: the strike goes to whoever wrote the live text (AB-023)", () => {
  beforeEach(() => { reset(); });

  it("keeps the writer as owner after an editor trims one character", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob pastes a paragraph from a novel.");  // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Bob pastes a paragraph from a novel");   // the full stop removed
    expect(seg(1, 2).text_by).toBeNull();
    takedown(1, 2);
    expect(strikes(BOB)).toBe(1);
    expect(strikes(CAROL)).toBe(0);
    expect(lastModeration().struck!).toStrictEqual(BOB);
  });

  it("moves ownership to an editor who swaps a word", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");  // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Bob writes a quiet scene by the bay.");
    expect(seg(1, 2).text_by!).toStrictEqual(CAROL);
    takedown(1, 2);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(CAROL)).toBe(1);
  });

  it("moves ownership to the opener who overwrites a writer's part in a public story", () => {
    open(OPENING);
    expect(story(1).visibility).toBe(PUBLIC);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");  // 2
    rewrite(ALICE, 1, 2, "Alice puts in a page from a novel...");
    expect(seg(1, 2).text_by!).toStrictEqual(ALICE);
    takedown(1, 2);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(ALICE)).toBe(1);
  });

  it("still strikes the editor who replaced the words (the AB-001 case)", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes an honest paragraph.");       // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Cara plants a copied paragraph");
    takedown(1, 2);
    expect(strikes(BOB)).toBe(0);
    expect(strikes(CAROL)).toBe(1);
  });

  it("keeps the rewriter as owner when someone else later only trims", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");  // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Carol pastes a line from a famous book");
    rewrite(ALICE, 1, 2, "Carol pastes a line from a famous");
    expect(seg(1, 2).text_by!).toStrictEqual(CAROL);
    takedown(1, 2);
    expect(strikes(ALICE)).toBe(0);
    expect(strikes(CAROL)).toBe(1);
  });

  it("keeps the writer as owner after a trim in the final edit", () => {
    open(OPENING);                                                     // 1: 28
    const line = "Bob writes a scene for the final edit.";             // 2: 38
    writerWrites(BOB, 1, line);
    for (let i = 0; i < 4; i++) openerWrites(1, chars(2000));          // 3..6
    openerWrites(1, chars(1972 - line.length));                       // 7: story locks
    closeStory(1);
    const trimmed = "Bob writes a scene for the final edit";
    batch(1, [keep(1), new stories.final_item(2, stories.final_mode.FINAL_EDITED, trimmed, <u64>trimmed.length)]);
    expect(seg(1, 2).text_by).toBeNull();
    takedown(1, 2);
    expect(strikes(BOB)).toBe(1);
    expect(strikes(ALICE)).toBe(0);
  });

  it("lets the admin strike the writer instead of the current owner", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob writes a quiet scene by the sea.");  // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Bob writes a quiet scene by the bay.");
    takedownStriking(1, 2, BOB);
    expect(strikes(BOB)).toBe(1);
    expect(strikes(CAROL)).toBe(0);
    expect(lastModeration().struck!).toStrictEqual(BOB);
  });

  it("refuses an admin strike on anyone but the writer or the current owner", () => {
    open(OPENING);
    writerWrites(BOB, 1, "Bob pastes a paragraph from a novel.");  // 2
    addEditor(1, CAROL);
    rewrite(CAROL, 1, 2, "Bob pastes a paragraph from a novel");   // a trim: Bob still owns it
    fails(() => {
      directly(); authorize(STORIES);
      c().takedown_segment(new stories.takedown_segment_arguments(1, 2, COPYRIGHT, "", CAROL));
    }, "STORIES: strike the part's writer or the wallet whose words are live");
    fails(() => {
      directly(); authorize(STORIES);
      c().takedown_segment(new stories.takedown_segment_arguments(1, 2, COPYRIGHT, "", DAVE));
    }, "STORIES: strike the part's writer or the wallet whose words are live");
    expect(seg(1, 2).taken_down).toBe(false);
    takedownStriking(1, 2, BOB);
    expect(strikes(BOB)).toBe(1);
    expect(strikes(CAROL)).toBe(0);
  });
});

// ---------- 10,000-character parts and adding text between parts ----------

describe("Writing: 10,000-character parts and adding text between parts", () => {
  beforeEach(() => { reset(); });

  it("starts with a 10,000 per-part cap, and the admin may set up to 10,000", () => {
    MockVM.reset();
    MockVM.setContractId(STORIES);
    setTime(START);
    directly();
    checkpoint();
    expect(cfg().contribution_cap).toBe(10000);
    authorize(STORIES);
    c().set_limits(new stories.set_limits_arguments(10000, 1000, 3, 60, 30));
    checkpoint();
    fails(() => { authorize(STORIES); c().set_limits(new stories.set_limits_arguments(10001, 1000, 3, 60, 30)); },
      "STORIES: per-submission cap must be 100 to 10000");
  });

  it("accepts a 10,000-character part at the default cap", () => {
    directly(); authorize(STORIES);
    c().set_limits(new stories.set_limits_arguments(10000, 1000, 3, 60, 30));
    checkpoint();
    directly(); authorize(ALICE); allowCalls(2);
    const big = chars(10000);
    c().open_story(new stories.open_story_arguments(ALICE, SHORT, "Big", 99999, 1, 0, PUBLIC, 0, 0, big, false, 10000, USDT, true, 0));
    checkpoint();
    expect(story(1).used_chars).toBe(10000);
  });

  it("adds text right after a chosen part, and records where", () => {
    open(OPENING);                                   // 1
    openerWrites(1, "The second part, at the end as usual.");   // 2
    directly(); authorize(ALICE); allowCalls(1);
    const text = "A new line slipped in after the opening.";
    const seq = c().contribute(new stories.contribute_arguments(ALICE, 1, text, false, false, <u64>text.length, true, 0, 1)).value;
    checkpoint();
    expect(seq).toBe(3);
    expect(seg(1, 3).insert_after).toBe(1);
    expect(seg(1, 2).insert_after).toBe(0);
  });

  it("keeps a multi-part addition together with after_my_last", () => {
    open(OPENING);                                                // 1
    openerWrites(1, "The second part, at the end as usual.");     // 2
    directly(); authorize(ALICE); allowCalls(2);
    const a = "First piece, slipped in after the opening.";
    const b = "Second piece, which must follow the first.";
    c().contribute(new stories.contribute_arguments(ALICE, 1, a, false, false, <u64>a.length, true, 0, 1));
    c().contribute(new stories.contribute_arguments(ALICE, 1, b, false, false, <u64>b.length, true, 0, 0, true));
    checkpoint();
    expect(seg(1, 3).insert_after).toBe(1);
    expect(seg(1, 4).insert_after).toBe(3);
    fails(() => {
      directly(); authorize(BOB); MockVM.setCallContractResults([writerAnswer(), okCall()]);
      c().contribute(new stories.contribute_arguments(BOB, 1, "Bob has never written here at all.", false, false, 34, true, 0, 0, true));
    }, "STORIES: you have no earlier part in this story");
  });

  it("refuses adding after a part that doesn't exist or was removed", () => {
    open(OPENING);
    openerWrites(1, "The second part, at the end as usual.");
    fails(() => {
      directly(); authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, "After a part that is not there.", false, false, 31, true, 0, 9));
    }, "STORIES: unknown part to add text after");
    directly(); authorize(ALICE); allowCalls(1);
    c().remove_segment(new stories.remove_segment_arguments(ALICE, 1, 2));
    checkpoint();
    fails(() => {
      directly(); authorize(ALICE); allowCalls(1);
      c().contribute(new stories.contribute_arguments(ALICE, 1, "After a part that was removed.", false, false, 30, true, 0, 2));
    }, "STORIES: you can only add text after a part that is still in the story");
  });
});
