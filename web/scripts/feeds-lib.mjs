/**
 * Building the RSS feeds (scripts/build-feeds.mjs), kept apart so the tests
 * can check it without a network. Text from the chain is always escaped.
 */

export function escapeXml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

function clip(text, n) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

const KINDS = { 1: "book", 2: "short story", 3: "poem" };

/** The newest visible parts of public stories: [{ title, link, guid, description, date }]. */
export function latestParts(rows, site, limit) {
  const items = [];
  for (const { id, story, parts } of rows) {
    if (Number(story.visibility) !== 1) continue;
    for (const { seq, segment } of parts || []) {
      if (!segment || Number(segment.status) === 2 || segment.hidden || !segment.text) continue;
      const at = Number(segment.created_at || 0);
      if (!at) continue;
      items.push({
        title: "New part in “" + clip(story.title || "Untitled", 80) + "”",
        link: site + "#/stories/" + id,
        guid: site + "#/stories/" + id + "/part/" + seq,
        description: clip(segment.text, 300),
        date: new Date(at * 1000),
      });
    }
  }
  return items.sort((a, b) => b.date - a.date).slice(0, limit);
}

/** Public stories, newest first. */
export function newestStories(rows, site, limit) {
  return rows
    .filter(({ story }) => Number(story.visibility) === 1 && Number(story.created_at || 0) > 0)
    .map(({ id, story }) => ({
      title: clip(story.title || "Untitled", 100),
      link: site + "#/stories/" + id,
      guid: site + "#/stories/" + id,
      description: "A new " + (KINDS[Number(story.kind)] || "story") + " on SwarmTales, open to writers." + (story.summary ? " " + clip(story.summary, 300) : ""),
      date: new Date(Number(story.created_at) * 1000),
    }))
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
}

export function feedXml({ title, link, self, description, items, now }) {
  const item = (i) => "    <item>\n" +
    "      <title>" + escapeXml(i.title) + "</title>\n" +
    "      <link>" + escapeXml(i.link) + "</link>\n" +
    '      <guid isPermaLink="false">' + escapeXml(i.guid) + "</guid>\n" +
    "      <pubDate>" + i.date.toUTCString() + "</pubDate>\n" +
    "      <description>" + escapeXml(i.description) + "</description>\n" +
    "    </item>\n";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n' +
    "    <title>" + escapeXml(title) + "</title>\n" +
    "    <link>" + escapeXml(link) + "</link>\n" +
    '    <atom:link href="' + escapeXml(self) + '" rel="self" type="application/rss+xml"/>\n' +
    "    <description>" + escapeXml(description) + "</description>\n" +
    "    <lastBuildDate>" + now.toUTCString() + "</lastBuildDate>\n" +
    "    <ttl>60</ttl>\n" +
    items.map(item).join("") +
    "  </channel>\n</rss>\n";
}
