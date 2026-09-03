import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils.ts";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** `muted` (default) for empty/loading copy, `error` for failure copy. */
  tone?: "muted" | "error";
}

/**
 * Centered in-card empty/loading/error state — replaces the copy-pasted
 * `px-4 py-8 text-center text-[12px] text-text-dim` divs across the
 * portfolio tabs. Adjust density with `className` (e.g. `py-6`).
 */
export function EmptyState({ tone = "muted", className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "px-4 py-8 text-center text-[12px]",
        tone === "error" ? "text-red" : "text-text-dim",
        className,
      )}
      {...props}
    />
  );
}
