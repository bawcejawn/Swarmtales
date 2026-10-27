/** "This week's prompt" (Wave 3): a story SwarmTales opened from a prompt. */
import { ACTIVE } from "../config.js";
import { SPOTLIGHT } from "../spotlight.js";
import { promptsNow } from "../lib/spotlight.js";
import { h } from "../ui/dom.js";

export function promptSpotlight({ withPast = false } = {}) {
  const { current, past } = promptsNow(SPOTLIGHT[ACTIVE]);
  if (!current) return null;
  return h("section", { class: "prompt-spotlight", "aria-labelledby": "prompt-title" }, [
    h("p", { class: "eyebrow" }, ["This week's prompt"]),
    h("p", { class: "prompt-text", id: "prompt-title" }, [current.prompt]),
    h("div", { class: "row" }, [
      h("a", { class: "btn btn-primary btn-small", href: "#/stories/" + current.storyId }, ["Read it and write the next part"]),
    ]),
    h("p", { class: "meta small" }, ["Opened by SwarmTales. Everyone is welcome to write in it, and every writer is credited in the finished book."]),
    withPast && past.length
      ? h("details", { class: "edit-note" }, [
        h("summary", {}, ["Earlier prompts"]),
        h("ul", { class: "prompt-past" }, past.map((p) => h("li", {}, [h("a", { href: "#/stories/" + p.storyId }, [p.prompt])]))),
      ])
      : null,
  ]);
}
