import { defineConfig } from "vite";
import { NETWORKS } from "./src/config.js";

/**
 * Content-Security-Policy for the built site. GitHub Pages can't send headers,
 * so it goes in a <meta> tag. It is added at build time only, because the
 * dev server injects its own scripts.
 *
 * - scripts, styles, fonts: only files from this site
 * - network: only the Koinos nodes and KOIN Vault's API
 * - no frames, no plugins, forms post nowhere
 */
function contentSecurityPolicy() {
  const nodes = Object.values(NETWORKS).map((n) => new URL(n.rpc).origin);
  const policy = [
    "default-src 'self'",
    // koilib's protobuf library builds its encoders with new Function(), so
    // 'unsafe-eval' is required. Inline and third-party scripts stay blocked.
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    // LanguageTool: the free spelling and grammar check (text is sent only when the writer asks).
    "connect-src 'self' " + nodes.join(" ") + " https://koinvault.app https://api.languagetool.org",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
  return {
    name: "swarmtales-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="utf-8" />',
        '<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="' + policy + '" />'
      );
    },
  };
}

// Relative asset paths so the same build works on GitHub Pages
// (https://<user>.github.io/<repo>/), a later custom domain, and a local static server.
export default defineConfig({
  base: "./",
  plugins: [contentSecurityPolicy()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
