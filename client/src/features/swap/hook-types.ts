/**
 * Phase 5 P5-005/P5-009 — client-side hook + peg-zone types.
 *
 * Mirrors `server/src/lib/v4-contracts.ts` HookName values. The server
 * is canonical (drives `assertHookPairAllowed` + the on-chain
 * deployments listed in `docs/security/hook-deployments.md`); this
 * file exists so the swap UI can talk about hooks without a server
 * round-trip every render.
 */

export const HOOK_OPTIONS = ["none", "stable-protection", "dynamic-fee"] as const;

export type HookOption = (typeof HOOK_OPTIONS)[number];

export interface HookMeta {
  value: HookOption;
  label: string;
  description: string;
}

export const HOOK_META: Record<HookOption, HookMeta> = {
  none: { value: "none", label: "No Hook", description: "Standard execution" },
  "stable-protection": {
    value: "stable-protection",
    label: "Stable Protection",
    description: "Minimizes depeg & slippage on USDC/EURC",
  },
  "dynamic-fee": {
    value: "dynamic-fee",
    label: "Dynamic Fee",
    description: "Fees adjust to volatility",
  },
};

/**
 * P5-003 — Stable Protection peg zones, ordered HEALTHY → CRITICAL.
 * Each zone maps to a fee tier on-chain (per the StableProtectionHook
 * source); this enum is purely the UI presentation layer.
 */
export const PEG_ZONES = ["HEALTHY", "MINOR", "MODERATE", "SEVERE", "CRITICAL"] as const;
export type PegZone = (typeof PEG_ZONES)[number];

export const PEG_ZONE_META: Record<
  PegZone,
  { label: string; emoji: string; color: string; description: string }
> = {
  HEALTHY: {
    label: "Healthy",
    emoji: "🟢",
    color: "var(--green)",
    description: "Peg holding within tight bounds.",
  },
  MINOR: {
    label: "Minor",
    emoji: "🟡",
    color: "#f5d24d",
    description: "Slight peg drift detected.",
  },
  MODERATE: {
    label: "Moderate",
    emoji: "🟠",
    color: "var(--amber)",
    description: "Notable deviation — proceed with care.",
  },
  SEVERE: {
    label: "Severe",
    emoji: "🔴",
    color: "var(--red)",
    description: "Large deviation — fee surcharge active.",
  },
  CRITICAL: {
    label: "Critical",
    emoji: "⛔",
    color: "var(--red)",
    description: "Swap blocked — pool circuit breaker engaged.",
  },
};

export function isWarningZone(zone: PegZone): boolean {
  return zone === "MODERATE" || zone === "SEVERE";
}

export function isBlockingZone(zone: PegZone): boolean {
  return zone === "CRITICAL";
}
