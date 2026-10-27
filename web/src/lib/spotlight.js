/**
 * Which prompt is this week's: the newest entry whose start date (UTC,
 * YYYY-MM-DD) has come. Entries with a bad date or story number are skipped.
 * Returns { current, past } (past newest first, at most `keep`).
 */
export function promptsNow(entries, now = new Date(), keep = 8) {
  const today = now.toISOString().slice(0, 10);
  const ok = (entries || []).filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.start)) && /^[1-9]\d*$/.test(String(e.storyId)) && String(e.prompt || "").trim());
  const started = ok.filter((e) => e.start <= today).sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return { current: started[0] || null, past: started.slice(1, 1 + keep) };
}
