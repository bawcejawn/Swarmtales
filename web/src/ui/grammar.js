import { h } from "./dom.js";

/**
 * "Check spelling & grammar": asks LanguageTool's free public service
 * (no key; about 20 checks a minute per person). The text is sent only when
 * the writer presses the button. Each suggestion can be applied with a tap.
 */
const ENDPOINT = "https://api.languagetool.org/v2/check";

export async function checkText(text, language = "auto") {
  const body = new URLSearchParams({ text, language, enabledOnly: "false" });
  if (language === "auto") body.set("preferredVariants", "en-US");
  const res = await fetch(ENDPOINT, { method: "POST", body, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status === 429 ? "The free checker is busy. Try again in a minute." : "The spelling checker didn't answer (" + res.status + ").");
  const data = await res.json();
  return (data.matches || []).map((m) => ({
    offset: m.offset,
    length: m.length,
    found: text.slice(m.offset, m.offset + m.length),
    message: m.shortMessage || m.message || "",
    fix: m.replacements && m.replacements.length ? m.replacements[0].value : null,
    kind: m.rule && m.rule.issueType ? m.rule.issueType : "",
  }));
}

/** A button plus a results list, attached to a textarea. */
export function grammarTool(area, onChange) {
  const list = h("ul", { class: "grammar-list" });
  const note = h("p", { class: "meta small", "aria-live": "polite" });
  const button = h("button", { type: "button", class: "btn btn-secondary btn-small" }, ["Check spelling & grammar"]);
  const run = async () => {
    const text = area.value;
    if (!text.trim()) return;
    button.disabled = true;
    note.textContent = "Checking…";
    list.replaceChildren();
    try {
      const issues = await checkText(text);
      if (area.value !== text) return; // changed while checking
      note.textContent = issues.length
        ? issues.length + " suggestion" + (issues.length === 1 ? "" : "s") + ". Tap Fix to apply one, or ignore it."
        : "No spelling or grammar problems found.";
      for (const issue of issues.slice(0, 15)) {
        const fix = issue.fix == null ? null : h("button", { type: "button", class: "text-button", onClick: () => {
          if (area.value.slice(issue.offset, issue.offset + issue.length) !== issue.found) return run();
          area.value = area.value.slice(0, issue.offset) + issue.fix + area.value.slice(issue.offset + issue.length);
          area.dispatchEvent(new Event("input"));
          if (onChange) onChange();
          run();
        } }, ["Fix"]);
        list.append(h("li", {}, [
          h("span", { class: "grammar-found" }, ["“" + issue.found + "”"]),
          issue.fix != null ? " → " + (issue.fix === "" ? "(remove)" : "“" + issue.fix + "”") : "",
          h("span", { class: "meta small" }, [" " + issue.message]),
          fix ? " " : null, fix,
        ]));
      }
    } catch (error) {
      note.textContent = error && error.message ? error.message : "The spelling checker didn't answer.";
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener("click", run);
  return h("div", { class: "grammar-tool" }, [button, note, list]);
}
