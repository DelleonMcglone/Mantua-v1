import { SPORTS, type SportId } from "./sports.ts";

/**
 * Task 071 (MX-001) — one-tap sport switching on phones. The header hides
 * the league nav behind the hamburger below `md` (B-014), which made a
 * league change two taps; this row on the league and Discover pages makes
 * it one. Data-driven off `SPORTS.coverage` like the nav (DM-105): a sport
 * marked `soon` is listed, disabled and labelled, never tradable.
 */
export function SportChips({
  active,
  onSelect,
  className = "",
}: {
  active: SportId | null;
  onSelect: (sport: SportId) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Switch sport"
      className={`-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {SPORTS.map((s) => {
        const Icon = s.icon;
        const soon = s.coverage === "soon";
        return (
          <button
            key={s.id}
            type="button"
            data-sport-chip={s.id}
            disabled={soon}
            aria-current={active === s.id ? "page" : undefined}
            onClick={() => {
              onSelect(s.id);
            }}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors cursor-pointer disabled:cursor-default ${
              active === s.id
                ? "border-accent bg-accent/15 text-text"
                : "border-border-soft bg-chip text-text-dim hover:text-text disabled:text-text-mute"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {s.label}
            {soon && (
              <span className="text-[10px] uppercase tracking-wider text-text-mute">soon</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
