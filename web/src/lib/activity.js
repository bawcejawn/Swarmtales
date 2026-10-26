/**
 * Story deadlines on Stories' "activity clock" (audit M-1).
 *
 * story.last_activity_at and story.opener_last_active are kept in activity
 * seconds: wall time minus every second Stories spent paused. So
 *   clockNow = now - paused_seconds - (paused_at > 0 ? now - paused_at : 0)
 * and a deadline D on that clock falls (wall time) at now + (D - clockNow),
 * provided Stories isn't paused again. While paused, the clock stands still,
 * so no deadline arrives.
 *
 * Archiving (anyone, an OPEN story): both the text and the opener must have
 * been quiet for archive_days.
 * Admin take-over of the final edit: the opener asked, or the opener has been
 * quiet for inactivity_days; only for a story that is locked, open and ready
 * to close, or in a final edit the opener runs.
 * Revive (the opener, an ARCHIVED story, once): only while their next open
 * project would still be at the normal price.
 */

const DAY = 86400n;

function big(value) {
  try {
    if (typeof value === "bigint") return value;
    const s = String(value ?? "0").trim();
    return /^[0-9]+$/.test(s) ? BigInt(s) : 0n;
  } catch {
    return 0n;
  }
}

/** The activity clock now (seconds), from Stories' config. */
export function clockNow(cfg, nowSeconds) {
  const now = big(nowSeconds);
  const pausedSeconds = big(cfg && cfg.paused_seconds);
  const pausedAt = big(cfg && cfg.paused_at);
  const current = pausedAt > 0n && now > pausedAt ? now - pausedAt : 0n;
  const clock = now - pausedSeconds - current;
  return clock > 0n ? clock : 0n;
}

/** Whether Stories is paused right now. */
export function isPaused(cfg) {
  return !!(cfg && (cfg.paused || big(cfg.paused_at) > 0n));
}

/**
 * When an activity-clock deadline falls: { due, at, paused }.
 * `at` is wall seconds (a Number, for formatting); 0 when already due.
 */
export function deadline(target, cfg, nowSeconds) {
  const clock = clockNow(cfg, nowSeconds);
  const t = big(target);
  const paused = isPaused(cfg);
  if (clock >= t) return { due: !paused, at: 0, paused };
  return { due: false, at: Number(big(nowSeconds) + (t - clock)), paused };
}

/** When anyone may archive this OPEN story (both clocks must be old enough). */
export function archiveDeadline(story, cfg, nowSeconds) {
  if (Number(story && story.status) !== 1) return null;
  const days = big(cfg && cfg.archive_days);
  if (days === 0n) return null;
  const text = big(story.last_activity_at);
  const opener = big(story.opener_last_active);
  const latest = text > opener ? text : opener;
  return deadline(latest + days * DAY, cfg, nowSeconds);
}

/**
 * When the admin may take over the final edit:
 * null (not possible for this story), or { requested, due, at, paused }.
 * `closeReady` is whether an OPEN story could be closed now.
 */
export function takeOverDeadline(story, cfg, nowSeconds, closeReady) {
  const status = Number(story && story.status);
  const eligible = status === 2 || (status === 1 && !!closeReady) || (status === 3 && !story.finalizer_is_admin);
  if (!eligible) return null;
  const paused = isPaused(cfg);
  if (story.admin_finalize_requested) return { requested: true, due: !paused, at: 0, paused };
  const days = big(cfg && cfg.inactivity_days);
  if (days === 0n) return null;
  return { requested: false, ...deadline(big(story.opener_last_active) + days * DAY, cfg, nowSeconds) };
}

/** Can the opener revive this archived story now? { ok, reason }. */
export function reviveDecision({ story, cfg, account }) {
  if (Number(story && story.status) !== 5) return { ok: false, reason: "" };
  if (story.revived) return { ok: false, reason: "This story was already brought back once. A story archived a second time stays archived." };
  if (isPaused(cfg)) return { ok: false, reason: "SwarmTales is paused for maintenance. Try again later." };
  if (account && account.blocked) return { ok: false, reason: "This wallet can no longer write on SwarmTales, so it can't bring a story back." };
  const limit = Number((cfg && cfg.open_limit) || 0);
  if (account && limit && Number(account.openCount || 0) >= limit) {
    return { ok: false, reason: "You already have the maximum number of open projects (" + limit + "). Finish or archive one first." };
  }
  if (account && Number(account.openMultiplier || 1) > 1) {
    return {
      ok: false,
      reason: "A story can only be brought back while your next story would open at the normal price. You have " +
        account.openCount + " open projects; finish one first.",
    };
  }
  return { ok: true, reason: "" };
}
