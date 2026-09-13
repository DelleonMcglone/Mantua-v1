/**
 * Task 067 (G-006 follow-up) — the Content-Security-Policy the SPA ships in
 * **report-only** mode. Every third-party origin the client loads is listed
 * once, with the reason, and `buildCsp()` renders the header value that
 * `vercel.json` carries (a test keeps the two identical). Violations post
 * to `/api/csp-report` (see routes/csp-report.ts), which is how the list
 * is proven complete before the policy is enforced (D-117).
 *
 * Host lists follow the vendor CSP guidance for the pinned SDK versions
 * (Privy react-auth 3.x, WalletConnect/Reown via Privy, Plaid Link, Google
 * Fonts) plus the Base RPC hosts in client/src/lib/chains.ts.
 */
export interface CspSource {
  origin: string;
  why: string;
}

export const CSP_REPORT_PATH = "/api/csp-report";

export const CSP_SOURCES: Record<"script" | "frame" | "connect" | "style" | "font", CspSource[]> = {
  script: [
    { origin: "https://challenges.cloudflare.com", why: "Privy's Turnstile challenge" },
    { origin: "https://cdn.plaid.com", why: "Plaid Link loader (react-plaid-link)" },
  ],
  frame: [
    { origin: "https://auth.privy.io", why: "Privy embedded-wallet iframe" },
    { origin: "https://challenges.cloudflare.com", why: "Privy's Turnstile challenge" },
    { origin: "https://verify.walletconnect.com", why: "WalletConnect verify frame" },
    { origin: "https://verify.walletconnect.org", why: "WalletConnect verify frame" },
    { origin: "https://secure.walletconnect.com", why: "WalletConnect secure frame" },
    { origin: "https://secure.walletconnect.org", why: "WalletConnect secure frame" },
    { origin: "https://cdn.plaid.com", why: "Plaid Link iframe" },
  ],
  connect: [
    { origin: "https://auth.privy.io", why: "Privy auth API" },
    { origin: "https://*.rpc.privy.systems", why: "Privy wallet RPC" },
    { origin: "wss://relay.walletconnect.com", why: "WalletConnect relay" },
    { origin: "wss://relay.walletconnect.org", why: "WalletConnect relay" },
    { origin: "wss://www.walletlink.org", why: "Coinbase Wallet link" },
    { origin: "https://explorer-api.walletconnect.com", why: "WalletConnect explorer" },
    { origin: "https://api.web3modal.org", why: "WalletConnect modal assets" },
    { origin: "https://pulse.walletconnect.org", why: "WalletConnect telemetry" },
    { origin: "https://*.plaid.com", why: "Plaid Link API" },
    { origin: "https://mainnet.base.org", why: "Base RPC (public)" },
    { origin: "https://base-rpc.publicnode.com", why: "Base RPC (public fallback)" },
  ],
  style: [{ origin: "https://fonts.googleapis.com", why: "Inter / JetBrains Mono stylesheet" }],
  font: [{ origin: "https://fonts.gstatic.com", why: "Google Fonts files" }],
};

const origins = (key: keyof typeof CSP_SOURCES): string =>
  CSP_SOURCES[key].map((s) => s.origin).join(" ");

/**
 * The policy, one directive per entry. `img-src` allows any https origin
 * because team logos come from whichever data provider served the game.
 * `style-src` needs `'unsafe-inline'` for React inline styles and the
 * Tailwind runtime. `frame-ancestors` is omitted: report-only ignores it
 * and `X-Frame-Options: DENY` already covers embedding.
 */
export function cspDirectives(): string[] {
  return [
    "default-src 'self'",
    `script-src 'self' ${origins("script")}`,
    `style-src 'self' 'unsafe-inline' ${origins("style")}`,
    `font-src 'self' data: ${origins("font")}`,
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${origins("connect")}`,
    `frame-src 'self' ${origins("frame")}`,
    `child-src 'self' ${origins("frame")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ];
}

/** The `Content-Security-Policy-Report-Only` header value. */
export function buildCsp(): string {
  return cspDirectives().join("; ");
}
