// Red-team (Insider) attack test, SwarmTales fix check @ 42f6af9.
// Attack: anyone with write access to the repo pushes a branch whose
// checker/check.mjs prints MODERATOR_WIF, then runs "Copy checker" with
// workflow_dispatch on that branch. The job has no `environment:`, so the
// repository secret is handed to whatever code is on the chosen branch.
// docs/KEY_CUSTODY.md §5 says to keep the key "in a protected copy-checker
// environment limited to the main branch", but if the owner does that, this
// job (no `environment: copy-checker`) gets an EMPTY secret and the checker
// silently stops hiding ("without it the checker only reports").
// Asserts the SAFE behaviour: the job that reads MODERATOR_WIF names the
// copy-checker environment. FAILS while the workflow lacks it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const file = new URL("../../.github/workflows/copy-checker.yml", import.meta.url);

test("RT-INS: the job holding MODERATOR_WIF runs in the protected copy-checker environment", () => {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const jobsAt = lines.findIndex((l) => l === "jobs:");
  assert.ok(jobsAt >= 0, "no jobs: block");
  let name = null;
  const body = {};
  for (const line of lines.slice(jobsAt + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([\w-]+):\s*$/.exec(line);
    if (m) body[(name = m[1])] = [];
    else if (name) body[name].push(line);
  }
  const holders = Object.entries(body).filter(([, b]) => b.some((l) => /secrets\.MODERATOR_WIF/.test(l)));
  assert.ok(holders.length > 0, "no job reads MODERATOR_WIF");
  for (const [job, b] of holders) {
    const i = b.findIndex((l) => /^ {4}environment:/.test(l));
    const env = i < 0 ? '' : b[i] + ' ' + (b[i + 1] || '');
    assert.ok(/copy-checker/.test(env), "RT-INS: job '" + job + "' reads MODERATOR_WIF with no copy-checker environment (any branch can be dispatched with the key)");
  }
});
