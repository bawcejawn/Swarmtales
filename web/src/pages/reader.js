/**
 * The story page: chapters, parts, reading settings, bookmarks, read-aloud,
 * and the side panels.
 */
import { contracts, network } from "../config.js";
import { loadStory, writerFlags } from "../chain.js";
import { loadStoryOrCopy } from "../lib/offline.js";
import { formatUtc } from "../lib/money.js";
import { explainFailure } from "../lib/errors.js";
import { KIND, label, VISIBILITY } from "../lib/labels.js";
import { shortAddress } from "../lib/money.js";
import { append, h, icons, replace } from "../ui/dom.js";
import { readingOrder } from "../lib/order.js";
import * as reading from "../lib/bookmarks.js";
import { isFollowing, markSeen, newParts, setFollow } from "../lib/follow.js";
import { createReader } from "../ui/readAloud.js";
import { currentAddress, readPref, state, writePref } from "../app/state.js";
import { chapterWord, clip, num, plural } from "../app/format.js";
import { avatar, canWriteInvited, inviteOnly, percent, progressBar, sizeText, statusPill, storyCategories } from "../app/story.js";
import { loadingLine, notice, setMeta } from "../app/ui.js";
import { storyGuide } from "./storyGuide.js";
import { segmentView } from "./parts.js";
import { composer } from "./composer.js";
import { finishedReportNote } from "./moderation.js";
import { adoptWalletPlace, walletPlacesControl } from "./bookmarks.js";
import { sharePanel } from "./share.js";
import { finishPanel } from "./finish.js";
import { supportPanel } from "./support.js";
import { shareBar } from "./book.js";
import { storyCredits } from "../lib/credits.js";

export function renderReader(page, id) {
  const container = h("div", { class: "container page" }, [loadingLine("Opening the story…")]);
  append(page, container);
  loadStoryOrCopy(contracts.stories, id, loadStory).then(async ({ bundle, savedAt }) => {
    const story = bundle.story;
    if (!story || Number(story.status || 0) === 0) {
      setMeta("Story not found", "");
      replace(container, 
        h("h1", { class: "title" }, ["We couldn't find that story"]),
        h("p", { class: "lede" }, ["There's no story with this number on " + network.name + "."]),
        h("p", {}, [h("a", { class: "link-arrow", href: "#/stories" }, ["Back to Discover", icons.arrow()])])
      );
      return;
    }
    // Reading order: parts added between others are read where they were placed.
    const all = bundle.segments.map((segment, i) => ({ segment, index: i + 1, seq: i + 1, insertAfter: Number(segment.insert_after || 0) }));
    const ordered = readingOrder(all);
    const active = ordered.filter((b) => Number(b.segment.status) !== 2);
    const removed = all.filter((b) => Number(b.segment.status) === 2);
    const me = currentAddress();
    const flags = me ? await writerFlags(id, me).catch(() => ({ editor: false, allowed: false })) : { editor: false, allowed: false };
    const storyOpen = Number(story.status) === 1;
    const ctx = {
      storyId: id,
      story,
      canEdit: storyOpen && !!me && (story.opener === me || flags.editor),
      // Private stories: only the opener, editors and invited writers.
      canAdd: storyOpen && (!inviteOnly(story) || canWriteInvited(story, me, flags)),
      flags,
      lastSeq: active.length ? active[active.length - 1].seq : 0,
      active,
    };
    const firstVisible = active.find((b) => !b.segment.hidden);
    const firstText = firstVisible ? firstVisible.segment.text : "";
    setMeta(story.title || "Untitled story", clip(firstText, 155) || "A collaborative story on SwarmTales.");

    // Chapters: a new chapter starts at the first part and at every part marked starts_chapter.
    const chapters = [];
    for (const block of active) {
      if (!chapters.length || block.segment.starts_chapter) chapters.push({ number: chapters.length + 1, blocks: [] });
      chapters[chapters.length - 1].blocks.push(block);
    }

    // Writers, by characters currently in the story.
    const totals = new Map();
    for (const block of active) {
      const author = block.segment.author || "";
      totals.set(author, (totals.get(author) || 0) + Number(block.segment.current_cost || block.segment.charged || 0));
    }
    const writers = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const credits = storyCredits(story, active);

    const cats = storyCategories(story);
    const composeAnchor = h("div", { id: "compose" });
    const goWrite = () => {
      composeAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
      const area = composeAnchor.querySelector("textarea, button, a.btn");
      if (area) setTimeout(() => area.focus({ preventScroll: true }), 350);
      // Briefly highlight the writing box so it's clear where to look.
      const box = composeAnchor.querySelector(".composer");
      if (box) {
        box.classList.remove("flash");
        void box.offsetWidth;
        box.classList.add("flash");
      }
    };

    const isOpen = Number(story.status) === 1;
    // Private stories: say right away what this wallet can do here.
    let accessLine = null;
    if (isOpen && inviteOnly(story)) {
      const invited = !!me && (story.opener === me || flags.editor || flags.allowed);
      if (!me) accessLine = "Only invited writers can write here. Connect your wallet if you were invited.";
      else if (!invited) accessLine = "Only people the opener invites can write here. Anyone can read it.";
      else if (!canWriteInvited(story, me, flags)) accessLine = "You're invited. You need an active Writer month to write here; the opener can give you one.";
      else if (story.opener !== me) accessLine = "You're invited. Your parts are paid from the writers' pool (" + num(story.fund || 0) + " Ink left).";
    }
    const joinedNote = /[?&]joined=1/.test(location.hash) && me
      ? notice("ok", h("p", {}, [
        "You've joined this story. It's listed under ", h("a", { href: "#/mine" }, ["My stories"]), ". ",
        canWriteInvited(story, me, flags)
          ? "Scroll down to write the next part, or use “+ Add text here” under any part."
          : "To write, you need an active Writer month: ask the opener to give you one, or get one on the ",
        canWriteInvited(story, me, flags) ? null : h("a", { href: "#/membership" }, ["Membership page"]),
        canWriteInvited(story, me, flags) ? null : ".",
      ]))
      : null;
    const head = h("header", { class: "reader-head" }, [
      h("div", { class: "head-main" }, [
        h("div", { class: "pills" }, [
          statusPill(story),
          h("span", { class: "pill pill-neutral" }, [label(KIND, story.kind)]),
          Number(story.visibility) !== 1 ? h("span", { class: "pill pill-neutral" }, [label(VISIBILITY, story.visibility)]) : null,
        ]),
        h("h1", { class: "reader-title" }, [story.title || "Untitled"]),
        h("p", { class: "meta", style: null }, [
          "Opened by " + shortAddress(story.opener) + " · " + plural(writers.length || story.contributor_count, "writer") + " · " + plural(chapters.length, "chapter"),
        ]),
      ]),
      h("div", { class: "head-side" }, [
        progressBar(story, [h("span", {}, [sizeText(story)]), h("span", {}, [percent(story) + "%"])]),
        isOpen && (!inviteOnly(story) || canWriteInvited(story, me, flags))
          ? h("button", { type: "button", class: "btn btn-primary btn-block", onClick: goWrite }, ["Write the next part"])
          : null,
        followButton(id, story),
        accessLine ? h("p", { class: "meta access-line" }, [accessLine]) : null,
        isOpen && inviteOnly(story) && me && (flags.allowed || flags.editor) && !canWriteInvited(story, me, flags)
          ? h("a", { class: "btn btn-secondary btn-block", href: "#/membership" }, ["Get a Writer month"])
          : null,
      ]),
    ]);
    head.querySelector(".head-main .meta").style.marginTop = "12px";
    const sideButton = head.querySelector(".head-side .btn");
    if (sideButton) sideButton.style.marginTop = "16px";

    const column = h("div", { class: "reader-column" + (state.showAuthors ? "" : " hide-authors") });
    const toggle = h("input", { type: "checkbox" });
    toggle.checked = state.showAuthors;
    toggle.addEventListener("change", () => {
      state.showAuthors = toggle.checked;
      writePref("st-show-authors-v2", toggle.checked ? "1" : "0");
      column.classList.toggle("hide-authors", !toggle.checked);
    });

    const article = h("article", { "aria-labelledby": "story-text-title" }, [
      h("h2", { class: "visually-hidden", id: "story-text-title" }, ["The story"]),
    ]);
    // Bookmarks and "continue reading": kept in this browser; a bookmark can
    // also be saved to the wallet when the reader asks (pages/bookmarks.js).
    const readOrder = [];
    const chapterOf = new Map();
    for (const chapter of chapters) {
      for (const b of chapter.blocks) {
        chapterOf.set(b.seq, chapter.number);
        if (!b.segment.hidden && Number(b.segment.status) !== 2) readOrder.push(b.seq);
      }
    }
    const placeOf = (seq) => ({
      seq,
      chapter: chapterOf.get(seq) || 1,
      percent: readOrder.length ? ((readOrder.indexOf(seq) + 1) / readOrder.length) * 100 : 0,
      title: story.title || "",
    });
    // A bookmark saved to the wallet (from any device) wins when it's newer.
    if (me) await adoptWalletPlace(me, id, story.title);
    const progress = reading.load(contracts.stories, id);
    // Parts added since this browser last opened the story, then remember this visit.
    const fresh = newParts(contracts.stories, id, story.segment_count);
    markSeen(contracts.stories, id, story.segment_count);
    ctx.markSeq = progress.mark ? progress.mark.seq : 0;
    const syncNote = h("div", { class: "meta small sync-note", "aria-live": "polite" });
    // A bookmark is saved in this browser at once. It goes to the wallet only
    // when the reader presses "Save to my wallet": one confirmation for every
    // bookmark waiting, never a signature prompt per click (W1-10).
    const showSync = (changed) => {
      replace(syncNote);
      const pending = me ? reading.pendingWallet(contracts.stories).filter((p) => p.id === String(id)) : [];
      if (!me) {
        if (changed && ctx.markSeq) syncNote.textContent = "Saved in this browser. Connect a wallet to keep bookmarks on every device.";
        return;
      }
      if (!pending.length) return;
      append(syncNote, walletPlacesControl(pending, changed
        ? (ctx.markSeq ? "Bookmark saved in this browser." : "Bookmark removed in this browser.")
        : "Your bookmark here isn't in your wallet yet."));
    };
    showSync(false);
    ctx.toggleMark = (seq) => {
      const off = ctx.markSeq === seq;
      reading.setMark(contracts.stories, id, off ? null : placeOf(seq));
      ctx.markSeq = off ? 0 : seq;
      showSync(true);
      article.querySelectorAll(".seg").forEach((el) => {
        const on = Number(el.dataset.seq) === ctx.markSeq;
        el.classList.toggle("bookmarked", on);
        const btn = el.querySelector(".bookmark-tool");
        if (btn) {
          btn.textContent = on ? "\u2605 Bookmarked" : "Bookmark";
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
      });
    };

    if (!chapters.length) append(article, h("div", { class: "empty" }, [h("p", {}, ["No text has been written yet."])]));
    // The book's contents: each chapter is a fold you open. A one-chapter
    // story starts open.
    chapters.forEach((chapter, i) => {
      const parts = h("div", { class: "chapter-body" });
      for (const block of chapter.blocks) append(parts, segmentView(block, story, id, ctx));
      append(article, h("details", { class: "chapter" + (i === 0 ? " first" : ""), id: "chapter-" + chapter.number, open: chapters.length === 1 ? true : null }, [
        h("summary", { class: "chapter-summary" }, [
          h("span", { class: "chapter-number" }, ["Chapter " + chapterWord(chapter.number)]),
          h("span", { class: "chapter-meta meta small" }, [plural(chapter.blocks.length, "part")]),
        ]),
        h("div", { class: "chapter-ornament", "aria-hidden": "true" }, ["\u2766"]),
        parts,
      ]));
    });
    if (chapters.length > 1) {
      const allOpen = () => [...article.querySelectorAll("details.chapter")].every((d) => d.open);
      const toggleAll = h("button", { type: "button", class: "text-button" }, ["Open all chapters"]);
      toggleAll.addEventListener("click", () => {
        const open = !allOpen();
        article.querySelectorAll("details.chapter").forEach((d) => { d.open = open; });
        toggleAll.textContent = open ? "Close all chapters" : "Open all chapters";
      });
      article.querySelector("details.chapter").before(h("div", { class: "contents-bar" }, [h("span", { class: "eyebrow muted" }, ["Contents"]), toggleAll]));
    }
    if (removed.length) {
      const details = h("details", { class: "removed" }, [h("summary", {}, [plural(removed.length, "removed part") + " (kept on the record)"])]);
      for (const block of removed) append(details, segmentView(block, story, id, null));
      append(article, details);
    }

    // Read-aloud items in reading order; each chapter's first part announces it.
    const listenItems = [];
    for (const chapter of chapters) {
      let first = true;
      for (const b of chapter.blocks) {
        if (b.segment.hidden || Number(b.segment.status) === 2) continue;
        listenItems.push({ seq: b.seq, text: b.segment.text || "", announce: first ? "Chapter " + chapter.number + "." : "" });
        first = false;
      }
    }
    const listen = createReader(article, listenItems);

    const goTo = (seq) => {
      const el = article.querySelector('.seg[data-seq="' + seq + '"]');
      if (!el) return;
      const fold = el.closest("details.chapter");
      if (fold) fold.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("flash-seg");
      void el.offsetWidth;
      el.classList.add("flash-seg");
    };
    const lastOk = progress.last && readOrder.includes(progress.last.seq) && progress.last.seq !== readOrder[0];
    const markOk = progress.mark && readOrder.includes(progress.mark.seq);
    const resumeBar = lastOk || markOk
      ? h("div", { class: "resume-bar", role: "region", "aria-label": "Your place in this story" }, [
        h("span", { class: "meta" }, [(fresh ? plural(fresh, "new part") + " since your last visit. " : "") + (lastOk
          ? "You were reading Chapter " + progress.last.chapter + " \u00b7 " + progress.last.percent + "% through."
          : "You bookmarked Chapter " + progress.mark.chapter + ".")]),
        lastOk ? h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => goTo(progress.last.seq) }, ["Continue reading"]) : null,
        markOk ? h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => goTo(ctx.markSeq || progress.mark.seq) }, ["Go to bookmark"]) : null,
      ])
      : null;
    ctx.listen = listen;
    append(column, 
      h("div", { class: "chapter-bar" }, [
        h("p", { class: "eyebrow muted" }, [cats.join(" · ") || label(KIND, story.kind)]),
        h("label", { class: "check" }, [toggle, "Show who wrote what"]),
        readingSettings(column),
      ]),
      resumeBar,
      syncNote,
      listen,
      article,
      Number(story.status) === 4 ? finishedReportNote() : null,
      composeAnchor
    );
    append(composeAnchor, composer(id, story, active, 0, flags));

    const aside = h("aside", { class: "reader-aside", "aria-label": "About this story" }, [
      finishPanel(id, story, me),
      storyGuide(id, story, chapters, me, flags, writers),
      sharePanel(id, story, me, flags),
      chapters.length > 1
        ? h("nav", { "aria-label": "Contents" }, [
            h("h2", { class: "aside-title" }, ["Contents"]),
            h("ol", { class: "contents" }, chapters.map((chapter) => h("li", {}, [
              h("button", { type: "button", onClick: () => { const d = document.getElementById("chapter-" + chapter.number); d.open = true; d.scrollIntoView({ behavior: "smooth" }); } }, [
                "Chapter " + chapter.number,
              ]),
            ]))),
          ])
        : null,
      writers.length
        ? h("section", {}, [
            h("h2", { class: "aside-title" }, ["Writers"]),
            h("ul", { class: "writers" }, credits.slice(0, 12).map((c) => h("li", {}, [
              avatar(c.address),
              h("span", { class: "writer-name" }, [
                h("b", {}, [shortAddress(c.address) + (c.address === story.opener ? " (opener)" : "")]),
                h("span", {}, [plural(c.chars, "character")]),
                shareBar(c.share),
              ]),
            ]))),
            h("p", { class: "meta small", style: null }, [Number(story.status) === 4
              ? "Shares count what survived the final edit."
              : "Shares count the characters in the story now. Final credits count what survives the closing edit."]),
          ])
        : null,
      supportPanel(id, story, credits),
      h("section", { class: "card" }, [
        h("h2", { class: "aside-title" }, ["On the public record"]),
        h("p", { class: "body-2 small" }, ["Every part of this story, and every edit, is recorded on the Koinos blockchain. Anyone can check who wrote what."]),
        h("p", { class: "meta small mono" }, ["Story " + id + " · contract " + shortAddress(contracts.stories)]),
      ]),
    ]);

    replace(container, 
      h("p", { class: "breadcrumb" }, [h("a", { href: "#/stories" }, ["Discover"]), cats[0] ? " / " + cats[0] : ""]),
      savedAt ? notice("warn", h("p", {}, ["You're offline, so this is the copy saved in this browser on " + formatUtc(Math.floor(savedAt / 1000)) + ". Newer parts appear when you're back online."])) : null,
      joinedNote,
      head,
      h("div", { class: "reader-layout" }, [h("div", { class: "reader-main" }, [column]), aside])
    );
    const writersNote = aside.querySelector(".writers + p");
    if (writersNote) writersNote.style.marginTop = "12px";

    // Coming from "Continue reading" or "Go to bookmark" on My stories.
    if (/[?&]resume=1/.test(location.hash) && lastOk) setTimeout(() => goTo(progress.last.seq), 300);
    else if (/[?&]mark=1/.test(location.hash) && markOk) setTimeout(() => goTo(progress.mark.seq), 300);
    watchReading(article, id, placeOf);
  }).catch((error) => {
    replace(container, notice("bad", h("p", {}, [explainFailure(error)])));
  });
}

/** Follow a story: kept in this browser; My stories then shows its new parts. */
function followButton(id, story) {
  const btn = h("button", { type: "button", class: "btn btn-secondary btn-block follow-btn" });
  const draw = (on) => {
    btn.textContent = on ? "\u2713 Following" : "Follow this story";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Saved in this browser. My stories shows new parts." : "Get a \u201cnew parts\u201d note on My stories. Saved in this browser; no account needed.";
  };
  draw(isFollowing(contracts.stories, id));
  btn.addEventListener("click", () => draw(setFollow(contracts.stories, id, !isFollowing(contracts.stories, id), story.title)));
  return btn;
}

/**
 * Reading settings, remembered in this browser: text size, page colour,
 * typeface, line spacing and width ("Wide" hides the side panel for a
 * full-width page, the tablet complaint about narrow reading columns).
 */
function readingSettings(column) {
  const groups = [
    ["st-read-size", "size", "Text size", "m", [["s", "Small"], ["m", "Medium"], ["l", "Large"], ["xl", "Extra large"]]],
    ["st-read-theme", "theme", "Page", "paper", [["paper", "Paper"], ["sepia", "Sepia"], ["night", "Night"], ["black", "Black (OLED)"]]],
    ["st-read-font", "font", "Typeface", "serif", [["serif", "Book serif"], ["sans", "Clean sans"]]],
    ["st-read-spacing", "spacing", "Line spacing", "normal", [["tight", "Tight lines"], ["normal", "Normal lines"], ["airy", "Airy lines"]]],
    ["st-read-width", "width", "Width", "normal", [["narrow", "Narrow"], ["normal", "Normal width"], ["wide", "Wide (no side panel)"]]],
  ];
  const apply = () => {
    for (const [key, data, , fallback] of groups) column.dataset[data] = readPref(key, fallback);
    const layout = column.closest(".reader-layout");
    if (layout) layout.classList.toggle("reading-wide", column.dataset.width === "wide");
  };
  apply();
  // The column is attached to the page after this runs.
  requestAnimationFrame(apply);
  const selects = groups.map(([key, , name, fallback, options]) => {
    const select = h("select", { "aria-label": name }, options.map(([v, l]) => h("option", { value: v }, [l])));
    select.value = readPref(key, fallback);
    select.addEventListener("change", () => { writePref(key, select.value); apply(); });
    return select;
  });
  const [size, theme, ...more] = selects;
  return h("div", { class: "reading-settings" }, [
    h("label", {}, [h("span", { class: "visually-hidden" }, ["Text size"]), "Aa ", size]),
    h("label", {}, [h("span", { class: "visually-hidden" }, ["Page"]), theme]),
    h("details", { class: "more-settings" }, [
      h("summary", {}, ["More"]),
      h("div", { class: "more-settings-body" }, more.map((select) => h("label", {}, [select]))),
    ]),
  ]);
}

/**
 * Remember where the reader is: the part nearest the top third of the screen,
 * saved a moment after they stop scrolling. Starts only once they scroll, so
 * opening a story doesn't overwrite their place.
 */
function watchReading(article, storyId, placeOf) {
  if (typeof IntersectionObserver === "undefined") return;
  let current = 0;
  let timer = null;
  let started = false;
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const seq = Number(e.target.dataset.seq);
      if (e.isIntersecting) visible.add(seq);
      else visible.delete(seq);
    }
    const order = [...article.querySelectorAll(".seg:not(.seg-muted)")].map((el) => Number(el.dataset.seq));
    const top = order.find((s) => visible.has(s));
    if (top) current = top;
    if (!started || !current) return;
    clearTimeout(timer);
    timer = setTimeout(() => reading.saveLast(contracts.stories, storyId, placeOf(current)), 800);
  }, { rootMargin: "-25% 0px -60% 0px" });
  article.querySelectorAll(".seg:not(.seg-muted)").forEach((el) => observer.observe(el));
  const start = () => { started = true; };
  window.addEventListener("scroll", start, { once: true, passive: true });
  window.addEventListener("hashchange", () => { observer.disconnect(); clearTimeout(timer); window.removeEventListener("scroll", start); }, { once: true });
}
