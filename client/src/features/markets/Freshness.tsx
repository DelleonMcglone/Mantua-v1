import { useEffect, useState } from "react";
import { freshness, type FreshnessInput } from "./freshness.ts";

/**
 * T-023 — the "Updated 12s ago" stamp for any surface that depends on live
 * sports or market data. Re-renders once a minute so the age stays honest
 * without the parent polling; a delayed read says "Data as of …" and a
 * stale one dims to amber.
 */
export function Freshness({
  source,
  className = "",
}: {
  source: FreshnessInput;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const f = freshness(source, now);
  const tone = f.delayed || f.stale ? "text-amber" : "text-text-mute";
  return (
    <span
      role="status"
      data-testid="freshness"
      className={`inline-flex items-center gap-1 text-[10.5px] ${tone} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${f.delayed || f.stale ? "bg-amber" : "bg-green"}`}
      />
      {f.label}
    </span>
  );
}
