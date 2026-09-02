/**
 * Shared hook-badge palette (the "SHELL_HOOK_TINT" palette from the
 * prototype). Extracted so both `AssetsCard` and the Earnings tab render
 * hook badges from a single source without a circular import.
 */

export type HookName = "Stable Protection" | "Dynamic Fee" | "Volatile";

// Colors match the pools-list HookBadge palette so a hook reads the same
// everywhere: Stable Protection green, Dynamic Fee yellow. "Volatile" =
// a no-hook cbBTC pool (neutral chip).
export const HOOK_TINT: Record<HookName, { bg: string; fg: string; bd: string }> = {
  "Dynamic Fee": { bg: "rgba(230,199,74,0.12)", fg: "#e6c74a", bd: "rgba(230,199,74,0.35)" },
  "Stable Protection": { bg: "rgba(61,220,151,0.12)", fg: "#3ddc97", bd: "rgba(61,220,151,0.35)" },
  Volatile: { bg: "var(--chip)", fg: "var(--text-mute)", bd: "var(--border-soft)" },
};
