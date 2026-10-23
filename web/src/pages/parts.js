/**
 * One part of a story with its notes and tools, and its version history.
 */
import { read } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { formatUtc, shortAddress } from "../lib/money.js";
import { append, h, replace } from "../ui/dom.js";
import { changeMultiplier, hiddenByReports, MAX_PAID_CHANGES } from "../lib/change.js";
import { readAllVersions } from "../lib/versions.js";
import { currentAddress } from "../app/state.js";
import { num } from "../app/format.js";
import { inviteOnly } from "../app/story.js";
import { changePanel, editPanel, removePanel } from "./editing.js";
import { composer } from "./composer.js";
import { hiddenHelp, REASON_LABELS, reportControl } from "./moderation.js";

export function segmentView(block, story, storyId, ctx) {
  const segment = block.segment;
  const author = segment.author || "";
  const removed = Number(segment.status) === 2;
  const edited = !removed && segment.last_edited_by && segment.last_edited_by !== "" && Number(segment.last_edited_at || 0) > 0;
  const notes = [];
  let body;
  if (removed) {
    // A removal keeps a version, so what the part said stays readable in its history.
    const kept = !segment.taken_down && Number(segment.version_count || 0) > 0;
    const why = segment.taken_down
      ? "Removed for good: " + (REASON_LABELS[Number(segment.moderation_reason)] || "a policy problem") + "."
      : kept ? "Removed. What it said stays readable in its history." : "Removed.";
    body = h("p", { class: "seg-text seg-placeholder" }, [why]);
    if (kept) notes.push(versionsView(storyId, block));
  } else if (segment.hidden) {
    body = h("div", {}, [
      h("p", { class: "seg-text seg-placeholder" }, [
        "This part is hidden" + (REASON_LABELS[Number(segment.moderation_reason)] ? " (possibly " + REASON_LABELS[Number(segment.moderation_reason)] + ")" : "") + ".",
      ]),
      hiddenHelp(storyId, block.seq, segment, story, ctx),
    ]);
  } else {
    body = h("p", { class: "seg-text" }, [segment.text || ""]);
    if (edited) {
      notes.push(h("details", { class: "edit-note" }, [
        h("summary", { title: "Show who edited this part" }, ["edited"]),
        h("span", {}, [
          " by " + shortAddress(segment.last_edited_by) + (formatUtc(segment.last_edited_at) ? " on " + formatUtc(segment.last_edited_at).split(",")[0] : "") +
            ". Credit stays with " + shortAddress(author) + "; the first version is kept on the public record.",
        ]),
      ]));
    }
    if (segment.ai_assisted) notes.push(h("span", { class: "tag-ai" }, ["Written with AI help"]));
    if (Number(segment.version_count || 0) > 1) notes.push(versionsView(storyId, block));
    if (segment.citation) notes.push(h("span", { class: "source-note" }, ["Source: " + segment.citation]));
    if (segment.source_note) {
      notes.push(h("span", { class: "source-note", title: "Added automatically by SwarmTales' copy checker" }, [segment.source_note]));
    }
  }
  const tools = h("div", { class: "seg-tools" });
  const slot = h("div", { class: "seg-slot" });
  if (ctx && !removed) {
    const toggle = (name, make) => {
      const open = slot.dataset.open === name;
      replace(slot);
      slot.dataset.open = "";
      if (!open) {
        slot.dataset.open = name;
        append(slot, make());
        const focus = slot.querySelector("textarea, button");
        if (focus) focus.focus();
      }
    };
    if (ctx.canAdd && block.seq !== ctx.lastSeq) {
      append(tools, h("button", { type: "button", class: "text-button tool" }, ["+ Add text here"]));
      tools.lastChild.title = "Write new text that appears right below this part";
      tools.lastChild.addEventListener("click", () => toggle("add", () => composer(storyId, story, ctx.active, block.seq, ctx.flags)));
    }
    // Your own part: reword or remove it for free (letters beyond its length
    // cost Ink). Someone else's: change or remove it for Ink (everyone pays,
    // the opener too; never the pool). The opener and editors may remove a
    // part that writer reports hid, for free (not one the admin or the copy
    // checker hid: only its writer can remove that).
    const me = currentAddress();
    const ownPart = !!me && segment.author === me;
    const open = Number(story.status) === 1;
    // In a private story, editing your part needs you still on its list (M-4).
    const stillInvited = !inviteOnly(story) || story.opener === me || !!(ctx.flags && (ctx.flags.editor || ctx.flags.allowed));
    if (open && ownPart && !segment.hidden && stillInvited) {
      append(tools, h("button", { type: "button", class: "text-button tool", title: "Edit your part: rewording is free, added letters cost Ink" }, ["Edit"]));
      tools.lastChild.addEventListener("click", () => toggle("edit", () => editPanel(storyId, block, ctx.active)));
    }
    if (open && (ownPart || (hiddenByReports(segment) && ctx.canEdit))) {
      append(tools, h("button", { type: "button", class: "text-button tool" }, ["Remove"]));
      tools.lastChild.addEventListener("click", () => toggle("remove", () => removePanel(storyId, block)));
    }
    // revise_part refuses every change from the 60th paid one on (AB-065).
    if (ctx.canAdd && !segment.hidden && !ownPart && me && Number(segment.paid_changes || 0) < MAX_PAID_CHANGES) {
      const times = changeMultiplier(segment.paid_changes);
      append(tools, h("button", { type: "button", class: "text-button tool", title: "Change this part: you pay for the letters you add and remove, \u00d7" + times + ". The earlier version stays readable." }, ["Change (\u00d7" + times + ")"]));
      tools.lastChild.addEventListener("click", () => toggle("change", () => changePanel(storyId, story, block, ctx.active)));
    }
    if (!segment.hidden && typeof window !== "undefined" && window.speechSynthesis) {
      append(tools, h("button", { type: "button", class: "text-button tool", onClick: () => ctx.listen && ctx.listen.startFrom(block.seq) }, ["Listen from here"]));
    }
    if (!segment.hidden && ctx.toggleMark) {
      const marked = ctx.markSeq === block.seq;
      append(tools, h("button", {
        type: "button", class: "text-button tool bookmark-tool", "aria-pressed": marked ? "true" : "false",
        title: "Keep your place at this part (saved in this browser)", onClick: () => ctx.toggleMark(block.seq),
      }, [marked ? "\u2605 Bookmarked" : "Bookmark"]));
    }
    // Finished books are reported off-chain (the contract refuses, M-3): see finishedReportNote().
    if (!segment.hidden && author !== currentAddress() && Number(story.status) !== 4) append(tools, reportControl(storyId, block.index));
  }
  const isMarked = !!ctx && ctx.markSeq === block.seq && !segment.hidden;
  const el = h("div", { class: "seg" + (removed || segment.hidden ? " seg-muted" : "") + (isMarked ? " bookmarked" : ""), dataset: { seq: String(block.seq || block.index) } }, [
    h("p", { class: "seg-author" }, [h("b", {}, [shortAddress(author)]), h("span", {}, [(author === story.opener ? "opener · " : "") + num(segment.current_cost || segment.charged) + " Ink"])]),
    h("div", {}, [
      body,
      notes.length ? h("div", { class: "seg-notes" }, notes) : null,
      tools.childNodes.length ? tools : null,
      slot,
    ]),
  ]);
  // On a phone there's no pointer: tapping the text shows that part's tools.
  body.addEventListener("click", () => {
    if (window.getSelection && String(window.getSelection())) return; // selecting text, not tapping
    const wasActive = el.classList.contains("active");
    el.closest("article")?.querySelectorAll(".seg.active").forEach((s) => s.classList.remove("active"));
    if (!wasActive) el.classList.add("active");
  });
  return el;
}

function versionLabel(v) {
  switch (Number(v.kind)) {
    case 1: return "original by " + shortAddress(v.author);
    case 3: return "removed by " + shortAddress(v.by);
    case 4: return "edited by its writer, " + shortAddress(v.by);
    case 5: return "final edit by " + shortAddress(v.by);
    default: return "changed by " + shortAddress(v.by);
  }
}

function versionsView(storyId, block) {
  const n = Number(block.segment.version_count || 0);
  const list = h("ol", { class: "version-list" });
  const box = h("details", { class: "edit-note versions" }, [
    h("summary", {}, ["version " + n + " \u00b7 earlier versions"]),
    list,
  ]);
  let loaded = false;
  box.addEventListener("toggle", async () => {
    if (!box.open || loaded) return;
    loaded = true;
    list.replaceChildren(h("li", { class: "meta small" }, ["Loading\u2026"]));
    try {
      // A few versions per read: each can hold a whole part (AB-060, AB-070).
      const values = await readAllVersions(
        (from, count) => read("stories", "get_versions", { story_id: String(storyId), seq: String(block.seq), from, count }), n);
      list.replaceChildren(...values.slice().reverse().map((v) => h("li", {}, [
        h("p", { class: "meta small" }, [
          "Version " + v.version + " \u00b7 " + versionLabel(v) + (formatUtc(v.at) ? " \u00b7 " + formatUtc(v.at).split(",")[0] : ""),
        ]),
        Number(v.kind) === 3 && !v.text
          ? h("p", { class: "version-text seg-placeholder" }, ["(removed)"])
          : h("p", { class: "version-text" }, [v.text || ""]),
        v.citation ? h("p", { class: "source-note" }, ["Source: " + v.citation]) : null,
        v.ai_assisted ? h("span", { class: "tag-ai" }, ["Written with AI help"]) : null,
      ])));
    } catch (error) {
      list.replaceChildren(h("li", { class: "meta small" }, [explainFailure(error)]));
    }
  });
  return box;
}
