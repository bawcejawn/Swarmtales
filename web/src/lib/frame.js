/**
 * Is this page inside another site's frame (AB-014)? GitHub Pages can't send
 * a frame-ancestors header, and a <meta> CSP can't set one, so the page checks
 * for itself and refuses to run wallet actions inside a frame (clickjacking).
 * A cross-origin parent makes `top` unreadable, which also means framed.
 */
export function isFramed(win) {
  try {
    return win.top !== win.self;
  } catch {
    return true;
  }
}
