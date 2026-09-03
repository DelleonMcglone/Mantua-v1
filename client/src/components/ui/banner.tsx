import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

export type BannerTone = "warn" | "error" | "success" | "info";

/**
 * Inline notice banner — promoted from the agent surface's `Banner`
 * (features/agent/agent-primitives.tsx) and rewritten as Tailwind
 * classes over tokens, so both themes render the correct hues (the old
 * hardcoded dark-theme rgba fills washed out in light mode).
 *
 * A11y: error/warn render `role="alert"` (assertive), success/info
 * render `role="status"` (polite) so screen readers hear tx results
 * and failures without any call-site wiring.
 */
const TONES: Record<BannerTone, { box: string; icon: string }> = {
  warn: { box: "bg-amber/10 border-amber/35", icon: "text-amber" },
  error: { box: "bg-red/10 border-red/35", icon: "text-red" },
  success: { box: "bg-green/10 border-green/35", icon: "text-green" },
  info: { box: "bg-bg-elev border-border-soft", icon: "text-text-dim" },
};

export function Banner({
  tone,
  icon,
  title,
  children,
  className,
}: {
  tone: BannerTone;
  icon?: ReactNode;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-sm border px-3 py-[11px] text-[12px] leading-[1.55] text-text",
        t.box,
        className,
      )}
    >
      {icon && (
        <span className={cn("mt-px flex-shrink-0 text-[13px]", t.icon)} aria-hidden>
          {icon}
        </span>
      )}
      <div>
        {title && <div className="mb-0.5 font-semibold text-text">{title}</div>}
        {children && <div className="text-[12px] text-text-dim">{children}</div>}
      </div>
    </div>
  );
}
