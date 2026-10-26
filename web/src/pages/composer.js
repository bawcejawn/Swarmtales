/**
 * The writing box: add the next part, or text between parts.
 */
import { encode, quoteCost, writerFlags } from "../chain.js";
import { shortAddress } from "../lib/money.js";
import { assessWrite, isActiveWriter } from "../lib/rules.js";
import { checkStoryText, inkCost, MAX_CHARS_PER_SIGNATURE, MAX_PARTS_PER_SIGNATURE, normalizePasted, splitIntoParts } from "../lib/text.js";
import { append, h, replace } from "../ui/dom.js";
import { grammarTool } from "../ui/grammar.js";
import { currentAddress, state } from "../app/state.js";
import { num } from "../app/format.js";
import { inviteOnly, minContribution, openEnded, termsVersion } from "../app/story.js";
import { aiToggle, citationField, connectButton, failure, field, loadingLine, notice, problemsNotice, rightsBox, statusBox, walletNote } from "../app/ui.js";
import { loadLibrary, refreshAccount } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

let composerCount = 0;

export function composer(id, story, active, insertAfter, flags) {
  const after = Number(insertAfter || 0);
  composerCount += 1;
  const uid = "compose-" + composerCount;
  const box = h("section", { class: "composer card" + (after ? " inline-panel" : ""), "aria-labelledby": uid + "-title" });
  const lastAuthor = active.length ? active[active.length - 1].segment.author : "";
  append(box, after
    ? h("h3", { class: "h3", id: uid + "-title" }, ["Add text after this part"])
    : h("h2", { class: "h2", id: uid + "-title" }, ["Write the next part"]));

  const status = Number(story.status);
  if (status !== 1) {
    append(box, h("p", { class: "body-2" }, [
      status === 4 ? "This story is finished. Thank you to everyone who wrote it."
        : status === 5 ? "This story was archived after a long quiet spell. It can still be read."
        : "This story is closed for new parts. It is moving through its final edit.",
    ]));
    return box;
  }
  append(box, h("p", { class: "body-2" }, after
    ? ["Your text is read right after the part above, before what comes next."]
    : [
      lastAuthor ? "Pick up where " + shortAddress(lastAuthor) + " left off. " : "",
      "Your part is added to the end of the story, or starts a new chapter. To add something in the middle, use “+ Add text here” under any part.",
    ]));

  const address = currentAddress();
  if (!address) {
    append(box, 
      h("p", { class: "body-2" }, ["Connect a wallet to write. Reading never needs one."]),
      h("div", { class: "actions" }, [connectButton("Connect a wallet to write"), h("a", { href: "#/how" }, ["New here? How writing works"])])
    );
    return box;
  }
  if (!state.overview || !state.account) {
    append(box, state.accountError ? notice("bad", h("p", {}, [state.accountError])) : loadingLine("Reading your Ink…"));
    return box;
  }
  const invited = story.opener === address || !!(flags && (flags.editor || flags.allowed));
  if (inviteOnly(story) && !invited) {
    append(box, h("p", { class: "body-2" }, [
      "Only people the opener invites can write in this story. If you'd like to join, ask the opener for an invite link. Anyone can read it.",
    ]));
    return box;
  }
  if (inviteOnly(story) && story.opener !== address && !isActiveWriter(state.account.membership, state.account.now)) {
    append(box,
      h("p", { class: "body-2" }, [
        "You're invited. To write here you need an active Writer month. The opener can pay for it from the Share & invite panel, or you can buy one yourself. Your parts are paid from the writers' pool while it lasts.",
      ]),
      h("div", { class: "actions" }, [h("a", { class: "btn btn-secondary", href: "#/membership" }, ["See Writer months"])])
    );
    return box;
  }
  if (state.account.blocked) {
    append(box, notice("warn", h("p", {}, ["This wallet can no longer write on SwarmTales, after repeated takedowns of copied text. ", h("a", { href: "#/terms" }, ["Terms of Use"])])));
    return box;
  }

  const area = h("textarea", { rows: after ? "5" : "8", spellcheck: "true", "aria-describedby": uid + "-count" });
  area.addEventListener("paste", () => setTimeout(() => {
    const tidy = normalizePasted(area.value);
    if (tidy !== area.value) {
      area.value = tidy;
      update();
    }
  }, 0));
  const chapter = h("input", { type: "checkbox" });
  const citation = citationField();
  const aiBox = aiToggle();
  const ai = aiBox.input;
  const costText = h("b", {}, ["0 Ink"]);
  const shortText = h("span");
  const space = Math.max(0, Number(story.max_chars || 0) - Number(story.used_chars || 0));
  const min = Number(minContribution());
  const cap = Number(state.overview.storiesCfg.contribution_cap || 6000);
  const rights = rightsBox();
  const splitNote = h("span");
  const partsFor = (text) => splitIntoParts(text, cap, min, inkCost(normalizePasted(text).trim()) === space);
  const list = h("div");
  const status2 = statusBox();
  const button = h("button", { type: "submit", class: "btn btn-primary" }, ["Sign and add to the story"]);

  function update() {
    const text = normalizePasted(area.value).trim();
    const parts = text ? partsFor(text) : [];
    const cost = parts.reduce((sum, p) => sum + inkCost(p), 0);
    costText.textContent = num(cost) + " Ink";
    const bad = parts.map((p) => checkStoryText(p, true)).find((c) => !c.ok);
    if (!text) shortText.textContent = min ? "At least " + min + " characters" : "";
    else if (bad) shortText.textContent = bad.reason;
    else if (min && cost < min && cost !== space) shortText.textContent = num(min - cost) + " more to reach the " + min + "-character minimum";
    else shortText.textContent = "";
    splitNote.textContent = parts.length > 1
      ? "Long text: it will be added as " + parts.length + " parts in a row" +
        (parts.length > MAX_PARTS_PER_SIGNATURE || cost > MAX_CHARS_PER_SIGNATURE
          ? ". That's more than " + num(MAX_CHARS_PER_SIGNATURE) + " characters at once; send the first part of it, then the rest."
          : ", with one confirmation.")
      : "";
  }
  area.addEventListener("input", update);
  update();

  const form = h("form", { onSubmit: (event) => { event.preventDefault(); go(); } }, [
    after ? null : writingHelp(),
    field("Your part", area),
    grammarTool(area, () => update()),
    h("div", { class: "counter", id: uid + "-count" }, [
      costText,
      inviteOnly(story)
        ? h("span", {}, ["Paid from the writers' pool (" + num(story.fund || 0) + " Ink left) while it has enough; then from your own " + num(state.account.ink) + " Ink"])
        : h("span", {}, ["You have " + num(state.account.ink) + " Ink"]),
      openEnded(story) ? null : h("span", {}, [num(space) + " characters left in this story"]),
      h("span", { "aria-live": "polite" }, [shortText]),
      h("span", { "aria-live": "polite" }, [splitNote]),
    ]),
    h("label", { class: "check" }, [chapter, "Start a new chapter"]),
    citation.node,
    aiBox.node,
    rights.node,
    list,
    h("div", { class: "actions" }, [button, h("p", { class: "meta" }, ["Your wallet asks you to confirm. The Ink is used once your part is added."])]),
    walletNote(),
    status2,
  ]);
  append(box, form);

  async function go() {
    list.replaceChildren();
    status2.replaceChildren();
    button.disabled = true;
    try {
      const flags = await writerFlags(id, address);
      const text = normalizePasted(area.value).trim();
      area.value = text;
      const parts = partsFor(text);
      if (parts.length > MAX_PARTS_PER_SIGNATURE || inkCost(text) > MAX_CHARS_PER_SIGNATURE) {
        append(list, problemsNotice(["That's more than " + num(MAX_CHARS_PER_SIGNATURE) + " characters at once. Send the first part of your text, then the rest."]));
        return;
      }
      if (new Set(parts).size !== parts.length) {
        append(list, problemsNotice(["Two of the parts would be exactly the same text. Each part has to be new."]));
        return;
      }
      // Check each part in order, as the contract will.
      let used = BigInt(story.used_chars || "0");
      let balance = BigInt(state.account.ink || "0");
      let pool = BigInt(story.fund || "0");
      let trialUsed = BigInt(state.account.trial || "0");
      const plans = [];
      for (const part of parts.length ? parts : [""]) {
        const plan = assessWrite({
          text: part,
          cap: state.overview.storiesCfg.contribution_cap,
          maxChars: story.max_chars,
          usedChars: used.toString(),
          balance: balance.toString(),
          status: story.status,
          visibility: story.visibility,
          privileged: story.opener === address || flags.editor,
          isOpener: story.opener === address,
          allowed: flags.allowed,
          fund: pool.toString(),
          writerActive: isActiveWriter(state.account.membership, state.account.now),
          promoClaimed: state.account.promo !== "0",
          trialUsed: trialUsed.toString(),
          trialLimit: state.overview.storiesCfg.trial_limit,
          minContribution: minContribution(),
          rightsConfirmed: rights.input.checked,
          blocked: state.account.blocked,
        });
        if (!plan.ok) {
          const where = parts.length > 1 ? ["Part " + (plans.length + 1) + " of " + parts.length + ":"] : [];
          append(list, problemsNotice(where.concat(plan.problems)));
          if (plan.problems.some((p) => /Writer month|Ink balance|Trial/.test(p))) {
            append(list, h("p", { class: "meta" }, [h("a", { href: "#/membership" }, ["Get more Ink on the Membership page"])]));
          }
          return;
        }
        plans.push(plan);
        const cost = BigInt(plan.cost);
        used += cost;
        if (plan.fundPays) pool -= cost;
        else balance -= cost;
        if (plan.usesTrial) trialUsed += cost;
      }
      status2.textContent = "Checking the Ink count with the story contract…";
      const quoted = await Promise.all(parts.map((part) => quoteCost(part)));
      const mismatch = quoted.findIndex((q, i) => q !== plans[i].cost);
      if (mismatch >= 0) {
        replace(status2, notice("warn", h("p", {}, ["The network counted " + quoted[mismatch] + " Ink and this page counted " + plans[mismatch].cost + ". Nothing was signed."])));
        return;
      }
      const ops = [];
      for (let i = 0; i < parts.length; i++) {
        ops.push(await encode("stories", "contribute", {
          author: address,
          story_id: String(id),
          text: parts[i],
          starts_chapter: i === 0 && chapter.checked,
          ai_assisted: ai.checked,
          expected_ink: plans[i].cost,
          rights_confirmed: true,
          terms_version: termsVersion(),
          // Later pieces of a split addition follow the piece before them.
          insert_after: i === 0 ? String(after) : "0",
          after_my_last: i > 0 && after > 0,
          citation: citation.value(),
        }));
      }
      const sent = await send(ops, status2);
      if (sent) {
        area.value = "";
        update();
        state.excerpts.delete(Number(id));
        loadLibrary(true).catch(() => {});
        await refreshAccount();
        renderPage();
      }
    } catch (error) {
      failure(status2, error);
    } finally {
      button.disabled = false;
    }
  }
  return box;
}

/** A short guide shown above the writing box. */
function writingHelp() {
  return h("details", { class: "more-options writing-help" }, [
    h("summary", {}, ["How adding and editing work"]),
    h("ul", { class: "how-list" }, [
      h("li", {}, [h("b", {}, ["Add at the end."]), " Use this box. Your part goes after everything written so far. Tick “Start a new chapter” to begin one."]),
      h("li", {}, [h("b", {}, ["Add in the middle."]), " Click “+ Add text here” under any part. Your text appears directly below that part, before what came next. Anyone who can write here can do this."]),
      h("li", {}, [h("b", {}, ["Your own part."]), " Reword it for free; letters beyond its current length cost 1 Ink each. You can always shorten it: the Ink comes back to you, unless someone else has changed the part (then removing the whole part returns what you paid). Removing it is free."]),
      h("li", {}, [h("b", {}, ["Someone else's part."]), " Change it with \u201cChange\u201d: you pay for every letter you add or remove (at least 10), \u00d72. Each change to the same part doubles that: \u00d74, \u00d78\u2026 You always pay yourself, never the story's pool. Removing the whole part gives its writer back what they paid, and every earlier version stays readable. The opener and editors pay too; only the final edit is free."]),
      h("li", {}, [h("b", {}, ["Spelling and grammar."]), " Press \u201cCheck spelling & grammar\u201d before you post. Anything missed can be fixed in the final edit."]),
      h("li", {}, [h("b", {}, ["Quoting someone?"]), " Open \u201cQuoting someone? Name the source\u201d and write the book or site. It shows under your part, and the copy checker leaves named quotes alone."]),
      h("li", {}, [h("b", {}, ["Ink."]), " 1 Ink per letter. In public stories every writer pays for their own words. In private stories the opener's writers' pool pays for new parts while it has enough; changes, and letters added to an existing part, are paid by whoever makes them. Long text is split into parts automatically."]),
    ]),
  ]);
}
