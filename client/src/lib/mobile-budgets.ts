/**
 * Task 071 (MX-006) — the mobile performance budgets, as constants with
 * their reasons, enforced by the mobile browser suite (client/e2e/mobile)
 * against the production build. The pattern is Phase 7's latency budgets:
 * a number with a rationale is a contract; a number in a test is a guess.
 *
 * The device profile is a mid-tier Android on a fair mobile connection —
 * the median phone of the audience, not the flagship on office Wi-Fi.
 */

/** Chrome's "Slow 4G" preset (the profile Lighthouse calls "mobile"). */
export const MID_TIER_NETWORK = {
  downloadKbps: 1600,
  uploadKbps: 750,
  latencyMs: 150,
} as const;

/** CPU throttle vs a laptop: a 2022 mid-tier Android runs ~4× slower. */
export const MID_TIER_CPU_SLOWDOWN = 4;

/**
 * Time from navigation to the first market row a user can tap, on the
 * profile above, from a cold cache. The number a user feels: under this,
 * the app is "instant enough" for a game-time check on the sofa.
 */
export const FIRST_MARKET_ROW_MS = 6_000;

/**
 * Same journey, warm cache (a second visit, or the installed app): the
 * service worker serves the shell and the hashed assets, so only the API
 * round-trips remain.
 */
export const WARM_FIRST_MARKET_ROW_MS = 2_500;

/**
 * Gzipped JavaScript the first market view downloads, in bytes, as the
 * mobile suite can measure it: the production build with the auth SDK
 * shimmed out (`VITE_E2E_AUTH=shim`), i.e. everything Mantua itself ships.
 * Measured 2026-09-19: 1.63 MB in one vendor chunk before task 071;
 * 340 kB across six chunks after the lazy routes and the vendor split.
 *
 * The unshimmed production build adds the auth provider's wallet stack to
 * the same path — 1.39 MB gzip on 2026-09-19 (`PRODUCTION_EAGER_JS_GZIP`)
 * — which no build setting removes; that is an auth-provider decision and
 * is recorded in docs/design/mobile-benchmark.md as the next cut.
 */
export const CRITICAL_JS_GZIP_MAX_BYTES = 450_000;

/** The largest single chunk on the measured critical path, gzipped. */
export const LARGEST_CHUNK_GZIP_MAX_BYTES = 350_000;

/**
 * The recorded production figure (index + vendor, gzipped), not enforced by
 * the suite because the auth SDK cannot initialise without a real app id.
 * Re-measure with `vite build` and sum the chunks `index-*.js` imports.
 */
export const PRODUCTION_EAGER_JS_GZIP_2026_09_19 = 1_455_784;

/** Tap-to-visible for the trade sheet and the ticket's re-quote, in ms. */
export const INTERACTION_MS = 300;

/** The viewports the suite runs at: the small and large ends of the market. */
export const MOBILE_VIEWPORTS = {
  small: { width: 360, height: 740 },
  large: { width: 430, height: 932 },
} as const;
