import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Shimmer loading bar — promoted from the agent surface's `Skel`
 * (features/agent/agent-primitives.tsx) and rewritten as Tailwind
 * classes over tokens. Defaults to a full-width 10px bar; size with
 * `className` (e.g. `h-4 w-24`).
 *
 * The shimmer gradient + background-size stay inline `style` — a
 * moving multi-stop gradient has no token utility equivalent (the
 * `shimmer` keyframes live in index.css).
 */
export function Skeleton({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("h-2.5 w-full rounded-[6px] animate-[shimmer_1.6s_infinite_linear]", className)}
      style={{
        background:
          "linear-gradient(90deg, var(--bg-elev) 0%, var(--chip) 50%, var(--bg-elev) 100%)",
        backgroundSize: "200% 100%",
        ...style,
      }}
      aria-hidden
      {...props}
    />
  );
}
