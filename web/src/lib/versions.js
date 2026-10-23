// get_versions returns at most this many per call (AB-060), fewer when they
// are long (AB-070).
export const VERSIONS_PER_READ = 5;

/**
 * Every kept version of a part, oldest first. `ask(from, count)` makes one
 * get_versions read and returns its result ({ values, next }). A page of long
 * versions stops early, so each read goes on from the returned next, or right
 * after the last version returned (AB-070); a failed read is tried again for
 * one version. Kept by number, so a Stories version that returns them all at
 * once reads the same.
 */
export async function readAllVersions(ask, versionCount) {
  const total = Number(versionCount || 0);
  const byNumber = new Map();
  let from = 1;
  while (from <= total) {
    let res;
    try {
      res = await ask(from, VERSIONS_PER_READ);
    } catch {
      res = await ask(from, 1);
    }
    const values = (res && res.values) || [];
    const page = values.filter((v) => !byNumber.has(Number(v.version)));
    if (!page.length) break;
    for (const v of page) byNumber.set(Number(v.version), v);
    const last = Math.max(...values.map((v) => Number(v.version)));
    const next = Number((res && res.next) || 0);
    from = next > from ? next : last + 1;
  }
  return [...byNumber.values()].sort((a, b) => Number(a.version) - Number(b.version));
}
