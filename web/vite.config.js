import { defineConfig } from "vite";
import { NETWORKS, SITE } from "./src/config.js";
import { canonicalBase, customDomain } from "./src/lib/site.js";

/**
 * Content-Security-Policy for the built site. GitHub Pages can't send headers,
 * so it goes in a <meta> tag. It is added at build time only, because the
 * dev server injects its own scripts.
 *
 * - scripts, styles, fonts: only files from this site
 * - network: only the Koinos nodes and KOIN Vault's API
 * - no frames, no plugins, forms post nowhere
 *
 * Why 'unsafe-eval' stays (checked October 2026, koilib 9.4.0, protobufjs 7):
 * koilib encodes and decodes every contract call with protobufjs reflection
 * types built at run time from the contract ABIs (koilib Serializer ->
 * protobufjs Type.create/encode/decode). protobufjs builds each type's
 * constructor, encoder and decoder with @protobufjs/codegen, which calls
 * Function(source). There is no switch to turn that off: the only codegen-free
 * protobufjs path is ahead-of-time static code (pbjs -t static-module), which
 * koilib's Serializer cannot use. With code generation blocked, the first
 * contract read fails ("EvalError: Code generation from strings disallowed",
 * reproduced with node --disallow-code-generation-from-strings). Removing it
 * would mean replacing koilib's serializer. Inline and third-party scripts
 * stay blocked, so 'unsafe-eval' only matters if an attacker can already run
 * code here; the page never passes its own data to eval/Function.
 */
function contentSecurityPolicy() {
  const nodes = Object.values(NETWORKS).map((n) => new URL(n.rpc).origin);
  const policy = [
    "default-src 'self'",
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

/**
 * The site's own address (SITE.url in src/config.js, audit M-7): the page's
 * canonical link and og:url, and, once SITE.url is a custom domain, the
 * CNAME file GitHub Pages expects. While SITE.url is a github.io address no
 * CNAME is written. (With the GitHub Actions Pages deploy, the custom domain
 * itself is set in Settings > Pages; the file keeps the published copy
 * self-describing and matches what a branch deploy would need.)
 */
function siteAddress() {
  const base = canonicalBase(SITE.url);
  const domain = customDomain(SITE.url);
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    name: "swarmtales-site-address",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        '<meta property="og:type" content="website" />',
        '<link rel="canonical" href="' + escape(base) + '" />\n    <meta property="og:url" content="' + escape(base) + '" />\n    <meta property="og:type" content="website" />'
      );
    },
    generateBundle() {
      if (domain) this.emitFile({ type: "asset", fileName: "CNAME", source: domain + "\n" });
    },
  };
}

// Relative asset paths ("./"), so the same build works on GitHub Pages
// (https://<user>.github.io/<repo>/), at the root of a custom domain, and on
// a local static server. Only SITE.url changes when the domain does.
export default defineConfig({
  base: "./",
  plugins: [contentSecurityPolicy(), siteAddress()],
  // Names this release's offline cache (public/sw.js): the commit on GitHub, "dev" locally.
  define: { __BUILD_ID__: JSON.stringify(String(process.env.GITHUB_SHA || "dev").slice(0, 12)) },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      output: {
        // The libraries in their own files, so the site's own code stays small
        // and a site update doesn't make browsers download them again.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/]koilib[\\/]/.test(id)) return "koilib";
          if (/[\\/]node_modules[\\/]google-protobuf[\\/]/.test(id)) return "google-protobuf";
          if (/[\\/]node_modules[\\/](protobufjs|@protobufjs|long)[\\/]/.test(id)) return "protobuf";
          if (/[\\/]node_modules[\\/](@noble|@scure|bs58|base-x|multibase|multiformats)/.test(id)) return "crypto";
          return "vendor";
        },
      },
    },
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
