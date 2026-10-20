/**
 * Local checks before a wallet is asked to sign.
 * The chain still enforces every rule. These exist so the page can say
 * why a click would fail, in the same cases the contracts refuse.
 */

import { BOOK_MAX, BOOK_MIN, checkStoryText, checkTitle, SHORT_MAX, SHORT_MIN } from "./text.js";
import { asWhole } from "./money.js";

export const STORY_STATUS_OPEN = 1;
export const VIS_PUBLIC = 1;
export const VIS_UNLISTED = 2;
export const VIS_PRIVATE = 3;
export const KIND_BOOK = 1;
export const KIND_SHORT = 2;
export const TIER_WRITER = 2;
export const ITEM_WRITER_MONTH = 2;
export const ITEM_OPEN_SHORT = 7;

export function isActiveWriter(membership, nowSeconds) {
  const tier = Number(membership && membership.tier ? membership.tier : 0);
  let until = 0n;
  try {
    until = asWhole(membership && membership.paid_until ? membership.paid_until : "0", "paid_until");
  } catch {
    until = 0n;
  }
  let now = 0n;
  try {
    now = asWhole(nowSeconds, "now");
  } catch {
    now = 0n;
  }
  return tier === TIER_WRITER && until > now;
}

function whole(value, label, fallback) {
  if (value == null || value === "") return fallback;
  return asWhole(value, label);
}

/**
 * Can this wallet add `text` to this story?
 * privileged: opener or editor. allowed: on a private story's list.
 */
export const RIGHTS_PROBLEM = "Tick “I wrote this myself, or I have the right to use it” first.";
export const BLOCKED_PROBLEM = "This wallet can no longer write on SwarmTales, after repeated takedowns of copied text.";

export function assessWrite(input) {
  const problems = [];
  if (input.blocked) problems.push(BLOCKED_PROBLEM);
  if (!input.rightsConfirmed) problems.push(RIGHTS_PROBLEM);
  const textCheck = checkStoryText(input.text, true);
  const cost = textCheck.ok ? BigInt(textCheck.cost) : 0n;
  if (!textCheck.ok) problems.push(textCheck.reason);

  const cap = whole(input.cap, "cap", null);
  const maxChars = whole(input.maxChars, "story size", null);
  const used = whole(input.usedChars, "used", 0n);
  const balance = whole(input.balance, "Ink balance", null);
  if (cap == null) problems.push("The per-submission cap has not loaded.");
  if (maxChars == null) problems.push("This story's size has not loaded.");
  if (balance == null) problems.push("The Ink balance has not loaded.");

  const space = maxChars != null ? maxChars - used : null;
  if (space != null && space < 0n) problems.push("This story is already over its size.");

  const status = Number(input.status || 0);
  if (status !== STORY_STATUS_OPEN) problems.push("This story is not open for writing.");

  if (textCheck.ok && cap != null && cost > cap) {
    problems.push("That text costs " + cost + " Ink, over the per-submission cap of " + cap + ".");
  }
  if (textCheck.ok && space != null && cost > space) {
    problems.push("That text costs " + cost + " Ink, and this story has " + space + " left.");
  }
  const minimum = whole(input.minContribution, "minimum length", 0n);
  const closesStory = space != null && cost === space;
  if (textCheck.ok && minimum > 0n && cost < minimum && !closesStory) {
    problems.push("A part must be at least " + minimum + " characters, so each turn adds something. Only the very last part of a story may be shorter.");
  }
  const privileged = !!input.privileged;
  const visibility = Number(input.visibility || 0);
  // Unlisted and private stories are invite-only, and paid from the
  // writers' pool while it has enough.
  const inviteOnly = visibility === VIS_PRIVATE || visibility === VIS_UNLISTED;
  const fund = whole(input.fund, "writers' pool", 0n);
  const fundPays = inviteOnly && textCheck.ok && fund >= cost;
  if (textCheck.ok && !fundPays && balance != null && cost > balance) {
    problems.push(inviteOnly
      ? "The writers' pool has " + fund + " Ink left, so you pay for this part yourself. Your Ink balance is " + balance + " and this text costs " + cost + "."
      : "Ink balance is " + balance + " and this text costs " + cost + ".");
  }
  if (inviteOnly && !privileged && !input.allowed) {
    problems.push("Only people the opener invites can write in this story. Ask the opener for an invite link.");
  }
  if (inviteOnly && !input.isOpener && !input.writerActive) {
    problems.push("An active Writer month is needed to write in an unlisted or private story. The opener can give you one, or you can buy one on the Membership page.");
  }

  let usesTrial = false;
  if (!inviteOnly && !privileged && !input.writerActive) {
    if (!input.promoClaimed) {
      problems.push("An active Writer month is required, unless you opened this story or you are an editor.");
    } else {
      const trialLimit = whole(input.trialLimit, "trial limit", 0n);
      const trialUsed = whole(input.trialUsed, "trial used", 0n);
      if (textCheck.ok && trialUsed + cost > trialLimit) {
        problems.push("Trial writing limit reached. A trial wallet can write " + trialLimit + " characters in total.");
      } else if (textCheck.ok) {
        usesTrial = true;
      }
    }
  }

  return {
    ok: problems.length === 0,
    cost: cost.toString(),
    problems,
    spaceLeft: space == null ? "" : space.toString(),
    usesTrial,
    fundPays,
  };
}

export function assessOpen(input) {
  const problems = [];
  if (input.blocked) problems.push(BLOCKED_PROBLEM);
  if (!input.rightsConfirmed) problems.push(RIGHTS_PROBLEM);
  const title = checkTitle(input.title);
  if (!title.ok) problems.push(title.reason);
  const textCheck = checkStoryText(input.openingText, true);
  const cost = textCheck.ok ? BigInt(textCheck.cost) : 0n;
  if (!textCheck.ok) problems.push("Opening text: " + textCheck.reason);

  const isBook = Number(input.kind || KIND_SHORT) === KIND_BOOK;
  const lo = isBook ? BOOK_MIN : SHORT_MIN;
  const hi = isBook ? BOOK_MAX : SHORT_MAX;
  const range = lo.toLocaleString("en-US") + " to " + hi.toLocaleString("en-US");
  // No length (or 0) means open-ended: the story may grow to the kind's
  // maximum and can be finished once it reaches the minimum.
  let maxChars = null;
  const openEnded = input.maxChars == null || input.maxChars === "" || String(input.maxChars) === "0";
  try {
    maxChars = openEnded ? BigInt(hi) : asWhole(input.maxChars, "length");
  } catch {
    problems.push("Length must be a whole number from " + range + ".");
  }
  if (maxChars != null && (maxChars < BigInt(lo) || maxChars > BigInt(hi))) {
    problems.push((isBook ? "A book" : "A short story") + " must be " + range + " characters.");
  }

  const cap = whole(input.cap, "cap", null);
  if (textCheck.ok && cap != null && cost > cap) {
    problems.push("The opening text costs " + cost + " Ink, over the per-submission cap of " + cap + ".");
  }
  if (textCheck.ok && maxChars != null && cost > maxChars) {
    problems.push("The opening text is longer than the story length you chose.");
  }

  const openMin = whole(input.minContribution, "minimum length", 0n);
  if (textCheck.ok && openMin > 0n && cost < openMin) {
    problems.push("The opening text must be at least " + openMin + " characters.");
  }

  const c1 = Number(input.category1 || 0);
  const c2 = Number(input.category2 || 0);
  if (!c1) problems.push("Pick a category.");
  if (c2 && c2 === c1) problems.push("The two categories must be different.");

  const visibility = Number(input.visibility || 0);
  if (visibility !== VIS_PUBLIC && visibility !== VIS_UNLISTED && visibility !== VIS_PRIVATE) {
    problems.push("Pick Public, Unlisted, or Private.");
  }

  const free = Number(input.freeChapters);
  if (!Number.isInteger(free) || free < 0 || free > 5) problems.push("Free chapters must be 0 to 5.");

  let edition = 0n;
  try {
    edition = asWhole(input.editionMin == null || input.editionMin === "" ? "0" : input.editionMin, "contributor edition");
  } catch {
    problems.push("Words needed for a keepsake copy must be a whole number (0 or more).");
  }
  if (maxChars != null && edition > maxChars) {
    problems.push("Words needed for a keepsake copy can't be more than the story's length.");
  }

  const openCount = Number(input.openCount || 0);
  const openLimit = Number(input.openLimit || 0);
  if (openLimit && openCount >= openLimit) {
    problems.push("You already have the maximum number of open projects (" + openLimit + ").");
  }

  const inviteOnly = visibility === VIS_UNLISTED || visibility === VIS_PRIVATE;
  let fund = 0n;
  try {
    fund = inviteOnly ? asWhole(input.fund == null || input.fund === "" ? "0" : input.fund, "writers' pool") : 0n;
  } catch {
    problems.push("The writers' pool must be a whole number of Ink.");
  }
  if (inviteOnly && fund < BigInt(lo)) {
    problems.push("An unlisted or private " + (isBook ? "book" : "short story") + " needs a writers' pool of at least " +
      lo.toLocaleString("en-US") + " Ink, enough for the story to reach the length where it can be finished.");
  }

  const balance = whole(input.inkBalance, "Ink balance", 0n);
  const starter = whole(input.starter, "starter Ink", 0n);
  const inkNeeded = cost + fund;
  if (textCheck.ok && inkNeeded > balance + starter) {
    problems.push(fund > 0n
      ? "You need " + inkNeeded + " Ink: " + cost + " for the first part and " + fund + " for the writers' pool. You have " + balance +
        ", and this open adds " + starter + " starter Ink. Buy an Ink pack on the Membership page, then come back."
      : "The opening text costs " + cost + " Ink. You have " + balance + ", and this open mints " + starter + " starter Ink.");
  }

  const basePrice = whole(input.price, "price", null);
  const multiplier = BigInt(Math.max(1, Number(input.multiplier || 1)));
  const price = basePrice == null ? null : basePrice * multiplier;
  const tokenBalance = whole(input.tokenBalance, "token balance", null);
  if (price == null || price === 0n) problems.push("Opening " + (isBook ? "a book" : "a short story") + " has no price in this token yet.");
  if (price != null && tokenBalance != null && tokenBalance < price) {
    problems.push("Your token balance is below the open price.");
  }

  return {
    ok: problems.length === 0,
    cost: cost.toString(),
    problems,
    price: price == null ? "0" : price.toString(),
    fund: fund.toString(),
    maxChars: openEnded ? "0" : maxChars == null ? "0" : maxChars.toString(),
  };
}

export function assessWriterBuy(input) {
  const problems = [];
  const price = whole(input.price, "price", null);
  const balance = whole(input.balance, "balance", null);
  if (input.paused) problems.push("The Shop is paused.");
  if (price == null || price === 0n) problems.push("A Writer month has no price in this token yet.");
  if (price != null && balance != null && balance < price) problems.push("Your token balance is below the Writer month price.");
  return { ok: problems.length === 0, problems, price: price == null ? "0" : price.toString() };
}

export function assessPromo(input) {
  const problems = [];
  const id = String(input.campaignId ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(id)) problems.push("This promo link is missing a campaign.");
  if (!input.hasLinkKey) problems.push("This promo link is missing its key. Open the full link you were given.");
  if (input.alreadyClaimed) problems.push("This wallet has already claimed a promo. A wallet can claim once, ever.");
  if (input.paused) problems.push("The Shop is paused.");
  if (input.promoEnabled === false) problems.push("Promo claims are turned off.");
  return { ok: problems.length === 0, problems };
}
