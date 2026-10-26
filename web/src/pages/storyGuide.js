/**
 * Story guide: "the story so far" summary and the automatic character list.
 */
import { encode } from "../chain.js";
import { formatUtc, shortAddress } from "../lib/money.js";
import { append, h } from "../ui/dom.js";
import { findCharacters, openingLines } from "../lib/characters.js";
import { plural } from "../app/format.js";
import { inviteOnly } from "../app/story.js";
import { failure, statusBox } from "../app/ui.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

/**
 * Story guide: "the story so far" (kept by the opener, editors and current writers;
 * Chrome's free built-in AI can draft it) and an automatic character list.
 */
export function storyGuide(id, story, chapters, me, flags, writers) {
  const chapterTexts = chapters.map((c) => ({
    number: c.number,
    text: c.blocks.filter((b) => !b.segment.hidden).map((b) => b.segment.text || "").join("\n"),
  }));
  const characters = findCharacters(chapterTexts);
  // The contract's rule (AB-034): the opener, an editor, or a writer whose
  // writing is still in the story and, in an invite-only story, who is still
  // on its allow-list; only while the story is open, locked or in its final edit.
  const stillMember = !inviteOnly(story) || !!(flags && flags.allowed);
  const canEdit = !!me && [1, 2, 3].includes(Number(story.status)) &&
    (story.opener === me || (flags && flags.editor) || (stillMember && writers.some(([a, n]) => a === me && Number(n || 0) > 0)));
  const summaryText = h("p", { class: "body-2 small guide-summary" }, [story.summary || "No summary yet."]);
  const box = h("section", { class: "card story-guide", "aria-labelledby": "guide-title" }, [
    h("h2", { class: "aside-title", id: "guide-title" }, ["Story guide"]),
    h("h3", { class: "guide-h" }, ["The story so far"]),
    summaryText,
    story.summary_by ? h("p", { class: "meta small" }, ["Updated by " + shortAddress(story.summary_by) + (formatUtc(story.summary_at) ? " \u00b7 " + formatUtc(story.summary_at).split(",")[0] : "")]) : null,
  ]);
  if (canEdit) {
    const area = h("textarea", { rows: "6", maxlength: "1500" });
    area.value = story.summary || "";
    const status = statusBox();
    const aiNote = h("p", { class: "meta small", "aria-live": "polite" });
    const draftAi = h("button", { type: "button", class: "btn btn-secondary btn-small", hidden: true }, ["Draft with built-in AI"]);
    const draftPlain = h("button", { type: "button", class: "text-button" }, ["Start from each chapter's first line"]);
    draftPlain.addEventListener("click", () => { area.value = openingLines(chapterTexts); });
    // Chrome's on-device Summarizer: free, nothing leaves the computer.
    if (typeof self !== "undefined" && "Summarizer" in self) {
      self.Summarizer.availability().then((a) => { if (a && a !== "unavailable") draftAi.hidden = false; }).catch(() => {});
      draftAi.addEventListener("click", async () => {
        draftAi.disabled = true;
        aiNote.textContent = "Writing a draft on this computer\u2026 (the first time, Chrome may download its AI model)";
        try {
          const summarizer = await self.Summarizer.create({ type: "tldr", format: "plain-text", length: "long", sharedContext: "A chapter-by-chapter collaborative story." });
          let text = chapterTexts.map((c) => "Chapter " + c.number + ".\n" + c.text).join("\n\n");
          const quota = summarizer.inputQuota || 0;
          if (quota && text.length > quota * 3) text = text.slice(-quota * 3);
          const draft = await summarizer.summarize(text);
          area.value = String(draft || "").slice(0, 1500);
          aiNote.textContent = "Draft ready. Check it, change anything, then save.";
        } catch (error) {
          aiNote.textContent = "The built-in AI couldn't write a draft here (" + (error && error.message ? error.message : "not available") + ").";
        } finally {
          draftAi.disabled = false;
        }
      });
    }
    const save = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Save summary"]);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const op = await encode("stories", "set_story_summary", { account: me, story_id: String(id), summary: area.value.trim() });
        if (await send([op], status)) renderPage();
      } catch (error) {
        failure(status, error);
      } finally {
        save.disabled = false;
      }
    });
    append(box, h("details", { class: "more-options guide-edit" }, [
      h("summary", {}, [story.summary ? "Update the summary" : "Write the summary"]),
      h("p", { class: "meta small" }, ["The opener, editors and anyone who has written here can keep this up to date. Up to 1,500 characters."]),
      area,
      h("div", { class: "row" }, [draftAi, draftPlain]),
      aiNote,
      h("div", { class: "actions" }, [save]),
      status,
    ]));
  }
  append(box,
    h("h3", { class: "guide-h" }, ["Characters"]),
    characters.length
      ? h("ul", { class: "character-list" }, characters.map((c) => h("li", {}, [
        h("b", {}, [c.name]),
        h("span", { class: "meta small" }, [" \u00b7 " + plural(c.count, "mention") + " \u00b7 from Chapter " + c.firstChapter]),
      ])))
      : h("p", { class: "meta small" }, ["Names appear here as the story mentions them."]),
    h("p", { class: "meta small" }, ["Found automatically in the text, so it can miss or mix up a name."]));
  return box;
}
