// The page's own source, for the audit tests that check one decision in it.
// The page is split into src/main.js, src/app/*.js and src/pages/*.js; these
// helpers read them all, and slice one top-level function out of them.
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../../src/", import.meta.url);

function filesIn(dir) {
  return readdirSync(new URL(dir, SRC)).filter((f) => f.endsWith(".js")).sort().map((f) => new URL(dir + f, SRC));
}

/** Every page module's text, joined. */
export function appSource() {
  return [new URL("main.js", SRC), ...filesIn("app/"), ...filesIn("pages/")].map((u) => readFileSync(u, "utf8")).join("\n");
}

/** The text of one top-level function (from "function name(" to its closing brace at column 0). */
export function fnBody(src, name) {
  const start = src.search(new RegExp("^(?:export )?(?:async )?function " + name + "\\(", "m"));
  if (start < 0) throw new Error("can't find function " + name);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 2);
}
