// Audit Bot red-team (Web attacker) test: XSS from on-chain text.
// Attack: put HTML/script payloads in story titles, part text, summaries,
// versions, citations, source notes and category names, which main.js
// renders with h()/append() from web/src/ui/dom.js (e.g. main.js:1152-1154
// citation and source_note, versionsView, the reader). Also the Terms
// markdown renderer. Every payload must end up as a text node, never as
// markup or an attribute.
// A tiny fake document records what the helpers do. Asserts the SAFE behaviour.
// Copy into web/test/ and run: node --test
import assert from "node:assert/strict";
import test from "node:test";

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.nodeType = 1;
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = "";
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  append(...c) { this.childNodes.push(...c); }
  replaceChildren(...c) { this.childNodes = [...c]; }
  set innerHTML(_v) { throw new Error("innerHTML used"); }
}
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (data) => ({ nodeType: 3, data }),
};

const { h, append } = await import("../src/ui/dom.js");
const { renderMarkdown } = await import("../src/ui/markdown.js");

const PAYLOADS = [
  "<img src=x onerror=alert(1)>",
  "</p><script>alert(document.cookie)</script>",
  "\"><svg onload=alert(1)>",
  "javascript:alert(1)",
  "{{constructor.constructor('alert(1)')()}}",
];

function walk(node, out = []) {
  out.push(node);
  for (const c of node.childNodes || []) walk(c, out);
  return out;
}

test("RT-WEB: hostile story text is rendered only as text nodes", () => {
  for (const p of PAYLOADS) {
    const el = h("div", { class: "seg" }, [
      h("p", {}, [p]),
      h("span", { class: "source-note" }, ["Source: " + p]),
      h("span", { class: "source-note", title: "copy checker" }, [p]),
    ]);
    append(el, p, [p, [p]]);
    for (const n of walk(el)) {
      if (n.nodeType === 1) {
        assert.ok(["div", "p", "span"].includes(n.tagName), "payload created element " + n.tagName);
        for (const [k] of Object.entries(n.attributes)) assert.ok(!/^on/i.test(k), "event attribute " + k);
      }
    }
    const texts = walk(el).filter((n) => n.nodeType === 3).map((n) => n.data);
    assert.ok(texts.some((t) => t.includes(p)), "payload text was dropped or altered");
  }
});

test("RT-WEB: the Terms markdown renderer never interprets HTML", () => {
  for (const p of PAYLOADS) {
    const nodes = renderMarkdown("# " + p + "\n\n- **" + p + "**\n\n" + p);
    for (const root of nodes) {
      for (const n of walk(root)) {
        if (n.nodeType === 1) assert.ok(["h1", "h2", "p", "ul", "li", "b"].includes(n.tagName), "markdown made " + n.tagName);
      }
    }
  }
});
