// AB-007: the GitHub workflows must not let a compromised dependency or
// action reach the moderator key or a write token. Run:
//   node --test checker/__tests__/workflows.test.mjs
// The workflow files are read as text (no YAML package is installed in CI);
// they use two-space indentation, with jobs at the second level.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dir = new URL("../../.github/workflows/", import.meta.url);
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

/** A top-level block ("permissions:", "jobs:") as its lines, or []. */
function topBlock(lines, key) {
  const start = lines.findIndex((l) => l === key + ":" || l.startsWith(key + ": "));
  if (start < 0) return [];
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length && (lines[i] === "" || /^\s/.test(lines[i]) || lines[i].startsWith("#")); i++) out.push(lines[i]);
  return out;
}

/** { name: lines } for each job under "jobs:". */
function jobs(lines) {
  const out = {};
  let name = null;
  for (const line of topBlock(lines, "jobs").slice(1)) {
    const m = /^ {2}([\w-]+):\s*$/.exec(line);
    if (m) out[(name = m[1])] = [];
    else if (name) out[name].push(line);
  }
  return out;
}

/** The job's own "permissions:" block, or null when it inherits the top level. */
function jobPermissions(jobLines) {
  const i = jobLines.findIndex((l) => /^ {4}permissions:/.test(l));
  if (i < 0) return null;
  const out = [jobLines[i]];
  for (let j = i + 1; j < jobLines.length && /^ {6}/.test(jobLines[j]); j++) out.push(jobLines[j]);
  return out;
}

const code = (l) => l.replace(/\s+#.*$/, "");

for (const file of files) {
  const text = fs.readFileSync(new URL(file, dir), "utf8");
  const lines = text.split(/\r?\n/);

  test(file + ": every action is pinned to a full commit SHA", () => {
    for (const line of lines) {
      const m = /^\s*(?:- )?uses:\s*(\S+)/.exec(code(line));
      if (!m || m[1].startsWith("./")) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, file + ": " + line.trim());
    }
  });

  test(file + ": checkout never leaves the token in .git/config", () => {
    for (const [name, body] of Object.entries(jobs(lines))) {
      const checkouts = body.filter((l) => /uses:\s*actions\/checkout@/.test(l)).length;
      const off = body.filter((l) => /^\s*persist-credentials:\s*false\s*$/.test(code(l))).length;
      assert.equal(off, checkouts, file + " job " + name + ": each actions/checkout needs persist-credentials: false");
    }
  });

  test(file + ": jobs that hold secrets run no install scripts and get no write token", () => {
    const top = topBlock(lines, "permissions").map(code);
    for (const [name, body] of Object.entries(jobs(lines))) {
      if (!body.some((l) => /\$\{\{\s*secrets\./.test(l))) continue;
      for (const l of body.map(code)) {
        if (/\bnpm (ci|install|i)\b/.test(l)) assert.match(l, /--ignore-scripts/, file + " job " + name + ": " + l.trim());
      }
      const perms = jobPermissions(body) || top;
      assert.ok(perms.length, file + " job " + name + ": set permissions explicitly");
      for (const l of perms.map(code)) assert.doesNotMatch(l, /:\s*write\b/, file + " job " + name + ": " + l.trim());
    }
  });
}

test("every workflow is checked", () => {
  assert.deepEqual(files.sort(), ["copy-checker.yml", "pages.yml", "sponsor-alert.yml"]);
});

test("sponsor-alert.yml holds no secret, installs nothing and only reads", () => {
  const text = fs.readFileSync(new URL("sponsor-alert.yml", dir), "utf8");
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text.split(/\r?\n/).map(code).join("\n"), /\bnpm\b|yarn/);
  assert.match(text, /^permissions:\s*\n\s+contents: read\s*$/m);
  assert.match(text, /run: node scripts\/sponsor-alert\.mjs/);
});

// ---------- audit 2026-10: O1-09 (plan without the key), M-10 (state key), M-13 (time budget) ----------

test("copy-checker.yml: only the apply job gets the moderator key; the web-reading plan job gets no key and no environment", () => {
  const lines = fs.readFileSync(new URL("copy-checker.yml", dir), "utf8").split(/\r?\n/);
  const all = jobs(lines);
  const uses = (name, secret) => all[name].some((l) => new RegExp("secrets\\." + secret + "\\b").test(code(l)));
  const env = (name) => (all[name].find((l) => /^ {4}environment:/.test(l)) || "").replace(/^ {4}environment:\s*/, "").trim();
  assert.deepEqual(Object.keys(all).filter((n) => uses(n, "MODERATOR_WIF")), ["apply"]);
  assert.deepEqual(Object.keys(all).filter((n) => uses(n, "CHECKER_STATE_KEY")).sort(), ["apply", "load"]);
  for (const n of ["load", "apply"]) assert.equal(env(n), "copy-checker", n + " runs in the main-only environment");
  assert.equal(env("plan"), "", "the plan job runs in no environment");
  assert.ok(all.plan.some((l) => /node checker\/check\.mjs/.test(l)));
  assert.ok(all.apply.some((l) => /node checker\/apply\.mjs/.test(l)));
  assert.ok(!all.apply.some((l) => /node checker\/check\.mjs/.test(l)), "the key job never runs the web-reading step");
  assert.ok(all.plan.some((l) => /^ {4}needs: load\s*$/.test(l)) && all.apply.some((l) => /^ {4}needs: plan\s*$/.test(l)));
  // The load job (with the state key) runs no installed packages.
  assert.ok(!all.load.some((l) => /\bnpm\b|setup-node/.test(code(l))));
});

test("copy-checker.yml: the time budget is well under each job's time limit", () => {
  const lines = fs.readFileSync(new URL("copy-checker.yml", dir), "utf8").split(/\r?\n/);
  const budget = Number((/TIME_BUDGET_MINUTES:\s*"?(\d+)/.exec(lines.join("\n")) || [])[1]);
  assert.ok(budget > 0, "TIME_BUDGET_MINUTES is set");
  for (const n of ["plan", "apply"]) {
    const limit = Number((/timeout-minutes:\s*(\d+)/.exec(jobs(lines)[n].join("\n")) || [])[1]);
    assert.ok(limit - budget >= 5, n + ": " + budget + " minutes of work in a " + limit + "-minute job");
  }
});
