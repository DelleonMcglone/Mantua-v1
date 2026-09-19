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
/**
 * Task 067 (G-001): under `VITE_E2E_AUTH=shim` the authentication SDK is
 * replaced by the browser suite's shim (client/e2e/privy-shim.tsx). The
 * flag is read at config time from the process env, so a production build
 * (no flag) never resolves the shim.
 */
const e2eAuthShim = process.env.VITE_E2E_AUTH === "shim";
const alias = [
  // The shims come first: the `@` entry below matches any `@/…` specifier,
  // and the first matching alias wins, so a shim for a path under `@/`
  // would never be reached if it came after.
  ...(e2eAuthShim
    ? [
        {
          find: /^@privy-io\/react-auth\/smart-wallets$/,
          replacement: path.resolve(import.meta.dirname, "e2e/privy-smart-wallets-shim.ts"),
        },
        {
          find: /^@privy-io\/react-auth$/,
          replacement: path.resolve(import.meta.dirname, "e2e/privy-shim.tsx"),
        },
        /**
         * Task 069 (V-011): the microphone and the transcription socket,
         * replaced by a scripted stand-in. Only this one module is
         * swapped — the transcript assembly, the activation rules and the
         * confirmation guard are the real ones under test.
         */
        {
          find: /^@\/features\/voice\/voice-transport\.ts$/,
          replacement: path.resolve(import.meta.dirname, "e2e/voice-transport-shim.ts"),
        },
      ]
    : []),
  { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  build: {
    rollupOptions: {
      output: {
        /**
         * Keep the wallet stack and viem in a single `vendor` chunk. Vite 8's
         * rolldown bundler otherwise auto-splits viem's error classes across
         * chunks such that a subclass evaluates `class extends BaseError`
         * before the chunk holding BaseError has lazily initialized — a
         * temporal-dead-zone crash ("Class extends value undefined is not a
         * constructor or null") that blanks the whole app in the production
         * build (dev is fine — esbuild doesn't split). Co-locating the
         * library keeps its strongly-connected error hierarchy in one module
         * so init order is correct.
         *
         * Task 071 (MX-006) — four libraries only a lazy surface needs get
         * their own leaf chunks, so they leave the critical path with the
         * surfaces that import them. Explicit `codeSplitting` groups with a
         * path `test` are used rather than `manualChunks`: rolldown's compat
         * for the latter is one name-function group, and it dragged viem into
         * the bridge chunk. Higher priority wins; none of these leaves imports
         * viem's error hierarchy back out of `vendor`, and the mobile suite
         * runs the built bundle to prove the app still boots.
         */
        codeSplitting: {
          groups: [
            // `vendor` first: rolldown gives a module shared between group
            // chunks to the highest-priority group that needs it, so the
            // wallet stack and viem must outrank the leaves or they follow
            // the bridge kit into its chunk.
            {
              name: "vendor",
              test: (id: string) =>
                /[\\/]node_modules[\\/]/.test(id) &&
                !/[\\/]node_modules[\\/](@circle-fin|@solana|@solana-program|lightweight-charts|react-plaid-link)[\\/]/.test(
                  id,
                ),
              priority: 20,
            },
            { name: "bridge-vendor", test: /[\\/]node_modules[\\/]@circle-fin[\\/]/, priority: 5 },
            {
              name: "solana-vendor",
              test: /[\\/]node_modules[\\/](@solana|@solana-program)[\\/]/,
              priority: 5,
            },
            {
              name: "charts-vendor",
              test: /[\\/]node_modules[\\/]lightweight-charts[\\/]/,
              priority: 5,
            },
            {
              name: "funding-vendor",
              test: /[\\/]node_modules[\\/]react-plaid-link[\\/]/,
              priority: 5,
            },
          ],
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
