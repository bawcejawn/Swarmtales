/** Tiny DOM helpers. Text is always inserted as text, never as HTML. */

export function h(tag, attrs, children) {
  const node = document.createElement(tag);
  const props = attrs || {};
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

export function append(node, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function replace(node, ...children) {
  node.replaceChildren();
  return append(node, ...children);
}

/** Static, trusted SVG markup written in this file only. */
function svg(markup) {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const el = document.importNode(doc.documentElement, true);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  return el;
}

export const icons = {
  logo: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M14 2.5 24 8.25v11.5L14 25.5 4 19.75V8.25Z" fill="none" stroke="#9A5B00" stroke-width="2" stroke-linejoin="round"/><path d="M14 9.5 18.3 12v5L14 19.5 9.7 17v-5Z" fill="#9A5B00"/></svg>'),
  check: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  shield: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M11 2.5 18 5.5v5c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5v-5Z" fill="none" stroke="#1F5C7A" stroke-width="1.6" stroke-linejoin="round"/><path d="m8 11 2.2 2.2L14.5 9" fill="none" stroke="#1F5C7A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  arrow: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M3 9h11M10 5l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  book: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M6 9c5-2 10-2 14 1 4-3 9-3 14-1v22c-5-2-10-2-14 1-4-3-9-3-14-1Z" fill="none" stroke="#1B1F2A" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 10v22" stroke="#1B1F2A" stroke-width="1.8"/></svg>'),
  pen: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M9 31l2-7L26 9l5 5-15 15Z" fill="none" stroke="#1B1F2A" stroke-width="1.8" stroke-linejoin="round"/><path d="M23 12l5 5" stroke="#1B1F2A" stroke-width="1.8"/><path d="M9 31h22" stroke="#9A5B00" stroke-width="1.8" stroke-linecap="round"/></svg>'),
  hive: () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M14 6 21 10v8l-7 4-7-4v-8Z M26 18l7 4v8l-7 4-7-4v-8Z M14 22l5 3" fill="none" stroke="#1B1F2A" stroke-width="1.8" stroke-linejoin="round"/><path d="M26 22.5 29 24.25v3.5L26 29.5l-3-1.75v-3.5Z" fill="#9A5B00"/></svg>'),
};
