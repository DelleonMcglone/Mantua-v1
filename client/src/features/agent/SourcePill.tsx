import { Check } from "lucide-react";
import { Spinner } from "./agent-primitives.tsx";
import { costLabel, pillFor } from "./source-pills.ts";

/**
 * One data read as an inline pill: provider · category, a spinner while it
 * runs, then a tick — and, only for a paid x402 call, the USDC charged.
 * Mantua's own reads show no cost: what was paid is the news, not what
 * was free (owner, 2026-10-18).
 */
export function SourcePill({
  tool,
  status,
  data,
}: {
  tool: string;
  status: "running" | "ok" | "error";
  data: unknown;
}) {
  const pill = pillFor(tool, data);
  if (!pill) return null;
  const cost = status === "ok" ? costLabel(tool, data) : null;
  return (
    <span
      data-testid="source-pill"
      className="inline-flex items-center gap-1.5 rounded-md border border-border-soft bg-bg-elev px-2.5 py-1 text-[12px]"
    >
      {status === "running" ? (
        <Spinner />
      ) : status === "error" ? (
        <span className="text-red" aria-label="failed">
          ⊘
        </span>
      ) : (
        <Check className="h-3 w-3 text-green" aria-hidden />
      )}
      <span className="font-medium text-text">{pill.provider}</span>
      <span className="text-text-dim">{pill.category}</span>
      {cost && <span className="font-mono text-[11px] text-text-dim">{cost}</span>}
    </span>
  );
}
