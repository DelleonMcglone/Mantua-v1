/**
 * Shared hook-badge palette (the "SHELL_HOOK_TINT" palette from the
 * prototype), deduped with the pools-list `HOOK_BADGE_TINT` copy and
 * rewritten as Tailwind token classes so both themes render the correct
 * hues (the old hardcoded dark-theme rgba/hex values washed out in
 * light mode). A hook reads the same everywhere: Stable Protection
 * green, Dynamic Fee amber. "Volatile" = a no-hook cbBTC pool
 * (neutral chip).
 */

export type HookName = "Stable Protection" | "Dynamic Fee" | "Volatile";

export const HOOK_TINT: Record<HookName, string> = {
  "Stable Protection": "bg-green/15 text-green border border-green/35",
  "Dynamic Fee": "bg-amber/15 text-amber border border-amber/35",
  Volatile: "bg-chip text-text-mute border border-border-soft",
};
