/**
 * My stories: reading progress, and the stories this wallet opened, writes
 * in, or was invited to.
 */
import { contracts } from "../config.js";
import { read } from "../chain.js";
import { explainFailure } from "../lib/errors.js";
import { append, h, icons, replace } from "../ui/dom.js";
import * as reading from "../lib/bookmarks.js";
import { followed, newParts, setFollow } from "../lib/follow.js";
import { currentAddress } from "../app/state.js";
import { plural } from "../app/format.js";
import { connectButton, loadingLine, notice, setMeta } from "../app/ui.js";
import { invitedStoryIds, openedStoryIds, storyRows, writtenStoryIds } from "../app/data.js";
import { storyCard } from "./discover.js";
import { walletPlacesControl } from "./bookmarks.js";

export function renderMine(page) {
  setMeta("My stories", "The stories you opened or write in, including private ones.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container,
    h("p", { class: "eyebrow" }, ["Your shelf"]),
    h("h1", { class: "title" }, ["My stories"]),
    h("p", { class: "lede" }, ["Stories you follow and are reading, and every story you opened or wrote in, including private ones that don't appear in Discover."])
  );
  // Following: kept in this browser, with the parts added since the last visit.
  const follows = followed(contracts.stories);
  if (follows.length) {
    const grid = h("div", { class: "card-grid" }, [loadingLine("Checking for new parts…")]);
    append(container, h("section", { class: "mine-section" }, [
      h("h2", { class: "h2" }, ["Following"]),
      h("p", { class: "meta" }, ["Saved in this browser. New parts since your last visit are counted for you."]),
      grid,
    ]));
    storyRows(follows.map((f) => f.id)).then((rows) => {
      rows.sort((a, b) => newParts(contracts.stories, b.id, b.story.segment_count) - newParts(contracts.stories, a.id, a.story.segment_count));
      replace(grid, ...rows.map((row) => {
        const fresh = newParts(contracts.stories, row.id, row.story.segment_count);
        const card = storyCard(row, undefined, { badge: fresh ? plural(fresh, "new part") : "" });
        return h("div", { class: "card-wrap" }, [card, h("button", { type: "button", class: "text-button small", onClick: (e) => {
          setFollow(contracts.stories, row.id, false);
          e.target.closest(".card-wrap").remove();
        } }, ["Unfollow"])]);
      }));
    }).catch((error) => replace(grid, notice("bad", h("p", {}, [explainFailure(error)]))));
  }
  // Reading progress: this browser's places, plus bookmarks saved to the wallet.
  const readingSlot = h("div");
  append(container, readingSlot);
  const showPlaces = (places) => {
    if (!places.length) return replace(readingSlot);
    replace(readingSlot, h("section", { class: "mine-section" }, [
      h("h2", { class: "h2" }, ["Continue reading"]),
      h("p", { class: "meta" }, ["Saved in this browser as you read. Bookmarks too."]),
      h("ul", { class: "reading-list" }, places.map((p) => h("li", { class: "reading-item" }, [
        h("div", {}, [
          h("b", {}, [p.title || "Story " + p.id]),
          h("span", { class: "meta small" }, [
            p.last ? " Chapter " + p.last.chapter + " \u00b7 " + p.last.percent + "% read" : "",
            p.mark ? (p.last ? " \u00b7 " : " ") + "\u2605 bookmark in Chapter " + p.mark.chapter : "",
          ]),
        ]),
        h("div", { class: "row" }, [
          p.last ? h("a", { class: "btn btn-primary btn-small", href: "#/stories/" + p.id + "?resume=1" }, ["Continue"]) : null,
          p.mark ? h("a", { class: "btn btn-secondary btn-small", href: "#/stories/" + p.id + "?mark=1" }, ["Bookmark"]) : null,
          h("button", { type: "button", class: "text-button", onClick: (e) => { reading.forget(contracts.stories, p.id); e.target.closest("li").remove(); } }, ["Forget"]),
        ]),
      ]))),
    ]));
  };
  showPlaces(reading.list(contracts.stories).slice(0, 12));
  const pendingPlaces = currentAddress() ? reading.pendingWallet(contracts.stories) : [];
  if (pendingPlaces.length) {
    append(container, h("div", { class: "mine-section" }, [walletPlacesControl(pendingPlaces,
      plural(pendingPlaces.length, "bookmark") + " in this browser " + (pendingPlaces.length === 1 ? "isn't" : "aren't") + " in your wallet yet.")]));
  }
  if (currentAddress()) {
    (async () => {
      const me = currentAddress();
      const res = await read("stories", "get_reading_places", { reader: me, start: "0", limit: 50 }).catch(() => null);
      const chainPlaces = res && Array.isArray(res.values) ? res.values : [];
      for (const cp of chainPlaces) {
        const local = reading.load(contracts.stories, cp.story_id);
        const at = Number(cp.at || 0) * 1000;
        if (Number(cp.seq || 0) > 0 && at > reading.markChangedAt(local)) {
          const st = await read("stories", "get_story", { story_id: String(cp.story_id) }).catch(() => ({}));
          reading.setMark(contracts.stories, cp.story_id, { seq: Number(cp.seq), chapter: cp.chapter, percent: cp.percent, title: st.title || "" }, undefined, at, { fromWallet: true });
        }
      }
      if (chainPlaces.length) showPlaces(reading.list(contracts.stories).slice(0, 12));
    })().catch(() => {});
  }
  const address = currentAddress();
  if (!address) {
    append(container, h("div", { class: "card", style: null }, [
      h("p", { class: "body-2" }, ["Connect a wallet to see your stories."]),
      connectButton(),
    ]));
    return;
  }
  const opened = h("div", { class: "card-grid" }, [loadingLine("Reading your stories…")]);
  const written = h("div", { class: "card-grid" }, [loadingLine("Reading the stories you write in…")]);
  append(container,
    h("section", { class: "mine-section" }, [h("h2", { class: "h2" }, ["Opened by you"]), opened]),
    h("section", { class: "mine-section" }, [
      h("h2", { class: "h2" }, ["Stories you write in or are invited to"]),
      written,
    ])
  );
  (async () => {
    const mineIds = await openedStoryIds(address);
    const openedRows = await storyRows(mineIds);
    replace(opened, ...(openedRows.length
      ? openedRows.map((row) => storyCard(row))
      : [h("div", { class: "empty" }, [h("p", { class: "serif" }, ["You haven't opened a story yet."]), h("p", {}, [h("a", { class: "link-arrow", href: "#/open" }, ["Open a story", icons.arrow()])])])]));
    const invitedIds = await invitedStoryIds(address).catch(() => []);
    const writtenIds = Array.from(new Set([...(await writtenStoryIds(address)), ...invitedIds])).filter((id) => !mineIds.includes(id));
    const writtenRows = await storyRows(writtenIds);
    replace(written, ...(writtenRows.length
      ? writtenRows.map((row) => storyCard(row))
      : [h("div", { class: "empty" }, [h("p", { class: "meta" }, ["You haven't written in or been invited to anyone else's story yet."])])]));
  })().catch((error) => replace(opened, notice("bad", h("p", {}, [explainFailure(error)]))));
}
