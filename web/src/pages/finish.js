/**
 * Finishing a story (close, final edit, publish), the archive and take-over
 * dates, and reviving an archived story.
 */
import { utils } from "koilib";
import { SITE } from "../config.js";
import { encode, loadStory } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { formatUtc, shortAddress } from "../lib/money.js";
import { checkStoryText, inkCost, normalizePasted } from "../lib/text.js";
import { append, h, replace } from "../ui/dom.js";
import { archiveDeadline, reviveDecision, takeOverDeadline } from "../lib/activity.js";
import { siteLink } from "../lib/site.js";
import { chainNow, currentAddress, state } from "../app/state.js";
import { clip, num, plural, sha256Hex } from "../app/format.js";
import { bookText, closeReadyLocal, kindMin } from "../app/story.js";
import { connectButton, failure, loadingLine, notice, setMeta, statusBox, walletNote } from "../app/ui.js";
import { loadLibrary, refreshAccount } from "../app/data.js";
import { send } from "../app/send.js";
import { renderPage } from "../app/shell.js";

/**
 * For the opener: when anyone may archive the story, and when the admin may
 * take over its final edit, on the activity clock (paused time doesn't
 * count, and the opener's own activity counts too).
 */
function storyClocks(story) {
  const cfg = state.overview && state.overview.storiesCfg;
  if (!cfg) return null;
  const now = chainNow();
  const lines = [];
  const archive = archiveDeadline(story, cfg, now);
  if (archive) {
    if (archive.due) lines.push("This story has been quiet for a long time: anyone can archive it now. Writing or editing here keeps it open.");
    else if (archive.paused) lines.push("Archiving: the quiet-time clock is stopped while SwarmTales is paused.");
    else lines.push("If nobody writes or edits here and you aren't active in it either, anyone can archive it from " + formatUtc(archive.at) + ". Any activity moves that date.");
  }
  const take = takeOverDeadline(story, cfg, now, closeReadyLocal(story));
  if (take) {
    if (take.requested) lines.push("You asked SwarmTales to finish this book, so the admin can take over the final edit" + (take.paused ? " once SwarmTales is unpaused." : "."));
    else if (take.due) lines.push("You haven't been active here for a long time, so the admin can now take over the final edit.");
    else if (take.paused) lines.push("Admin take-over: the clock is stopped while SwarmTales is paused.");
    else lines.push("If you stay inactive here, the admin can take over the final edit from " + formatUtc(take.at) + ".");
  }
  if (!lines.length) return null;
  lines.push("Time while SwarmTales is paused doesn't count.");
  return h("div", { class: "story-clocks" }, lines.map((t) => h("p", { class: "meta small" }, [t])));
}

/** An archived story's opener can bring it back once, for free. */
function reviveControl(id, story, me) {
  const box = h("div", {}, [h("p", { class: "body-2 small" }, ["This story was archived after a long quiet spell. It can still be read."])]);
  if (!state.account) {
    append(box, state.accountError ? notice("bad", h("p", {}, [state.accountError])) : loadingLine("Reading your account…"));
    return box;
  }
  const decision = reviveDecision({ story, cfg: state.overview && state.overview.storiesCfg, account: state.account });
  if (!decision.ok) {
    if (decision.reason) append(box, h("p", { class: "meta small" }, [decision.reason]));
    return box;
  }
  const status = statusBox();
  const button = h("button", { type: "button", class: "btn btn-primary btn-small" }, ["Bring it back"]);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const op = await encode("stories", "revive", { opener: me, story_id: String(id) });
      if (await send([op], status)) {
        await refreshAccount();
        loadLibrary(true).catch(() => {});
        renderPage();
      }
    } catch (error) {
      failure(status, error);
    } finally {
      button.disabled = false;
    }
  });
  append(box,
    h("p", { class: "meta small" }, ["You can bring it back once, for free, and writers can carry on. It counts as one of your open projects again."]),
    button,
    walletNote(),
    status);
  return box;
}

/** Story page, opener only: what's left to finish the book. */
export function finishPanel(id, story, me) {
  if (!me || story.opener !== me) return null;
  const status = Number(story.status);
  const box = h("section", { class: "card finish-panel", "aria-labelledby": "finish-title" }, [
    h("h2", { class: "aside-title", id: "finish-title" }, ["Finish the book"]),
  ]);
  if (status === 4) {
    append(box, h("p", { class: "body-2 small" }, ["This story is finished and published."]),
      h("a", { class: "btn btn-secondary btn-small", href: "#/stories/" + id + "/book" }, ["Read or download the book"]));
    return box;
  }
  if (status === 5) {
    replace(box, h("h2", { class: "aside-title", id: "finish-title" }, ["Archived"]));
    append(box, reviveControl(id, story, me));
    return box;
  }
  if (status === 3) {
    append(box,
      h("p", { class: "body-2 small" }, ["Writing is closed. Review each part, then publish. " + num(story.final_cursor || 0) + " of " + num(story.segment_count || 0) + " parts reviewed."]),
      h("a", { class: "btn btn-primary btn-small", href: "#/stories/" + id + "/finish" }, ["Continue the final edit"]),
      storyClocks(story));
    return box;
  }
  if (status !== 1 && status !== 2) return null;
  if (!closeReadyLocal(story)) {
    append(box, h("p", { class: "meta small" }, [
      "You can close this story for its final edit once it reaches " + num(kindMin(story)) + " characters (" +
        num(Math.max(0, kindMin(story) - Number(story.used_chars || 0))) + " to go). Finishing is free.",
    ]), storyClocks(story));
    return box;
  }
  const statusBoxEl = statusBox();
  append(box,
    h("p", { class: "body-2 small" }, [
      "Ready when you are. Finishing is free and takes three steps: ",
      h("b", {}, ["close"]), " (writing stops), ", h("b", {}, ["final edit"]), " (keep, lightly fix, or remove each part), and ",
      h("b", {}, ["publish"]), ". Leftover pool Ink comes back to you.",
    ]),
    h("button", { type: "button", class: "btn btn-primary btn-small", onClick: async (e) => {
      e.target.disabled = true;
      try {
        const op = await encode("stories", "close_story", { opener: me, story_id: String(id) });
        if (await send([op], statusBoxEl)) location.hash = "#/stories/" + id + "/finish";
      } catch (error) {
        failure(statusBoxEl, error);
      } finally {
        e.target.disabled = false;
      }
    } }, ["Close writing and start the final edit"]),
    statusBoxEl,
    storyClocks(story));
  return box;
}

const FINAL_BATCH = 20;

const FINAL_BATCH_UNITS = 20000;

/** The final edit: parts in the order they were written, 20 at a time. */
export function renderFinish(page, id) {
  setMeta("Final edit", "Review each part, then publish the finished book.");
  const container = h("div", { class: "container page narrow" }, [loadingLine("Opening the final edit…")]);
  append(page, container);
  loadStory(id).then(async ({ story, segments }) => {
    const me = currentAddress();
    const head = [
      h("p", { class: "breadcrumb" }, [h("a", { href: "#/stories/" + id }, ["← Back to the story"])]),
      h("p", { class: "eyebrow" }, ["Final edit"]),
      h("h1", { class: "title" }, [story.title || "Untitled"]),
    ];
    if (!me || story.opener !== me) {
      replace(container, ...head, h("p", { class: "body-2" }, ["Only the story's opener can do the final edit. Connect the opener's wallet."]), connectButton());
      return;
    }
    if (Number(story.status) === 4) {
      replace(container, ...head, notice("ok", h("p", {}, ["This story is published. ", h("a", { href: "#/stories/" + id + "/book" }, ["Read or download the book"]), "."])));
      return;
    }
    if (Number(story.status) !== 3) {
      replace(container, ...head, h("p", { class: "body-2" }, ["Close the story first: on the story page, open “Finish the book”."]));
      return;
    }
    const cursor = Number(story.final_cursor || 0);
    const total = Number(story.segment_count || 0);
    const status = statusBox();
    const hiddenLeft = segments.filter((s, i) => i + 1 > cursor && Number(s.status) === 1 && s.hidden).length;
    replace(container, ...head,
      h("p", { class: "lede" }, ["Go through each part: keep it, tidy it lightly, or remove it. Most parts can simply be kept. " +
        "Shortening or removing a part returns its Ink to the writer (or to the pool). Everything here is free."]),
      h("div", { class: "progress-label" }, [h("span", {}, [num(cursor) + " of " + num(total) + " parts reviewed"])]));
    if (cursor >= total) {
      // Everything reviewed: publish.
      const { text } = bookText(story, segments);
      const hex = await sha256Hex(text);
      const words = text.split(/\s+/).filter(Boolean).length;
      const publish = h("button", { type: "button", class: "btn btn-primary" }, ["Publish the finished book"]);
      publish.addEventListener("click", async () => {
        publish.disabled = true;
        try {
          const bytes = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
          const op = await encode("stories", "finalize", {
            finalizer: me, story_id: String(id), pdf_uri: siteLink(SITE.url, "stories/" + id + "/book").slice(0, 200), pdf_hash: utils.encodeBase64url(bytes),
          });
          if (await send([op], status)) location.hash = "#/stories/" + id + "/book";
        } catch (error) {
          failure(status, error);
        } finally {
          publish.disabled = false;
        }
      });
      append(container,
        notice("ok", h("p", {}, ["Every part is reviewed. The finished book has about " + num(words) + " words."])),
        h("p", { class: "body-2" }, [
          "Publishing locks the book for good and records its fingerprint on the blockchain (",
          h("span", { class: "mono small" }, [hex.slice(0, 16) + "…"]),
          "), so anyone can check a copy is the real one. Readers can download it from the book page. Leftover pool Ink returns to you.",
        ]),
        h("div", { class: "actions" }, [publish]), status);
      return;
    }
    // The next batch, in the order the contract expects.
    const rows = [];
    for (let seq = cursor + 1; seq <= total && rows.length < FINAL_BATCH; seq++) {
      const seg = segments[seq - 1];
      if (!seg || Number(seg.status) !== 1) continue; // removed parts are skipped by the contract
      const mode = h("select", { "aria-label": "Part " + seq }, seg.hidden
        ? [h("option", { value: "3" }, ["Remove (hidden part)"])]
        : [h("option", { value: "1" }, ["Keep"]), h("option", { value: "2" }, ["Edit lightly"]), h("option", { value: "3" }, ["Remove"])]);
      const original = Number(seg.original_cost || 0);
      const allowance = Math.max(Math.floor(original / 10), Math.min(original, 20));
      // As submit_final_batch: measured from the part as it is now (AB-056).
      const maxCost = Number(seg.current_cost || 0) + allowance;
      const area = h("textarea", { rows: "5", hidden: true }, []);
      area.value = seg.text || "";
      const counter = h("p", { class: "meta small", hidden: true });
      const syncCount = () => { counter.textContent = num(inkCost(area.value.trim())) + " of at most " + num(maxCost) + " characters (light edits only)."; };
      area.addEventListener("input", syncCount);
      mode.addEventListener("change", () => { area.hidden = mode.value !== "2"; counter.hidden = mode.value !== "2"; syncCount(); });
      const row = { seq, seg, mode, area, maxCost };
      rows.push(row);
      append(container, h("div", { class: "final-row" + (seg.hidden ? " seg-muted" : "") }, [
        h("div", { class: "final-row-head" }, [
          h("span", { class: "meta small" }, ["Part " + seq + " · " + shortAddress(seg.author) + (seg.hidden ? " · hidden" : "")]),
          mode,
        ]),
        h("p", { class: "final-row-text" }, [seg.hidden ? "(hidden while it's checked: it can only be removed here, or restored on the story page first)" : clip(seg.text || "", 400)]),
        area, counter,
      ]));
    }
    const save = h("button", { type: "button", class: "btn btn-primary" }, ["Save these " + rows.length + " parts"]);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const items = [];
        let used = 0;
        for (const r of rows) {
          const m = Number(r.mode.value);
          if (m === 2) {
            const t = normalizePasted(r.area.value).trim();
            const cost = inkCost(t);
            const check = checkStoryText(t, true);
            if (!check.ok) throw new Error("Part " + r.seq + ": " + check.reason);
            if (cost > r.maxCost) throw new Error("Part " + r.seq + ": the edit makes it too long. Light edits only.");
            if (used + cost > FINAL_BATCH_UNITS) break; // the rest goes in the next batch
            used += cost;
            items.push({ seq: String(r.seq), mode: 2, text: t, expected_cost: String(cost) });
          } else {
            items.push({ seq: String(r.seq), mode: m, text: "", expected_cost: "0" });
          }
        }
        if (!items.length) throw new Error("Nothing to save.");
        const op = await encode("stories", "submit_final_batch", { finalizer: me, story_id: String(id), items });
        if (await send([op], status)) renderPage();
      } catch (error) {
        failure(status, error);
      } finally {
        save.disabled = false;
      }
    });
    append(container,
      hiddenLeft ? notice("warn", h("p", {}, [plural(hiddenLeft, "hidden part") + " left. Hidden parts must be removed here, or restored on the story page, before the book can be published."])) : null,
      h("div", { class: "actions" }, [save, h("p", { class: "meta" }, ["One confirmation saves this group. Then the next group appears."])]),
      status);
  }).catch((error) => replace(container, notice("bad", h("p", {}, [explainFailure(error)]))));
}
