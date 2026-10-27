// Wave 2 (October 2026): suggested changes and the story guide.
//  - Anyone who may write in a story may suggest a change to someone else's
//    part, for free. The part's writer accepts (as their own edit: they pay
//    for added letters) or declines. The proposer may withdraw; anyone may
//    close a suggestion once the part changed; moderation clears and wipes.
//  - The opener or an editor sets the story guide (notes, wanted line); only
//    the opener switches the blind round; moderation clears it.
import { MockVM, Protobuf } from "@koinos/sdk-as";
import { Stories } from "../Stories";
import { stories } from "../proto/stories";
import {
  ALICE, BOB, CARA, MALLORY, STORIES, PRIVATE, allowCalls, authorize, burnsFrom, checkpoint, configure, invite, okCall,
  openAs, openPublic, ownerEdit, reset, results, segment, story, takedown, versions, write, writerMonth,
} from "./auditFixHelpers";

const OPENING = "Once upon a time.";
const BETTER = "Once upon a long, long time.";

// AssemblyScript has no closures: the expect() callbacks read these.
let gId: u64 = 0;
let gWho: Uint8Array = new Uint8Array(0);
let gText: string = "";
let gSugg: u32 = 0;

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function wallet(n: u8): Uint8Array {
  const a = new Uint8Array(25);
  a[1] = 200;
  a[2] = n;
  return a;
}

function suggest(who: Uint8Array, id: u64, seq: u64, text: string): u32 {
  authorize(who);
  results([writerMonth()]);
  const sid = new Stories().suggest_change(new stories.suggest_change_arguments(who, id, seq, text, "", false, true, 0)).value;
  checkpoint();
  return sid;
}

function accept(writer: Uint8Array, id: u64, seq: u64, sid: u32, text: string): u32 {
  authorize(writer);
  const current = segment(id, seq).current_cost;
  const growth: u64 = <u64>text.length > current ? <u64>text.length - current : 0;
  if (growth > 0) results([writerMonth(), okCall()]);
  else allowCalls(1);
  const v = new Stories().accept_suggestion(new stories.accept_suggestion_arguments(writer, id, seq, sid, <u64>text.length, growth, true, 0)).value;
  checkpoint();
  return v;
}

function decline(who: Uint8Array, id: u64, seq: u64, sid: u32, note: string): void {
  authorize(who);
  new Stories().decline_suggestion(new stories.decline_suggestion_arguments(who, id, seq, sid, note, false));
  checkpoint();
}

function moderate(id: u64, seq: u64, sid: u32, note: string): void {
  authorize(STORIES);
  new Stories().decline_suggestion(new stories.decline_suggestion_arguments(STORIES, id, seq, sid, note, true));
  checkpoint();
}

function suggestionsOf(id: u64, seq: u64): stories.suggestion[] {
  const out: stories.suggestion[] = [];
  let from: u32 = 1;
  while (from != 0) {
    const page = new Stories().get_suggestions(new stories.get_suggestions_arguments(id, seq, from, 5));
    for (let i = 0; i < page.values.length; i++) out.push(page.values[i]);
    from = page.next;
  }
  return out;
}

function guide(who: Uint8Array, id: u64, notes: string, wanted: string, blind: bool): void {
  authorize(who);
  new Stories().set_story_guide(new stories.set_story_guide_arguments(who, id, notes, wanted, blind));
  checkpoint();
}

function lastEvent(name: string): Uint8Array | null {
  const events = MockVM.getEvents();
  for (let i = events.length - 1; i >= 0; i--) if (events[i].name == name) return events[i].data;
  return null;
}

describe("Stories Wave 2: suggestions", () => {
  beforeEach(() => {
    reset();
    configure();
  });

  it("anyone who may write suggests a change to someone else's part, for free", () => {
    const id = openPublic();
    const before = burnsFrom(BOB);
    const sid = suggest(BOB, id, 1, BETTER);
    expect(sid).toBe(1);
    expect(burnsFrom(BOB)).toBe(before, "nothing is charged to suggest");
    const s = suggestionsOf(id, 1);
    expect(s.length).toBe(1);
    expect(s[0].text).toBe(BETTER);
    expect(s[0].status).toBe(0);
    expect(s[0].cost).toBe(<u64>BETTER.length);
    expect(segment(id, 1).pending_suggestions).toBe(1);
    expect(segment(id, 1).text).toBe(OPENING, "the part doesn't change until its writer accepts");
    const ev = Protobuf.decode<stories.suggestion_event>(lastEvent("stories.suggestion_event")!, stories.suggestion_event.decode);
    expect(ev.action).toBe("suggested");
  });

  it("the part's writer accepts: the text changes as their own edit, credited to the proposer", () => {
    const id = openPublic();
    const sid = suggest(BOB, id, 1, BETTER);
    const aliceBefore = burnsFrom(ALICE);
    const v = accept(ALICE, id, 1, sid, BETTER);
    const seg = segment(id, 1);
    expect(seg.text).toBe(BETTER);
    expect(seg.current_cost).toBe(<u64>BETTER.length);
    expect(seg.author).toStrictEqual(ALICE, "the part stays its writer's");
    expect(seg.edited_by_others).toBe(true, "someone else's words are in it now");
    expect(seg.pending_suggestions).toBe(0);
    expect(burnsFrom(ALICE) - aliceBefore).toBe(<u64>(BETTER.length - OPENING.length), "the writer pays for the added letters");
    const vs = versions(id, 1);
    expect(vs[vs.length - 1].version).toBe(v);
    expect(vs[vs.length - 1].kind).toBe(6);
    expect(vs[vs.length - 1].by).toStrictEqual(BOB);
    const changers = new Stories().get_changers(new stories.get_changers_arguments(id, 1)).values;
    expect(changers.length).toBe(1);
    expect(changers[0]).toStrictEqual(BOB);
    expect(suggestionsOf(id, 1)[0].status).toBe(1);
  });

  it("only the part's writer may accept", () => {
    gId = openPublic();
    gSugg = suggest(BOB, gId, 1, BETTER);
    gWho = CARA;
    expect(() => {
      authorize(gWho);
      allowCalls(1);
      new Stories().accept_suggestion(new stories.accept_suggestion_arguments(gWho, gId, 1, gSugg, <u64>BETTER.length, 20, true, 0));
    }).toThrow();
    errorIs("STORIES: only the part's writer may accept a suggestion");
  });

  it("a suggestion can't be accepted once the part changed since", () => {
    gId = openPublic();
    gSugg = suggest(BOB, gId, 1, BETTER);
    ownerEdit(ALICE, gId, 1, "Once upon a time, far away.");
    expect(() => { accept(ALICE, gId, 1, gSugg, BETTER); }).toThrow();
    errorIs("STORIES: the part changed since this was suggested; ask for a new suggestion");
  });

  it("refuses suggesting on your own part, the same text, or a second waiting suggestion", () => {
    gId = openPublic();
    expect(() => { suggest(ALICE, gId, 1, BETTER); }).toThrow();
    errorIs("STORIES: this is your own part; edit it instead of suggesting");
    expect(() => { suggest(BOB, gId, 1, OPENING); }).toThrow();
    errorIs("STORIES: the text is unchanged");
    suggest(BOB, gId, 1, BETTER);
    expect(() => { suggest(BOB, gId, 1, "Once upon another time."); }).toThrow();
    errorIs("STORIES: you already have a suggestion waiting on this part; withdraw it first");
  });

  it("takes at most 5 waiting suggestions on a part", () => {
    gId = openPublic();
    for (let i: u8 = 1; i <= 5; i++) suggest(wallet(i), gId, 1, "Once upon a time, take " + i.toString() + ".");
    gWho = wallet(6);
    expect(() => { suggest(gWho, gId, 1, "Once upon a time, take six."); }).toThrow();
    errorIs("STORIES: this part already has 5 suggestions waiting for its writer");
    // Declining one makes room.
    decline(ALICE, gId, 1, 1, "Not this one, thanks.");
    suggest(gWho, gId, 1, "Once upon a time, take six.");
    expect(segment(gId, 1).pending_suggestions).toBe(5);
  });

  it("keeps at most 20 suggestions on a part: a new one reuses the oldest closed slot, so the part never fills up", () => {
    const id = openPublic();
    for (let i: u8 = 1; i <= 20; i++) {
      const sid = suggest(BOB, id, 1, "Once upon a time, number " + i.toString() + ".");
      decline(BOB, id, 1, sid, "");
    }
    expect(segment(id, 1).suggestion_count).toBe(20);
    // Twenty suggest-and-withdraw rounds by one wallet don't stop anyone.
    const sid = suggest(CARA, id, 1, "Once upon a time, number 21.");
    expect(sid).toBe(1, "the oldest closed slot");
    expect(segment(id, 1).suggestion_count).toBe(20);
    expect(suggestionsOf(id, 1)[0].text).toBe("Once upon a time, number 21.");
    expect(suggestionsOf(id, 1)[0].status).toBe(0);
  });

  it("the writer declines with a note; the proposer withdraws; a stranger can't close a live one", () => {
    gId = openPublic();
    const a = suggest(BOB, gId, 1, BETTER);
    decline(ALICE, gId, 1, a, "I like the short version.");
    let s = suggestionsOf(gId, 1);
    expect(s[0].status).toBe(2);
    expect(s[0].note).toBe("I like the short version.");
    const b = suggest(CARA, gId, 1, "Once upon a cold time.");
    decline(CARA, gId, 1, b, "");
    expect(suggestionsOf(gId, 1)[1].status).toBe(3);
    gSugg = suggest(MALLORY, gId, 1, "Once upon a warm time.");
    expect(() => { decline(BOB, gId, 1, gSugg, ""); }).toThrow();
    errorIs("STORIES: only the part's writer or the person who suggested it may close this suggestion");
    expect(segment(gId, 1).pending_suggestions).toBe(1);
  });

  it("anyone may close a suggestion once the part has changed, so stale ones don't block the part", () => {
    const id = openPublic();
    const sid = suggest(BOB, id, 1, BETTER);
    ownerEdit(ALICE, id, 1, "Once upon a time, far away.");
    decline(CARA, id, 1, sid, "");
    expect(suggestionsOf(id, 1)[0].status).toBe(2);
    expect(segment(id, 1).pending_suggestions).toBe(0);
  });

  it("the admin or moderator clears a suggestion and wipes its text, even while paused", () => {
    const id = openPublic();
    const sid = suggest(BOB, id, 1, BETTER);
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    moderate(id, 1, sid, "copied text");
    const s = suggestionsOf(id, 1)[0];
    expect(s.status).toBe(4);
    expect(s.text).toBe("");
    expect(s.cleared).toBe(true);
  });

  it("clearing an accepted suggestion wipes its text but keeps that it was accepted", () => {
    const id = openPublic();
    const sid = suggest(BOB, id, 1, BETTER);
    accept(ALICE, id, 1, sid, BETTER);
    moderate(id, 1, sid, "");
    const s = suggestionsOf(id, 1)[0];
    expect(s.status).toBe(1);
    expect(s.cleared).toBe(true);
    expect(s.text).toBe("");
  });

  it("only an explicit moderation call clears: the admin declining as a part's writer just declines", () => {
    gId = openPublic();
    gSugg = suggest(BOB, gId, 1, BETTER);
    gWho = MALLORY;
    expect(() => {
      authorize(gWho);
      new Stories().decline_suggestion(new stories.decline_suggestion_arguments(gWho, gId, 1, gSugg, "", true));
    }).toThrow();
    MockVM.rollbackTransaction();
    expect(suggestionsOf(gId, 1)[0].cleared).toBe(false, "a non-moderator can't clear");
  });

  it("can't be accepted once the proposer was taken off a private story's list", () => {
    gId = openAs(PRIVATE, 10000);
    invite(gId, BOB, true);
    gSugg = suggest(BOB, gId, 1, BETTER);
    invite(gId, BOB, false);
    expect(() => { accept(ALICE, gId, 1, gSugg, BETTER); }).toThrow();
    errorIs("STORIES: the person who suggested this is no longer one of this story's writers");
  });

  it("a takedown of the part wipes its suggestions", () => {
    const id = openPublic();
    const seq = write(BOB, id, "A second part by Bob.");
    suggest(CARA, id, seq, "A second part by Bob, improved.");
    takedown(id, seq, BOB);
    expect(suggestionsOf(id, seq).length).toBe(0);
    expect(segment(id, seq).suggestion_count).toBe(0);
  });

  it("in a private story only its writers may suggest", () => {
    gId = openAs(PRIVATE, 10000);
    expect(() => { suggest(BOB, gId, 1, BETTER); }).toThrow();
    errorIs("STORIES: this story is private");
    invite(gId, BOB, true);
    suggest(BOB, gId, 1, BETTER);
    expect(segment(gId, 1).pending_suggestions).toBe(1);
  });

  it("an accepted suggestion's citation doesn't replace the writer's own", () => {
    const id = openPublic();
    authorize(ALICE);
    new Stories().set_citation(new stories.set_citation_arguments(ALICE, id, 1, "Book A"));
    checkpoint();
    authorize(BOB);
    results([writerMonth()]);
    const sid = new Stories().suggest_change(new stories.suggest_change_arguments(BOB, id, 1, BETTER, "Book B", false, true, 0)).value;
    checkpoint();
    accept(ALICE, id, 1, sid, BETTER);
    expect(segment(id, 1).citation).toBe("Book A");
    const vs = versions(id, 1);
    expect(vs[vs.length - 1].citation).toBe("Book B", "the proposer's source stays with their version");
  });

  it("an accepted suggestion keeps the proposer's AI label and citation", () => {
    const id = openPublic();
    authorize(BOB);
    results([writerMonth()]);
    const sid = new Stories().suggest_change(new stories.suggest_change_arguments(BOB, id, 1, BETTER, "Grimm, 1812", true, true, 0)).value;
    checkpoint();
    accept(ALICE, id, 1, sid, BETTER);
    const seg = segment(id, 1);
    expect(seg.ai_assisted).toBe(true);
    expect(seg.citation).toBe("Grimm, 1812");
  });
});

describe("Stories Wave 2: the story guide", () => {
  beforeEach(() => {
    reset();
    configure();
  });

  it("the opener sets notes, a looking-for line and the blind round", () => {
    const id = openPublic();
    guide(ALICE, id, "Mira: a lighthouse keeper. Tone: hopeful.", "A villain's point of view", true);
    const st = story(id);
    expect(st.notes).toBe("Mira: a lighthouse keeper. Tone: hopeful.");
    expect(st.wanted).toBe("A villain's point of view");
    expect(st.blind).toBe(true);
    expect(st.guide_by).toStrictEqual(ALICE);
  });

  it("an editor sets the notes but not the blind round; others can't", () => {
    gId = openPublic();
    authorize(ALICE);
    new Stories().set_editor(new stories.set_editor_arguments(ALICE, gId, BOB, true));
    checkpoint();
    guide(BOB, gId, "World: a drowned city.", "", false);
    expect(story(gId).notes).toBe("World: a drowned city.");
    expect(() => { guide(BOB, gId, "World: a drowned city.", "", true); }).toThrow();
    errorIs("STORIES: only the opener may switch the blind round on or off");
    expect(() => { guide(CARA, gId, "Mine now.", "", false); }).toThrow();
    errorIs("STORIES: only the opener or an editor may change the story guide");
  });

  it("refuses notes over 3,000 characters and a looking-for line over 140", () => {
    gId = openPublic();
    gText = "a".repeat(3001);
    expect(() => { guide(ALICE, gId, gText, "", false); }).toThrow();
    errorIs("STORIES: the notes must be at most 3,000 characters");
    gText = "b".repeat(141);
    expect(() => { guide(ALICE, gId, "", gText, false); }).toThrow();
    errorIs("STORIES: the looking-for line must be at most 140 characters");
  });

  it("the admin or moderator clears the notes and the looking-for line, even while paused", () => {
    const id = openPublic();
    guide(ALICE, id, "Notes.", "Someone funny", false);
    authorize(STORIES);
    new Stories().set_paused(new stories.set_paused_arguments(true));
    checkpoint();
    guide(STORIES, id, "", "", true);
    expect(story(id).notes).toBe("");
    expect(story(id).wanted).toBe("");
    expect(story(id).blind).toBe(false, "moderation never changes the opener's blind round");
  });
});
