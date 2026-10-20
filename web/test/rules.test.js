import assert from "node:assert/strict";
import test from "node:test";
import { assessOpen, assessPromo, assessWrite, assessWriterBuy, isActiveWriter } from "../src/lib/rules.js";

const openStory = {
  text: "Hello",
  cap: "4000",
  maxChars: "10000",
  usedChars: "742",
  balance: "100",
  status: 1,
  visibility: 1,
  privileged: false,
  writerActive: true,
  promoClaimed: false,
  rightsConfirmed: true,
};

test("an active writer can add a short line", () => {
  const plan = assessWrite(openStory);
  assert.equal(plan.ok, true);
  assert.equal(plan.cost, "5");
  assert.equal(plan.spaceLeft, "9258");
});

test("writing is refused for cost, space, membership, and privacy", () => {
  assert.equal(assessWrite({ ...openStory, text: "a".repeat(4001) }).ok, false);
  assert.match(assessWrite({ ...openStory, text: "a".repeat(4001) }).problems.join(" "), /cap/);
  assert.match(assessWrite({ ...openStory, usedChars: "9998", text: "abcd" }).problems.join(" "), /left/);
  assert.match(assessWrite({ ...openStory, balance: "2" }).problems.join(" "), /balance/);
  assert.match(assessWrite({ ...openStory, writerActive: false, promoClaimed: false }).problems.join(" "), /Writer/);
  assert.match(assessWrite({ ...openStory, visibility: 3, writerActive: true }).problems.join(" "), /invites/);
  assert.match(assessWrite({ ...openStory, visibility: 2, writerActive: true }).problems.join(" "), /invites/);
  // Opener: no Writer month needed. Editor: needs one (no trial here).
  assert.equal(assessWrite({ ...openStory, visibility: 3, privileged: true, isOpener: true }).ok, true);
  assert.match(assessWrite({ ...openStory, visibility: 3, privileged: true, writerActive: false, promoClaimed: true }).problems.join(" "), /Writer month/);
  assert.equal(assessWrite({ ...openStory, visibility: 3, allowed: true, writerActive: true }).ok, true);
  assert.equal(assessWrite({ ...openStory, status: 4 }).ok, false);
});

test("a promo wallet uses the trial until it is spent", () => {
  const trial = assessWrite({
    ...openStory,
    writerActive: false,
    promoClaimed: true,
    trialLimit: "1000",
    trialUsed: "990",
  });
  assert.equal(trial.ok, true);
  assert.equal(trial.usesTrial, true);
  const spent = assessWrite({
    ...openStory,
    writerActive: false,
    promoClaimed: true,
    trialLimit: "1000",
    trialUsed: "998",
    text: "abcd",
  });
  assert.equal(spent.ok, false);
});

test("opening a short story checks length, price, and starter ink", () => {
  const input = {
    title: "A night market",
    rightsConfirmed: true,
    openingText: "Once",
    maxChars: "10000",
    cap: "4000",
    category1: 1,
    category2: 0,
    visibility: 1,
    freeChapters: 0,
    editionMin: "0",
    openCount: 0,
    openLimit: 3,
    inkBalance: "0",
    starter: "10000",
    price: "1000000000",
    tokenBalance: "1000000000",
  };
  const ok = assessOpen(input);
  assert.equal(ok.ok, true);
  assert.equal(ok.cost, "4");
  assert.equal(assessOpen({ ...input, maxChars: "100" }).ok, false);
  const poor = assessOpen({
    title: "A night market",
    openingText: "Once",
    maxChars: "10000",
    cap: "4000",
    category1: 1,
    visibility: 1,
    freeChapters: 0,
    editionMin: "0",
    openCount: 0,
    openLimit: 3,
    inkBalance: "0",
    starter: "10000",
    price: "5",
    tokenBalance: "1",
  });
  assert.equal(poor.ok, false);
});

test("writer month and promo checks", () => {
  assert.equal(assessWriterBuy({ price: "5", balance: "5", paused: false }).ok, true);
  assert.equal(assessWriterBuy({ price: "5", balance: "4", paused: false }).ok, false);
  assert.equal(assessWriterBuy({ price: "0", balance: "5", paused: false }).ok, false);
  assert.equal(assessPromo({ campaignId: "1", hasLinkKey: true, alreadyClaimed: false, paused: false, promoEnabled: true }).ok, true);
  assert.equal(assessPromo({ campaignId: "1", hasLinkKey: true, alreadyClaimed: true, paused: false, promoEnabled: true }).ok, false);
  assert.equal(assessPromo({ campaignId: "1", hasLinkKey: false, alreadyClaimed: false, paused: false, promoEnabled: true }).ok, false);
  assert.equal(assessPromo({ campaignId: "0", hasLinkKey: true, alreadyClaimed: false, paused: false, promoEnabled: false }).ok, false);
});

test("writer membership needs tier 2 and a future paid_until", () => {
  assert.equal(isActiveWriter({ tier: 2, paid_until: "200" }, "100"), true);
  assert.equal(isActiveWriter({ tier: 2, paid_until: "100" }, "100"), false);
  assert.equal(isActiveWriter({ tier: 1, paid_until: "200" }, "100"), false);
});

test("parts shorter than the minimum are refused unless they close the story", () => {
  const rule = { ...openStory, minContribution: "20" };
  assert.match(assessWrite({ ...rule, text: "Too short." }).problems.join(" "), /at least 20/);
  assert.equal(assessWrite({ ...rule, text: "This line is long enough to count." }).ok, true);
  assert.equal(assessWrite({ ...rule, usedChars: "9995", text: "The end" }).ok, false);
  assert.equal(assessWrite({ ...rule, usedChars: "9993", text: "The end" }).ok, true);
});

test("books use the book length range", () => {
  const base = {
    title: "A long tale", openingText: "The opening line of a very long book.", maxChars: "100000",
    category1: "1", category2: "0", visibility: "1", freeChapters: 0, editionMin: "0", cap: "2000",
    inkBalance: "0", starter: "20000", openCount: 0, openLimit: 3, price: "100000000", tokenBalance: "500000000", kind: 1, rightsConfirmed: true,
  };
  assert.equal(assessOpen(base).ok, true);
  assert.match(assessOpen({ ...base, maxChars: "99999" }).problems.join(" "), /A book must be 100,000 to 1,000,000/);
  assert.match(assessOpen({ ...base, kind: 2 }).problems.join(" "), /short story must be 10,000 to 99,999/);
});

test("writing and opening need the rights confirmation, and a blocked wallet is told why", () => {
  assert.match(assessWrite({ ...openStory, rightsConfirmed: false }).problems.join(" "), /I wrote this myself/);
  assert.match(assessWrite({ ...openStory, blocked: true }).problems.join(" "), /can no longer write/);
});

test("the writers' pool pays for parts in invite-only stories", () => {
  const base = {
    text: "Twenty characters ok", cap: "10000", maxChars: "99999", usedChars: "100", status: 1,
    rightsConfirmed: true, allowed: true, writerActive: true, visibility: 3, balance: "0",
  };
  const paid = assessWrite({ ...base, fund: "500" });
  assert.equal(paid.ok, true);
  assert.equal(paid.fundPays, true);
  const low = assessWrite({ ...base, fund: "5" });
  assert.equal(low.ok, false);
  assert.match(low.problems.join(" "), /writers' pool has 5 Ink left/);
  assert.equal(assessWrite({ ...base, fund: "5", balance: "20" }).ok, true);
});

test("opening an invite-only story needs a writers' pool and enough Ink", () => {
  const base = {
    title: "T", openingText: "An opening part that is long enough.", kind: 2, category1: 1, visibility: 3,
    freeChapters: 1, editionMin: "0", cap: "10000", inkBalance: "0", starter: "1000", price: "100", tokenBalance: "1000",
    rightsConfirmed: true,
  };
  assert.match(assessOpen({ ...base, fund: "9999" }).problems.join(" "), /at least 10,000 Ink/);
  const short = assessOpen({ ...base, fund: "10000" });
  assert.match(short.problems.join(" "), /You need 10036 Ink/);
  const ok = assessOpen({ ...base, fund: "10000", inkBalance: "9100" });
  assert.equal(ok.ok, true);
  assert.equal(ok.fund, "10000");
  assert.equal(ok.maxChars, "0");
  // Public stories have no pool; the price follows the multiplier.
  const pub = assessOpen({ ...base, visibility: 1, fund: "10000", multiplier: 4 });
  assert.equal(pub.fund, "0");
  assert.equal(pub.price, "400");
  assert.equal(pub.ok, true);
});
