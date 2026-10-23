/**
 * Discover: the story shelves with stage, kind and category filters, and the
 * story card the home page and My stories use too.
 */
import { explainFailure } from "../lib/errors.js";
import { KIND, label, VISIBILITY } from "../lib/labels.js";
import { append, h, icons, replace } from "../ui/dom.js";
import { state } from "../app/state.js";
import { clip, plural } from "../app/format.js";
import { charsLine, isPublic, progressBar, statusPill, storyCategories } from "../app/story.js";
import { loadingLine, notice, setMeta } from "../app/ui.js";
import { firstLine, loadLibrary } from "../app/data.js";

export function storyCard(row, excerptText) {
  const story = row.story;
  const meta = [storyCategories(story)[0], label(KIND, story.kind)].filter(Boolean).join(" · ");
  const line = h("p", { class: "card-line" }, [excerptText == null ? "" : clip(excerptText, 150)]);
  if (excerptText == null) {
    firstLine(row.id).then((text) => {
      line.textContent = clip(text, 150);
    });
  }
  return h("a", { class: "story-card", href: "#/stories/" + row.id }, [
    h("div", { class: "card-top" }, [
      h("p", { class: "meta" }, [meta]),
      h("div", { class: "pills" }, [
        Number(story.visibility) !== 1 ? h("span", { class: "pill pill-neutral" }, [label(VISIBILITY, story.visibility)]) : null,
        statusPill(story),
      ]),
    ]),
    h("h3", { class: "card-title" }, [story.title || "Untitled"]),
    line,
    progressBar(story, charsLine(story)),
  ]);
}

export function pickFeatured(rows) {
  const open = rows.filter((row) => isPublic(row.story) && Number(row.story.status) === 1);
  const pool = open.length ? open : rows.filter((row) => isPublic(row.story));
  return pool
    .slice()
    .sort((a, b) => Number(b.story.last_activity_at || 0) - Number(a.story.last_activity_at || 0));
}

const TABS = [
  ["open", "Open for writing", (s) => Number(s.status) === 1],
  ["finishing", "Being finished", (s) => Number(s.status) === 2 || Number(s.status) === 3],
  ["finished", "Finished", (s) => Number(s.status) === 4],
];

const KINDS = [
  ["all", "All", () => true],
  ["book", "Books", (s) => Number(s.kind) === 1],
  ["short", "Short stories", (s) => Number(s.kind) === 2],
];

export function renderDiscover(page) {
  setMeta("Discover stories", "Find a collaborative story to read, or one that is still open for new writers.");
  const container = h("div", { class: "container page" });
  append(page, container);
  append(container, 
    h("h1", { class: "title" }, ["Find a story to read, or to write in"]),
    h("p", { class: "lede", style: null }, ["Stories that are still being written welcome new writers. Finished ones read like any book."])
  );
  container.lastChild.style.marginTop = "12px";
  const filters = h("div", { class: "filters" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Category" });
  const count = h("p", { class: "meta", "aria-live": "polite" });
  const grid = h("div", { class: "card-grid" }, [loadingLine("Reading the shelves…")]);
  const filterBlock = h("div", { class: "stack" }, [filters, chips, count, grid]);
  filterBlock.style.marginTop = "40px";
  append(container, filterBlock);

  if (!state.overview) {
    replace(grid, loadingLine(state.chainError ? "Stories will appear when the network answers." : "Connecting to the story network…"));
    return;
  }

  function draw(library) {
    const all = (library ? library.stories : []).filter((row) => isPublic(row.story));
    const tab = TABS.find((t) => t[0] === state.discover.tab) || TABS[0];
    const kind = KINDS.find((k) => k[0] === state.discover.kind) || KINDS[0];
    const inTab = all.filter((row) => tab[2](row.story) && kind[2](row.story));

    replace(filters, 
      h("div", { class: "tabbar", role: "group", "aria-label": "Story stage" }, TABS.map(([id, text]) =>
        h("button", { type: "button", "aria-pressed": String(state.discover.tab === id), onClick: () => { state.discover.tab = id; draw(library); } }, [text]))),
      h("div", { class: "segmented", role: "group", "aria-label": "Kind" }, KINDS.map(([id, text]) =>
        h("button", { type: "button", "aria-pressed": String(state.discover.kind === id), onClick: () => { state.discover.kind = id; draw(library); } }, [text])))
    );

    const counts = new Map();
    for (const row of inTab) {
      for (const id of [Number(row.story.category_1 || 0), Number(row.story.category_2 || 0)]) {
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    const cats = state.overview.categories.filter((c) => c.active || counts.has(c.id));
    replace(chips, 
      h("button", { type: "button", "aria-pressed": String(!state.discover.category), onClick: () => { state.discover.category = 0; draw(library); } }, ["All categories"]),
      ...cats.map((c) => h("button", {
        type: "button",
        "aria-pressed": String(state.discover.category === c.id),
        onClick: () => { state.discover.category = c.id; draw(library); },
      }, [c.name, h("span", { class: "count" }, [String(counts.get(c.id) || 0)])]))
    );

    const cat = state.discover.category;
    const shown = cat ? inTab.filter((row) => Number(row.story.category_1) === cat || Number(row.story.category_2) === cat) : inTab;
    shown.sort((a, b) => Number(b.story.last_activity_at || 0) - Number(a.story.last_activity_at || 0));
    count.textContent = plural(shown.length, "story", "stories") + (library && library.truncated ? " (showing the first 200 on the network)" : "");
    if (!shown.length) {
      replace(grid, h("div", { class: "empty" }, [
        h("p", { class: "serif" }, ["No stories here yet."]),
        h("p", { class: "meta" }, ["Try another category, or open the first one yourself."]),
        h("p", {}, [h("a", { class: "link-arrow", href: "#/open" }, ["Open a story", icons.arrow()])]),
      ]));
      grid.style.display = "block";
      return;
    }
    grid.style.display = "";
    replace(grid, ...shown.map((row) => storyCard(row)));
  }

  loadLibrary().then(draw).catch((error) => replace(grid, notice("bad", h("p", {}, [explainFailure(error)]))));
}
