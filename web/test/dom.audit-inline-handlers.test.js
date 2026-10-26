// Audit 2026-10 (Info, CSP): the h() DOM helper can never create an inline
// on* handler attribute from a string, nor a javascript: link.
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
}
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (data) => ({ nodeType: 3, data }),
};
const { h } = await import("../src/ui/dom.js");

test("an on* key with a string (any case) throws instead of writing an inline handler", () => {
  for (const key of ["onclick", "onClick", "ONERROR", "onload", "onfocus"]) {
    assert.throws(() => h("div", { [key]: "alert(1)" }), /must be a function/, key);
    assert.throws(() => h("div", { [key]: { toString: () => "alert(1)" } }), /must be a function/, key);
  }
});

test("function handlers become listeners, never attributes", () => {
  const fn = () => {};
  const el = h("button", { onClick: fn, onSubmit: fn });
  assert.equal(el.listeners.click, fn);
  assert.equal(el.listeners.submit, fn);
  assert.deepEqual(Object.keys(el.attributes).filter((k) => /^on/i.test(k)), []);
});

test("script URLs and raw-HTML attributes are refused", () => {
  for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "vbscript:x", "data:text/html,<script>"]) {
    assert.throws(() => h("a", { href }), /unsafe href/, href);
  }
  assert.throws(() => h("iframe", { srcdoc: "<script>" }), /not allowed/);
  for (const ok of ["#/stories/1", "https://koinvault.app/", "mailto:a@b.example", "blob:https://x/1", "./terms/v1.md"]) {
    assert.equal(h("a", { href: ok }).attributes.href, ok);
  }
});
