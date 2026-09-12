/**
 * Phase 7 / R-006 — the pure half of the RPC configuration: which hosts
 * are public, how the upstream list resolves from the environment, the
 * boot-time check, and the per-host health registry. A leaf module (no
 * `env` import) so `env.ts` can run the check at boot and `rpc-client.ts`
 * can build the client from the same rules. Rationale in rpc-client.ts.
 */

/** Hosts that are public and rate-limited — never a production primary. */
export const PUBLIC_BASE_RPC_HOSTS: readonly string[] = [
  "mainnet.base.org",
  "sepolia.base.org",
  "base-rpc.publicnode.com",
  "base.llamarpc.com",
  "base.drpc.org",
  "1rpc.io",
  "base.blockpi.network",
  "base-mainnet.public.blastapi.io",
  "base.meowrpc.com",
  "base.gateway.tenderly.co",
];

/** The two public hosts appended as the dev-time backstop. */
export const PUBLIC_BASE_RPC_URLS: readonly string[] = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
];

export function isPublicRpcUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PUBLIC_BASE_RPC_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export interface RpcEnv {
  NODE_ENV: string;
  BASE_RPC_URL: string;
  BASE_RPC_FALLBACK_URLS?: string | undefined;
  BASE_RPC_PUBLIC_FALLBACK?: "0" | "1" | undefined;
}

/** Comma-separated URLs → trimmed, de-duplicated list. */
export function parseUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const u = part.trim();
    if (u.length > 0 && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * The ordered upstream list for an environment, pure: primary, then the
 * dedicated fallbacks, then — only when allowed — the public backstop.
 * Duplicates collapse; the primary always comes first.
 */
export function resolveRpcUrls(e: RpcEnv): string[] {
  const allowPublic =
    e.BASE_RPC_PUBLIC_FALLBACK === "1" ||
    (e.BASE_RPC_PUBLIC_FALLBACK === undefined && e.NODE_ENV !== "production");
  const urls = [e.BASE_RPC_URL, ...parseUrlList(e.BASE_RPC_FALLBACK_URLS)];
  if (allowPublic) urls.push(...PUBLIC_BASE_RPC_URLS);
  const out: string[] = [];
  for (const u of urls) if (!out.includes(u)) out.push(u);
  return out;
}

/**
 * R-006 boot check (wired into `env.ts`'s issues machinery: warns outside
 * production, fails the production boot). A public primary is the exact
 * configuration the lesson was learned on; a public backstop in production
 * is the same mistake one hop later.
 */
export function rpcProviderIssues(e: RpcEnv): string[] {
  const issues: string[] = [];
  if (isPublicRpcUrl(e.BASE_RPC_URL)) {
    issues.push(
      `BASE_RPC_URL is the public, rate-limited host ${new URL(e.BASE_RPC_URL).hostname} — production must use a dedicated RPC endpoint (Alchemy / QuickNode / Infura / dRPC paid tier). Set BASE_RPC_URL to the provider URL; see docs/tasks/052-rpc-cache-pooling.md (R-006).`,
    );
  }
  for (const u of parseUrlList(e.BASE_RPC_FALLBACK_URLS)) {
    if (isPublicRpcUrl(u)) {
      issues.push(
        `BASE_RPC_FALLBACK_URLS contains the public host ${new URL(u).hostname} — list dedicated endpoints only; the public backstop is governed by BASE_RPC_PUBLIC_FALLBACK.`,
      );
    }
  }
  if (e.NODE_ENV === "production" && e.BASE_RPC_PUBLIC_FALLBACK === "1") {
    issues.push(
      "BASE_RPC_PUBLIC_FALLBACK=1 in production appends the public rate-limited hosts as a backstop — under the load that degrades a dedicated endpoint they add 10 s timeouts, not availability. Unset it (or set 0) and list a second dedicated endpoint in BASE_RPC_FALLBACK_URLS instead.",
    );
  }
  return issues;
}

// ─── Per-host health (R-005's RPC rung) ─────────────────────────────────────

export interface RpcHostHealth {
  /** Hostname only — never the URL (provider keys ride in URL paths). */
  host: string;
  primary: boolean;
  /** Public, rate-limited host (dev backstop). */
  public: boolean;
  requests: number;
  consecutiveFailures: number;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
}

export interface RpcHealth {
  /** True while at least one host is answering. */
  healthy: boolean;
  /** True when the primary is failing and traffic is on a fallback. */
  onFallback: boolean;
  detail: string;
  hosts: RpcHostHealth[];
}

/** Consecutive failures before a host counts as down. */
export const RPC_HOST_FAILURE_THRESHOLD = 3;

export class RpcHealthRegistry {
  private readonly hosts: RpcHostHealth[];

  constructor(urls: readonly string[]) {
    this.hosts = urls.map((url, i) => ({
      host: hostOf(url),
      primary: i === 0,
      public: isPublicRpcUrl(url),
      requests: 0,
      consecutiveFailures: 0,
      lastOkAt: null,
      lastErrorAt: null,
      lastError: null,
    }));
  }

  record(index: number, ok: boolean, error: unknown, now: number = Date.now()): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.hosts.length) return;
    const h = this.hosts[index];
    h.requests += 1;
    if (ok) {
      h.consecutiveFailures = 0;
      h.lastOkAt = now;
      return;
    }
    h.consecutiveFailures += 1;
    h.lastErrorAt = now;
    h.lastError =
      error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
  }

  snapshot(): RpcHealth {
    const hosts = this.hosts.map((h) => ({ ...h }));
    const down = (h: RpcHostHealth): boolean => h.consecutiveFailures >= RPC_HOST_FAILURE_THRESHOLD;
    const primary = hosts.length > 0 ? hosts[0] : null;
    const anyUp = hosts.some((h) => !down(h));
    const onFallback = primary !== null && down(primary) && anyUp;
    const detail = !anyUp
      ? `all ${String(hosts.length)} RPC hosts failing`
      : onFallback
        ? `primary ${primary.host} failing — on fallback`
        : "ok";
    return { healthy: anyUp, onFallback, detail, hosts };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}
