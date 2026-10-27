/**
 * Suggested changes (Wave 2): propose an edit to someone else's part for
 * free; the part's writer sees exactly what would change and accepts (as
 * their own edit: they pay for added letters) or declines with a note.
 * Inspired by Ellipsus' drafts and Google Docs' suggestion mode, without
 * anyone's words being overwritten without their say.
 */
import { contracts } from "../config.js";
import { encode, quoteCost, read } from "../chain.js";
import { shortAddress, formatUtc } from "../lib/money.js";
import { RIGHTS_PROBLEM } from "../lib/rules.js";
import { checkStoryText, inkCost, normalizePasted } from "../lib/text.js";
import { editPrice, editorChanged } from "../lib/change.js";
import { diffCounts, wordDiff } from "../lib/diff.js";
import { clearDraft, draftKey, loadDraft, saveDraft } from "../lib/drafts.js";
import { h, replace } from "../ui/dom.js";
import { grammarTool } from "../ui/grammar.js";
import { currentAddress, state } from "../app/state.js";
import { num, plural } from "../app/format.js";
import { termsVersion } from "../app/story.js";
import { aiToggle, citationField, failure, field, notice, rightsBox, statusBox, walletNote } from "../app/ui.js";
import { refreshAccount } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

import { isCurrent, MAX_PENDING_SUGGESTIONS, MAX_SUGGESTIONS, SUGGESTION_STATUS as STATUS, suggestionActions } from "../lib/suggest.js";

export { MAX_SUGGESTIONS };

/** Every suggestion on a part, oldest first (a few per read, like versions). */
export async function readSuggestions(storyId, seq, count) {
  const out = [];
  let from = 1;
  for (let guard = 0; from && guard < 10; guard++) {
    const page = await read("stories", "get_suggestions", { story_id: String(storyId), seq: String(seq), from, count: 5 });
    const values = (page && page.values) || [];
    out.push(...values);
    from = Number((page && page.next) || 0);
    if (!values.length) break;
  }
  return out.slice(0, Number(count || out.length));
}

/** The diff of a suggestion against the part's text now: added words green, removed struck through. */
export function diffView(before, after) {
  const pieces = wordDiff(before, after);
  const { added, removed } = diffCounts(pieces);
  return h("div", { class: "suggestion-diff" }, [
    h("p", { class: "meta small" }, ["+" + added + " words, −" + removed + " words"]),
    h("p", { class: "version-text diff" }, pieces.map((p) => p.op === "same" ? p.text : h(p.op === "add" ? "ins" : "del", {}, [p.text]))),
  ]);
}

/** Write a suggestion for someone else's part. Free; the writer decides. */
export function suggestPanel(storyId, block) {
  const seg = block.segment;
  const area = h("textarea", { rows: "7", spellcheck: "true" });
  const key = draftKey(contracts.stories, storyId, "s" + block.seq);
  const kept = loadDraft(key);
  area.value = kept ? kept.text : seg.text || "";
  const citation = citationField();
  const aiBox = aiToggle();
  const rights = rightsBox();
  const preview = h("div");
  const status = statusBox();
  const button = h("button", { type: "submit", class: "btn btn-primary btn-small" }, ["Send suggestion (free)"]);
  let timer = null;
  const update = () => {
    const text = normalizePasted(area.value).trim();
    replace(preview, text && text !== seg.text ? diffView(seg.text || "", text) : h("p", { class: "meta small" }, ["Change the text above to see what your suggestion changes."]));
    clearTimeout(timer);
    timer = setTimeout(() => saveDraft(key, area.value === (seg.text || "") ? "" : area.value), 600);
  };
  area.addEventListener("input", update);
  update();
  return h("form", { class: "inline-panel card", onSubmit: async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const text = normalizePasted(area.value).trim();
      const check = checkStoryText(text, true);
      if (!check.ok) throw new Error(check.reason);
      if (text === seg.text || !editorChanged(seg.text, area.value, normalizePasted)) throw new Error("Change the text first: that's the part as it is.");
      if (!rights.input.checked) throw new Error(RIGHTS_PROBLEM);
      if (Number(seg.pending_suggestions || 0) >= MAX_PENDING_SUGGESTIONS) throw new Error("This part already has " + MAX_PENDING_SUGGESTIONS + " suggestions waiting for its writer. Try again after they answer.");
      await quoteCost(text);
      const op = await encode("stories", "suggest_change", {
        proposer: currentAddress(),
        story_id: String(storyId),
        seq: String(block.seq),
        text,
        citation: citation.value(),
        ai_assisted: aiBox.input.checked,
        rights_confirmed: true,
        terms_version: termsVersion(),
      });
      if (await send([op], status)) {
        clearDraft(key);
        renderPage();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      button.disabled = false;
    }
  } }, [
    h("h3", { class: "h3" }, ["Suggest a change"]),
    h("p", { class: "meta" }, ["It's free. " + shortAddress(seg.author) + " sees exactly what you changed and decides: if they accept, the part keeps their name and its history says you suggested it. Nothing changes unless they say yes."]),
    area,
    grammarTool(area, () => update()),
    preview,
    citation.node,
    aiBox.node,
    rights.node,
    h("div", { class: "actions" }, [button]),
    walletNote(),
    status,
  ]);
}

/**
 * The suggestions on a part: the writer accepts or declines the waiting
 * ones; the proposer can withdraw theirs; everyone sees what was suggested
 * and how it ended (it's all on the public record).
 */
export function suggestionsView(storyId, story, block) {
  const seg = block.segment;
  const total = Number(seg.suggestion_count || 0);
  const waiting = Number(seg.pending_suggestions || 0);
  const list = h("div", { class: "suggestion-list" });
  const box = h("details", { class: "edit-note suggestions" + (waiting ? " has-waiting" : "") }, [
    h("summary", {}, [waiting ? plural(waiting, "suggestion") + " waiting" : plural(total, "suggestion")]),
    list,
  ]);
  let loaded = false;
  box.addEventListener("toggle", async () => {
    if (!box.open || loaded) return;
    loaded = true;
    list.replaceChildren(h("p", { class: "meta small" }, ["Loading…"]));
    try {
      const all = await readSuggestions(storyId, block.seq, total);
      const me = currentAddress();
      const open = Number(story.status) === 1;
      const items = all.slice().reverse().map((s) => suggestionItem(storyId, block, s, me, open));
      list.replaceChildren(...(items.length ? items : [h("p", { class: "meta small" }, ["No suggestions yet."])]));
    } catch (error) {
      list.replaceChildren(h("p", { class: "meta small" }, [String(error && error.message ? error.message : error)]));
    }
  });
  return box;
}

function suggestionItem(storyId, block, s, me, storyOpen) {
  const seg = block.segment;
  const isWaiting = Number(s.status) === 0;
  const current = isCurrent(s, seg);
  const status = statusBox();
  const head = h("p", { class: "meta small" }, [
    "#" + s.id + " by " + shortAddress(s.proposer) + (formatUtc(s.at) ? " · " + formatUtc(s.at).split(",")[0] : "") + " · " +
      (isWaiting ? (current ? "waiting for " + shortAddress(seg.author) : "out of date (the part changed since)") : STATUS[Number(s.status)] || "closed"),
  ]);
  const parts = [head];
  if (Number(s.status) === 4) parts.push(h("p", { class: "seg-placeholder" }, ["Removed by moderation."]));
  else parts.push(isWaiting && current ? diffView(seg.text || "", s.text || "") : h("p", { class: "version-text" }, [s.text || ""]));
  if (s.citation) parts.push(h("p", { class: "source-note" }, ["Source: " + s.citation]));
  if (s.ai_assisted) parts.push(h("span", { class: "tag-ai" }, ["Written with AI help"]));
  if (s.note) parts.push(h("p", { class: "meta small" }, ["Reply: " + s.note]));
  const actions = h("div", { class: "row" });
  const can = suggestionActions(s, seg, me, storyOpen);
  if (can.length) {
    if (can.includes("accept")) {
      const p = editPrice(seg, s.text || "");
      const accept = h("button", { type: "button", class: "btn btn-primary btn-small" }, [p.cost ? "Accept (" + num(p.cost) + " Ink)" : "Accept"]);
      const rights = rightsBox();
      accept.addEventListener("click", async () => {
        accept.disabled = true;
        try {
          if (!rights.input.checked) throw new Error(RIGHTS_PROBLEM);
          if (p.cost && state.account && Number(state.account.ink || 0) < p.cost) {
            throw new Error("The added letters cost " + num(p.cost) + " Ink and you have " + num(state.account.ink) + ".");
          }
          const op = await encode("stories", "accept_suggestion", {
            writer: me, story_id: String(storyId), seq: String(block.seq), id: Number(s.id),
            expected_cost: String(inkCost(s.text || "")), max_ink: String(p.cost), rights_confirmed: true, terms_version: termsVersion(),
          });
          if (await send([op], status)) {
            if (p.cost || p.toWriter) await refreshAccount();
            renderPage();
          }
        } catch (error) {
          failure(status, error);
        } finally {
          accept.disabled = false;
        }
      });
      parts.push(h("p", { class: "meta small" }, [p.cost
        ? "Accepting works like your own edit: the " + num(p.cost) + " added letters cost " + num(p.cost) + " Ink, paid by you. The part stays yours."
        : "Accepting works like your own edit and is free here. The part stays yours."]), rights.node);
      actions.append(accept);
    }
    if (can.includes("decline") || can.includes("withdraw") || can.includes("close")) {
      const note = h("input", { type: "text", maxlength: "200", placeholder: "Optional reply (e.g. why not)" });
      const label = me === seg.author ? "Decline" : me === s.proposer ? "Withdraw" : "Close (out of date)";
      const btn = h("button", { type: "button", class: "btn btn-secondary btn-small" }, [label]);
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const op = await encode("stories", "decline_suggestion", {
            account: me, story_id: String(storyId), seq: String(block.seq), id: Number(s.id), note: me === seg.author ? note.value.trim() : "",
          });
          if (await send([op], status)) renderPage();
        } catch (error) {
          failure(status, error);
        } finally {
          btn.disabled = false;
        }
      });
      if (me === seg.author) parts.push(field("Reply", note));
      actions.append(btn);
    }
  }
  if (actions.childNodes.length) parts.push(actions, walletNote(), status);
  return h("div", { class: "suggestion-item" }, parts);
}

/** "Seeking writers" and the blind round, in plain words for the story page. */
export function guideNotice(story) {
  const out = [];
  if (story.blind && Number(story.status) === 1) {
    out.push(notice("info", h("p", {}, ["Blind round: each writer sees only the newest part, then writes what comes next. The whole story is revealed when it's finished."])));
  }
  return out;
}
