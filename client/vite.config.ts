import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * Dev runs on plain HTTP at `http://localhost:5173`. `localhost` is one
 * of the few origins the spec explicitly grants a "secure context" to
 * even over HTTP, so Privy's Web Crypto API key sharding still works.
 * Plain HTTP also lets the Claude Code preview pane render the app
 * (it can't accept a self-signed cert).
 *
 * Staging / prod must serve over real TLS (Vercel handles the frontend).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Keep all of node_modules in a single `vendor` chunk. Vite 8's
         * rolldown bundler otherwise auto-splits viem's error classes across
         * chunks such that a subclass evaluates `class extends BaseError`
         * before the chunk holding BaseError has lazily initialized — a
         * temporal-dead-zone crash ("Class extends value undefined is not a
         * constructor or null") that blanks the whole app in the production
         * build (dev is fine — esbuild doesn't split). Co-locating the
         * library keeps its strongly-connected error hierarchy in one module
         * so init order is correct.
         */
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    /**
     * Forward `/api` requests to the Express server so the browser
     * stays on `https://localhost:5173` and avoids mixed-content
     * blocks (https → http on `:3001`). The server stays plain HTTP
     * locally; production goes via Vercel + a dedicated API host
     * with real TLS.
     */
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
