import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      // Claude Code session worktrees — sibling checkouts of this repo whose
      // tsconfigs otherwise register as extra TSConfigRootDir candidates and
      // fail every parse.
      "**/.claude/**",
      // Throwaway operator scripts (verification/one-off ops) — outside the
      // tsconfig project, so typed lint rules crash on them.
      "**/*.scratch.*",
      "**/.vercel/**",
      "**/.vite/**",
      // esbuild-generated server bundles for the Vercel function (see
      // scripts/build-server.mjs) — vendored code, not ours to lint.
      "api/_*.mjs",
      "**/coverage/**",
      "contracts/out/**",
      "contracts/cache/**",
      "contracts/lib/**",
      // Hook submodules are Foundry projects (Solidity + vendored lib/ trees
      // that carry their own eslint configs) — not ours to lint.
      "contracts/hooks/**",
      "server/drizzle/migrations/**",
      "Mantua Prototype.html",
      "/src/**",
      "/landing/**",
      "/assets/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        project: ["./client/tsconfig.app.json", "./client/tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["server/**/*.ts"],
    // Workspace config files (e.g. drizzle.config.ts) live outside the
    // tsconfig `include`, so don't apply the type-aware project to them —
    // the out-of-project override below handles them instead.
    ignores: ["server/**/*.config.{js,cjs,mjs,ts}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        project: ["./server/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["agent/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        project: ["./agent/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Test files use node:test's test()/describe()/it(), which intentionally
  // return un-awaited promises (the runner tracks them). Don't flag those.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  // Files outside the client/server tsconfig projects (one-off Node
  // scripts and root-level config files). Keep syntactic rules but
  // disable type-aware ones so we don't have to maintain a dedicated
  // tsconfig project for them.
  {
    files: [
      "api/**/*.ts",
      "contracts/script/**/*.ts",
      "eslint.config.js",
      // Build/vendor scripts (scripts/build-server.mjs, server/dcw-entry.mjs)
      // live outside any tsconfig project — lint them as plain Node scripts.
      "**/*.mjs",
      // Config files at the repo root or inside a workspace (e.g.
      // server/drizzle.config.ts) live outside any tsconfig `include`, so
      // type-aware linting can't resolve them — treat them as plain Node
      // scripts.
      "**/*.config.{js,cjs,mjs,ts}",
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
  // Allow intentionally-unused identifiers prefixed with `_` (kept-for-shape
  // function params, caught errors, etc.) across all workspaces.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
