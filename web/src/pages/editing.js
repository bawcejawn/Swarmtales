/**
 * Changing parts: the writer's own edit, a paid change to someone else's
 * part, and removal.
 */
import { encode, quoteCost } from "../chain.js";
import { shortAddress } from "../lib/money.js";
import { RIGHTS_PROBLEM } from "../lib/rules.js";
import { checkStoryText, inkCost, normalizePasted } from "../lib/text.js";
import { h } from "../ui/dom.js";
import { grammarTool } from "../ui/grammar.js";
import { changePrice, editorChanged, editPrice, hiddenByReports, refundSplit, removalRefunds } from "../lib/change.js";
import { currentAddress, state } from "../app/state.js";
import { num } from "../app/format.js";
import { termsVersion } from "../app/story.js";
import { aiToggle, citationField, failure, rightsBox, statusBox, walletNote } from "../app/ui.js";
import { refreshAccount } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

/**
 * The writer edits their own part: rewording is free, letters beyond its
 * current length cost 1 Ink each (the writer pays, never the pool), and
 * shortening is always allowed. A cut returns only Ink the writer (or the
 * pool) paid for the part, also after someone else changed it.
 */
export function editPanel(storyId, block, active) {
  const seg = block.segment;
  const rights = rightsBox();
  const area = h("textarea", { rows: "6", spellcheck: "true" });
  area.value = seg.text || "";
  const counter = h("p", { class: "meta" });
  const save = h("button", { type: "submit", class: "btn btn-primary btn-small" }, ["Save edit"]);
  const update = () => {
    const text = normalizePasted(area.value).trim();
    const p = editPrice(seg, text);
    const back = p.refund ? num(p.toWriter) + " Ink comes back to you" + (p.toPool ? " and " + num(p.toPool) + " to the story's pool" : "") + "." : "";
    let line = num(inkCost(text)) + " characters (now " + num(seg.current_cost) + "). ";
    if (!editorChanged(seg.text, area.value, normalizePasted)) line += "Rewording is free; added letters cost 1 Ink each.";
    else if (p.cost) line += "The " + num(p.cost) + " added letters cost " + num(p.cost) + " Ink, paid by you." + (back ? " " + back : "");
    else if (p.refund) line += back;
    else if (seg.refund_forfeited && inkCost(text) < Number(seg.current_cost || 0)) line += "Free. This part was restored after the copy checker hid it, so no Ink comes back.";
    else if (inkCost(text) < Number(seg.current_cost || 0)) line += "Free. The cut letters were added by someone else, so no Ink comes back.";
    else line += "Free.";
    counter.textContent = line;
    save.textContent = p.cost ? "Save edit for " + num(p.cost) + " Ink" : "Save edit";
  };
  area.addEventListener("input", update);
  update();
  const status = statusBox();
  return h("form", { class: "inline-panel card", onSubmit: async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const text = normalizePasted(area.value).trim();
      const check = checkStoryText(text, true);
      if (!check.ok) throw new Error(check.reason);
      if (text === seg.text || !editorChanged(seg.text, area.value, normalizePasted)) throw new Error("Nothing has changed yet.");
      if (sameTextElsewhere(active, block.seq, text)) throw new Error(SAME_TEXT);
      // An edit is new text too: the same confirmation as a new part (F-04).
      if (!rights.input.checked) throw new Error(RIGHTS_PROBLEM);
      const p = editPrice(seg, text);
      if (p.cost && state.account && Number(state.account.ink || 0) < p.cost) {
        throw new Error("The added letters cost " + num(p.cost) + " Ink and you have " + num(state.account.ink) + ".");
      }
      const quoted = await quoteCost(text);
      const op = await encode("stories", "edit_segment", {
        editor: currentAddress(),
        story_id: String(storyId),
        seq: String(block.seq),
        new_text: text,
        expected_cost: quoted,
        // The price shown above: if the part changed since and the edit would
        // cost more, the contract refuses it instead of charging (AB-049).
        max_ink: String(p.cost),
        rights_confirmed: true,
        terms_version: termsVersion(),
      });
      if (await send([op], status)) {
        if (p.cost || p.toWriter) await refreshAccount();
        renderPage();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      save.disabled = false;
    }
  } }, [
    h("h3", { class: "h3" }, ["Edit your part"]),
    h("p", { class: "meta" }, ["Rewording your own words is free; letters beyond the part's current length cost 1 Ink each. Every edit is kept in the part's history, and readers see a small \u201cedited\u201d note."]),
    area,
    counter,
    rights.node,
    h("div", { class: "actions" }, [save]),
    walletNote(),
    status,
  ]);
}

/**
 * Change (or remove) someone else's part. Price: the letters you add plus
 * the letters you remove (at least 10), times 2, doubling with every paid
 * change to that part. You always pay, never the story's pool. The writer
 * keeps the part; a cut returns them only what they paid beyond the new
 * length, and removing it returns what they (or the pool) paid. Every version stays
 * readable, with your source and AI-help note on yours.
 */
export function changePanel(storyId, story, block, active) {
  const seg = block.segment;
  const oldText = seg.text || "";
  const area = h("textarea", { rows: "7", spellcheck: "true" });
  area.value = oldText;
  const price = h("p", { class: "change-price" });
  const rights = rightsBox();
  const status = statusBox();
  const save = h("button", { type: "submit", class: "btn btn-primary btn-small" }, ["Save change"]);
  const removeAll = h("button", { type: "button", class: "text-button" }, []);
  const citation = citationField();
  const aiBox = aiToggle();
  // Sent as typed: the contract keeps edge spaces, so trimming here would price
  // a one-letter fix as rewriting the whole part (AB-065).
  const current = () => normalizePasted(area.value);
  const update = () => {
    const text = current();
    const p = changePrice(oldText, text, seg.paid_changes, seg.charged, seg.refund_forfeited);
    const whose = shortAddress(seg.author);
    if (!editorChanged(oldText, area.value, normalizePasted)) {
      price.textContent = "Make your change above. You pay for the letters you add and remove (at least 10), \u00d7" + p.multiplier + " for this part.";
      save.textContent = "Save change";
      save.disabled = true;
    } else {
      price.textContent = "You add " + num(p.added) + " and remove " + num(p.removed) + " letters: " + num(p.units) + " \u00d7 " + p.multiplier +
        " = " + num(p.price) + " Ink." + refundLine(seg, p.refund, whose, " for the removed letters") +
        " The next change to this part will cost \u00d7" + p.multiplier * 2n + ".";
      save.textContent = "Change for " + num(p.price) + " Ink";
      save.disabled = false;
    }
    const r = changePrice(oldText, "", seg.paid_changes, seg.charged, seg.refund_forfeited);
    // As the contract: a paid removal gives back what the writer paid, unless
    // its checker hide was undone (AB-068).
    r.refund = removalRefunds(seg) ? Number(seg.charged || 0) : 0;
    removeAll.textContent = "Remove the whole part instead (" + num(r.price) + " Ink" + (r.refund ? ";" + refundLine(seg, r.refund, whose, "").replace(/\.$/, "") : "") + ")";
  };
  area.addEventListener("input", update);
  update();
  const submit = async (text) => {
    save.disabled = true;
    try {
      if (text) {
        const check = checkStoryText(text, true);
        if (!check.ok) throw new Error(check.reason);
      }
      if (text === oldText || (text && !editorChanged(oldText, area.value, normalizePasted))) throw new Error("Change the text first.");
      if (text && sameTextElsewhere(active, block.seq, text)) throw new Error(SAME_TEXT);
      if (!rights.input.checked) throw new Error(RIGHTS_PROBLEM);
      const p = changePrice(oldText, text, seg.paid_changes, seg.charged, seg.refund_forfeited);
      // The changer always pays; the story's pool never pays for changes.
      if (state.account && Number(state.account.ink || 0) < p.price) {
        throw new Error("This costs " + num(p.price) + " Ink and you have " + num(state.account.ink) + ".");
      }
      const op = await encode("stories", "revise_part", {
        writer: currentAddress(), story_id: String(storyId), seq: String(block.seq), text,
        expected_ink: String(p.price), rights_confirmed: true, terms_version: termsVersion(),
        citation: text ? citation.value() : "", ai_assisted: !!text && aiBox.input.checked,
      });
      if (await send([op], status)) {
        await refreshAccount();
        renderPage();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      save.disabled = false;
    }
  };
  removeAll.addEventListener("click", () => submit(""));
  return h("form", { class: "inline-panel card", onSubmit: (event) => { event.preventDefault(); submit(current()); } }, [
    h("h3", { class: "h3" }, ["Change this part"]),
    h("p", { class: "meta" }, [
      "The part stays " + shortAddress(seg.author) + "'s, and the current version stays readable in its history. " +
        "Every change to someone else's words costs you Ink (a story's pool never pays for changes), and each change to the same part costs twice the last.",
    ]),
    area,
    grammarTool(area, update),
    price,
    citation.node,
    aiBox.node,
    rights.node,
    h("div", { class: "actions" }, [save, removeAll]),
    walletNote(),
    status,
  ]);
}

/** "Version 3 · earlier versions": loads a part's history when opened. */
/** Who made a kept version of a part, in words (kinds as in stories.proto). */
/**
 * " <writer> gets N Ink back<why>." In a part the story's pool paid for, the
 * writer gets back only what they paid themselves (own_paid) and the rest
 * goes to the pool, as the contract's settleRefund does (AB-055).
 */
function refundLine(seg, refund, whose, why) {
  if (!refund) return "";
  const { toWriter, toPool } = refundSplit(seg, refund);
  const parts = [];
  if (toWriter) parts.push(whose + " gets " + num(toWriter) + " Ink back");
  if (toPool) parts.push(num(toPool) + " Ink goes back to the story's pool");
  return " " + parts.join(" and ") + why + ".";
}

const SAME_TEXT = "That exact text is already in this story. Each part has to be new.";

/** As the contract: the same exact text can't be in one story twice (in another part that isn't removed). */
function sameTextElsewhere(active, seq, text) {
  return (active || []).some((b) => b.seq !== seq && Number(b.segment.status) !== 2 && b.segment.text === text);
}

export function removePanel(storyId, block) {
  const seg = block.segment;
  const byWriter = seg.author === currentAddress();
  const status = statusBox();
  const confirm = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Remove this part"]);
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      const op = await encode("stories", "remove_segment", { editor: currentAddress(), story_id: String(storyId), seq: String(block.seq) });
      if (await send([op], status)) renderPage();
    } catch (error) {
      failure(status, error);
    } finally {
      confirm.disabled = false;
    }
  });
  // As remove_segment: a part hidden by writer reports alone is refunded, one
  // the admin or the checker hid is not, and in a pool-paid part only what the
  // writer paid themselves goes back to them (AB-065).
  const refund = removalRefunds(seg) ? Number(seg.charged || 0) : 0;
  let what;
  if (refund) what = refundLine(seg, refund, byWriter ? "You" : shortAddress(seg.author), "").trim().replace(/^You gets /, "You get ");
  else if (seg.hidden && !hiddenByReports(seg)) what = "This part is hidden while it's checked, so its Ink isn't returned.";
  else if (seg.refund_forfeited) what = "This part was restored after the copy checker hid it, so its Ink isn't returned.";
  else what = "No Ink comes back: none was paid for it that hasn't been returned.";
  const why = byWriter ? "" : "Writer reports hid this part. As the story's opener or an editor you can remove it; its writer still gets back what they paid. ";
  return h("div", { class: "inline-panel card" }, [
    h("h3", { class: "h3" }, [byWriter ? "Remove this part?" : "Remove this reported part?"]),
    h("p", { class: "body-2" }, [why + what + " The removal is recorded on the public record, and what the part said stays readable in its history."]),
    h("div", { class: "actions" }, [confirm]),
    walletNote(),
    status,
  ]);
}
