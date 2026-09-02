import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Card surface — matches prototype `shellStyles.card` (panel-solid bg,
 * border-soft, 16px radius, density-scaled padding). Used for Portfolio,
 * Assets, and the right-column route panels.
 */
export function Card({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-panel-solid border border-border-soft rounded-md",
        "transition-colors",
        className,
      )}
      style={{
        padding: "calc(18px * var(--density))",
        ...style,
      }}
      {...props}
    />
  );
}
