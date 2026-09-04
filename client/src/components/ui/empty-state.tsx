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
 *
 * Announcement semantics live HERE, not at the call site (B-016): an
 * `error` tone mounts as `role="alert"` so a failure interrupts, and
 * every other tone as `role="status"` so loading/empty copy announces
 * politely. Both are set on a freshly-mounted element, so each message
 * announces exactly once. Pass an explicit `role` to override.
 */
export function EmptyState({ tone = "muted", className, ...props }: EmptyStateProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "px-4 py-8 text-center text-[12px]",
        tone === "error" ? "text-red" : "text-text-dim",
        className,
      )}
      {...props}
    />
  );
}
