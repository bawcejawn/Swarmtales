import { h } from "./dom.js";

/**
 * A deliberately tiny Markdown renderer for SwarmTales' own documents
 * (the Terms of Use). It understands "# " and "## " headings, "- " lists,
 * **bold**, and paragraphs. Everything becomes text nodes: no HTML from the
 * file is ever interpreted.
 */
function inline(text) {
  const out = [];
  const parts = String(text).split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) out.push(h("b", {}, [part.slice(2, -2)]));
    else out.push(part);
  }
  return out;
}

export function renderMarkdown(source) {
  const nodes = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) nodes.push(h("p", { class: "body-2" }, inline(para.join(" "))));
    para = [];
  };
  const flushList = () => {
    if (list) nodes.push(list);
    list = null;
  };
  for (const raw of String(source).replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushPara(); flushList();
      nodes.push(h("h1", { class: "title" }, inline(line.slice(2))));
    } else if (line.startsWith("## ")) {
      flushPara(); flushList();
      nodes.push(h("h2", { class: "h3" }, inline(line.slice(3))));
    } else if (line.startsWith("- ")) {
      flushPara();
      if (!list) list = h("ul", { class: "how-list" });
      list.append(h("li", {}, inline(line.slice(2))));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return nodes;
}
