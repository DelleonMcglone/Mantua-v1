import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { TokenIcon } from "@/features/portfolio/TokenIcon.tsx";
import type { TokenSymbol } from "@/lib/tokens.ts";

/**
 * Shared atoms for the agent flows — originally verbatim inline-style
 * ports from `Mantua Agent Flows.html`, rewritten in B-015 as Tailwind
 * classes over design tokens so both themes render correctly.
 *
 * The old `BTN_*` / `X_CLOSE` / `PANEL_*` CSSProperties constants are
 * gone: buttons route through `@/components/ui/button.tsx`, banners
 * through `@/components/ui/banner.tsx`, skeletons through
 * `@/components/ui/skeleton.tsx`.
 */

// ── Token chip (.tok) ─────────────────────────────────────────────

/**
 * Token mark for the agent flows. Delegates to the app's canonical
 * `TokenIcon` (the same USDC / EURC / cbBTC `AssetIcon` marks used in the
 * portfolio + swap UIs) so the agent panel matches the rest of the app,
 * with a neutral coin-initial fallback for any unknown symbol.
 */
export function TokenChip({ sym, size = 22 }: { sym: string; size?: number }) {
  return <TokenIcon symbol={sym as TokenSymbol} size={size} />;
}

// ── Copy button ───────────────────────────────────────────────────

/**
 * Tiny inline copy affordance. Writes `value` to the clipboard and flips to
 * a brief "Copied" confirmation. Used for the agent wallet address.
 */
export function CopyButton({
  value,
  label = "Copy",
  size = 11,
}: {
  value: string;
  label?: string;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 1200);
      }}
      className={cn(
        "inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer",
        copied ? "text-green" : "text-text-dim",
      )}
      // Caller-tunable size — a dynamic value, so it stays inline.
      style={{ fontSize: size }}
      aria-label={`${label} ${value}`}
    >
      {copied ? (
        <>
          <Check aria-hidden style={{ width: size, height: size }} /> Copied
        </>
      ) : (
        <>
          <Copy aria-hidden style={{ width: size, height: size }} /> Copy
        </>
      )}
    </button>
  );
}

// ── Detail rows (label/value pairs) ───────────────────────────────

export function DetailRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <div className="text-[13px]">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex justify-between py-[7px] border-b border-dashed border-border-soft last:border-b-0"
        >
          <span className="text-text-dim">{row.label}</span>
          <span className="mono">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Tx-row — promoted to components/ui/tx-row.tsx (B-015) ────────

export { TxRow } from "@/components/ui/tx-row.tsx";

// ── Bigval (centered headline + sub) ──────────────────────────────

export function BigVal({
  label,
  value,
  sub,
  padding = "20px 12px",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  padding?: string;
}) {
  return (
    <div
      className="text-center rounded-md border border-border-soft bg-bg-elev"
      // Caller-tunable padding — a dynamic value, so it stays inline.
      style={{ padding }}
    >
      <div className="text-[11px] text-text-mute tracking-[0.08em]">{label}</div>
      <div className="mono mt-1.5 text-[32px] font-semibold -tracking-[0.02em]">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-text-dim">{sub}</div>}
    </div>
  );
}

// ── Spinner (.spinner / .spinner.lg / .spinner.agent) ─────────────

export function Spinner({ size = "sm", agent = false }: { size?: "sm" | "lg"; agent?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-full border-border animate-[spin_.8s_linear_infinite]",
        size === "lg" ? "h-[38px] w-[38px] border-[3px]" : "h-[18px] w-[18px] border-2",
        agent ? "border-t-agent" : "border-t-accent",
      )}
      aria-hidden
    />
  );
}
