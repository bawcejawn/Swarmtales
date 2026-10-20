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
  assert.match(assessWrite({ ...openStory, visibility: 3, writerActive: true }).problems.join(" "), /private/);
  assert.equal(assessWrite({ ...openStory, visibility: 3, privileged: true }).ok, true);
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
