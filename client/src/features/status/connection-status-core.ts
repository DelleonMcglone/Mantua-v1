/**
 * Phase 7 / R-005 — what the global banner shows, derived purely from the
 * platform status the server published, how long ago we last heard from
 * it, and the browser's own connectivity. The rule that matters: a
 * failure is never silent. If the server says it is degraded we say so;
 * if we cannot reach the server at all we say THAT, with the age of the
 * data on screen.
 */

/** Mirrors `server/src/lib/platform-status.ts` PlatformStatus (the fields
 *  the client reads). */
export interface PlatformStatusWire {
  generatedAt: number;
  mode: "live" | "degraded" | "paused";
  reads: "live" | "delayed";
  trading: "open" | "buys_halted" | "paused";
  killSwitch: boolean;
  message: string | null;
}

export interface ConnectionInput {
  status: PlatformStatusWire | null;
  /** When we last successfully received a status (stream frame or poll). */
  lastHeardAt: number | null;
  /** `navigator.onLine` (true when unknown). */
  online: boolean;
  now: number;
}

/** After this long without a successful status read the banner reports
 *  the platform as unreachable (two missed polls plus slack). */
export const UNREACHABLE_AFTER_MS = 50_000;

export type BannerTone = "warn" | "error" | "info";

export interface BannerModel {
  tone: BannerTone;
  text: string;
  /** Stable key so React does not re-announce an unchanged banner. */
  key: string;
}

function ageLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${String(s)}s`;
  return `${String(Math.round(s / 60))} min`;
}

export function deriveBanner(input: ConnectionInput): BannerModel | null {
  if (!input.online) {
    return {
      tone: "error",
      key: "offline",
      text: "You're offline — showing the last data received. Trading needs a connection.",
    };
  }
  const heardAge = input.lastHeardAt === null ? null : input.now - input.lastHeardAt;
  const unreachable = heardAge === null ? false : heardAge > UNREACHABLE_AFTER_MS;
  if (unreachable) {
    return {
      tone: "error",
      key: "unreachable",
      text:
        `Can't reach Mantua — showing data from ${ageLabel(heardAge ?? 0)} ago. ` +
        "Trades can't be placed until the connection recovers; we're retrying.",
    };
  }
  const s = input.status;
  if (!s || s.mode === "live") return null;
  if (s.mode === "paused") {
    return { tone: "error", key: "paused", text: s.message ?? "Trading is paused." };
  }
  return {
    tone: "warn",
    key: `degraded:${s.trading}:${s.reads}`,
    text: s.message ?? "Live data is delayed.",
  };
}

/** Is the trade ticket allowed to submit a BUY right now, per the banner's
 *  view? Sells are never blocked by status (exits ride through). */
export function buysBlockedByStatus(status: PlatformStatusWire | null): boolean {
  return status?.trading === "paused";
}
