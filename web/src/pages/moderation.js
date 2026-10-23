/**
 * Reports and hidden parts: the per-part Report form, the help under a hidden
 * part, and the note on finished books (reported off-chain).
 */
import { SITE } from "../config.js";
import { encode, hasReported } from "../chain.js";
import { checkStoryText, normalizePasted } from "../lib/text.js";
import { append, h, replace } from "../ui/dom.js";
import { HIDDEN_BY_ADMIN } from "../lib/change.js";
import { currentAddress } from "../app/state.js";
import { connectButton, failure, field, statusBox } from "../app/ui.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

export const REASON_LABELS = {
  1: "copied from someone else's work",
  2: "a duplicate of text already on SwarmTales",
  3: "spam",
  4: "unlawful or abusive content",
  5: "a policy problem",
};

/** "Report" under a part: a small form that logs the report on the blockchain. */
export function reportControl(storyId, seq) {
  const wrap = h("span", { class: "report" });
  const open = h("button", { type: "button", class: "text-button report-toggle", "aria-expanded": "false" }, ["Report"]);
  append(wrap, open);
  open.addEventListener("click", async () => {
    if (wrap.querySelector(".report-form")) {
      wrap.querySelector(".report-form").remove();
      open.setAttribute("aria-expanded", "false");
      return;
    }
    open.setAttribute("aria-expanded", "true");
    const panel = h("div", { class: "report-form card" });
    append(wrap, panel);
    const address = currentAddress();
    if (!address) {
      append(panel,
        h("p", { class: "body-2" }, ["Connect a wallet to report this part. Reports are recorded on the blockchain."]),
        h("div", { class: "row" }, [connectButton(), h("a", { href: "#/report" }, ["Own the copyright? Send a notice instead"])])
      );
      return;
    }
    if (await hasReported(storyId, seq, address).catch(() => false)) {
      append(panel, h("p", { class: "body-2" }, ["You've already reported this part. Thank you."]));
      return;
    }
    const reason = h("select", {}, [
      h("option", { value: "1" }, ["Copied from someone else's work"]),
      h("option", { value: "3" }, ["Spam"]),
      h("option", { value: "4" }, ["Unlawful or abusive"]),
      h("option", { value: "5" }, ["Something else"]),
    ]);
    const note = h("input", { type: "text", maxlength: "200", placeholder: "Optional: where it's copied from, or what's wrong" });
    const status = statusBox();
    const sendButton = h("button", { type: "submit", class: "btn btn-secondary btn-small" }, ["Send report"]);
    append(panel, h("form", { onSubmit: async (event) => {
      event.preventDefault();
      sendButton.disabled = true;
      try {
        const clean = normalizePasted(note.value).replace(/\n/g, " ").trim();
        if (clean && !checkStoryText(clean, false).ok) throw new Error("The note has characters that aren't allowed. Use plain text.");
        const op = await encode("stories", "report_segment", {
          reporter: address,
          story_id: String(storyId),
          seq: String(seq),
          reason: Number(reason.value),
          note: clean,
        });
        const sent = await send([op], status);
        if (sent) replace(panel, h("p", { class: "body-2" }, ["Reported. Thank you. If enough writers report it, it's hidden while it's checked."]));
      } catch (error) {
        failure(status, error);
      } finally {
        sendButton.disabled = false;
      }
    } }, [
      field("Why are you reporting it?", reason),
      field("Details", note, "Up to 200 characters. Reports are public."),
      h("div", { class: "actions" }, [sendButton, h("a", { href: "#/report" }, ["How reports work"])]),
      status,
    ]));
  });
  return wrap;
}

/**
 * Under a hidden part: the writer can name the source (a matching citation
 * brings the part back automatically within the hour), and the opener or an
 * editor can restore it.
 */
export function hiddenHelp(storyId, seq, segment, story, ctx) {
  const me = currentAddress();
  if (!me || !ctx) return null;
  const isAuthor = segment.author === me;
  const canRestore = !!ctx.canEdit && Number(segment.hidden_by || 0) !== HIDDEN_BY_ADMIN;
  if (!isAuthor && !canRestore) return null;
  const status = statusBox();
  const box = h("div", { class: "hidden-help" });
  if (isAuthor) {
    const input = h("input", { type: "text", maxlength: "200", placeholder: "e.g. \u201cPride and Prejudice\u201d, Jane Austen", value: segment.citation || "" });
    append(box,
      h("p", { class: "meta small" }, [
        "This is your part. If it quotes a book or website, name the source. When it matches what the checker found, the part comes back by itself within about an hour.",
      ]),
      field("Source", input),
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
        try {
          const op = await encode("stories", "set_citation", { account: me, story_id: String(storyId), seq: String(seq), citation: input.value.trim() });
          if (await send([op], status)) renderPage();
        } catch (error) {
          failure(status, error);
        }
      } }, ["Save the source"]));
  }
  if (canRestore) {
    append(box,
      h("p", { class: "meta small" }, [
        "As the story's " + (story.opener === me ? "opener" : "editor") + ", you can bring this part back if you're satisfied it's fine. The copy checker won't hide it again.",
      ]),
      h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: async () => {
        try {
          const op = await encode("stories", "restore_segment", { actor: me, story_id: String(storyId), seq: String(seq), note: "" });
          if (await send([op], status)) renderPage();
        } catch (error) {
          failure(status, error);
        }
      } }, ["Restore this part"]));
  }
  append(box, status);
  return box;
}

/** Under a finished book: parts can't be reported on chain any more (M-3). */
export function finishedReportNote() {
  const email = SITE.copyrightEmail;
  return h("p", { class: "meta small finished-report" }, [
    "This book is finished, so its parts can't be reported here. To report a problem in it, ",
    email
      ? ["email ", h("a", { href: "mailto:" + email }, [email]), " with the book's link and the part (",
        h("a", { href: "#/report" }, ["how reports work"]), ")."]
      : ["see ", h("a", { href: "#/report" }, ["Report copied text"]), "."],
  ]);
}
