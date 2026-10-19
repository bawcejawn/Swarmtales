import { defineConfig } from "vite";

// Relative asset paths so the same build works on GitHub Pages
// (https://<user>.github.io/<repo>/), a later custom domain, and a local static server.
export default defineConfig({
  base: "./",
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
