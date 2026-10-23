// Audit 2026-10 M-1 (site side): archive and admin take-over dates are on the
// Stories "activity clock" (paused time doesn't count), archiving needs both
// the text and the opener to be quiet, and revive is refused while the
// opener's next open would cost more than the normal price.
import assert from "node:assert/strict";
import test from "node:test";
import { archiveDeadline, clockNow, deadline, reviveDecision, takeOverDeadline } from "../src/lib/activity.js";

const DAY = 86400;
const cfg = { archive_days: 60, inactivity_days: 30, paused_at: "0", paused_seconds: "0", open_limit: 10 };

test("the activity clock is wall time minus every paused second, and stands still while paused", () => {
  assert.equal(clockNow(cfg, 1000), 1000n);
  assert.equal(clockNow({ ...cfg, paused_seconds: "300" }, 1000), 700n);
  assert.equal(clockNow({ ...cfg, paused_seconds: "300", paused_at: "900" }, 1000), 600n);
  assert.equal(clockNow({ ...cfg, paused_seconds: "300", paused_at: "900" }, 5000), 600n, "no time passes while paused");
});

test("archiving needs both the text and the opener quiet, on the activity clock", () => {
  const now = 80 * DAY;
  const story = { status: 1, last_activity_at: String(10 * DAY), opener_last_active: String(30 * DAY) };
  const d = archiveDeadline(story, cfg, now);
  assert.equal(d.due, false);
  assert.equal(d.at, 90 * DAY, "the opener's later activity sets the date");
  assert.equal(archiveDeadline({ ...story, opener_last_active: String(10 * DAY) }, cfg, now).due, true);
  // 20 days of earlier pause push the wall date back by 20 days.
  assert.equal(archiveDeadline(story, { ...cfg, paused_seconds: String(20 * DAY) }, now).at, 110 * DAY);
  assert.equal(archiveDeadline(story, cfg, 95 * DAY).due, true);
  // While paused nothing becomes due.
  const paused = archiveDeadline({ ...story, opener_last_active: "0" }, { ...cfg, paused_at: String(now - DAY) }, now);
  assert.equal(paused.due, false);
  assert.equal(paused.paused, true);
  assert.equal(archiveDeadline({ ...story, status: 2 }, cfg, now), null);
});

test("admin take-over: asked, or the opener quiet for inactivity_days; only for eligible stories", () => {
  const now = 100 * DAY;
  const locked = { status: 2, opener_last_active: String(80 * DAY) };
  assert.equal(takeOverDeadline(locked, cfg, now, false).at, 110 * DAY);
  assert.equal(takeOverDeadline({ ...locked, opener_last_active: String(60 * DAY) }, cfg, now, false).due, true);
  assert.equal(takeOverDeadline({ ...locked, admin_finalize_requested: true }, cfg, now, false).requested, true);
  assert.equal(takeOverDeadline({ status: 1, opener_last_active: "0" }, cfg, now, false), null, "open and not ready");
  assert.ok(takeOverDeadline({ status: 1, opener_last_active: "0" }, cfg, now, true));
  assert.equal(takeOverDeadline({ status: 3, finalizer_is_admin: true }, cfg, now, false), null);
  assert.deepEqual(deadline(5, cfg, 10), { due: true, at: 0, paused: false });
});

test("revive: archived, once, not paused, not blocked, and only at the normal open price", () => {
  const story = { status: 5 };
  const account = { openCount: 1, openMultiplier: 1, blocked: false };
  assert.equal(reviveDecision({ story, cfg, account }).ok, true);
  assert.match(reviveDecision({ story, cfg, account: { ...account, openCount: 4, openMultiplier: 2 } }).reason, /normal price/);
  assert.equal(reviveDecision({ story: { status: 5, revived: true }, cfg, account }).ok, false);
  assert.equal(reviveDecision({ story, cfg, account: { ...account, blocked: true } }).ok, false);
  assert.equal(reviveDecision({ story, cfg: { ...cfg, paused: true }, account }).ok, false);
  assert.equal(reviveDecision({ story: { status: 1 }, cfg, account }).ok, false);
});
