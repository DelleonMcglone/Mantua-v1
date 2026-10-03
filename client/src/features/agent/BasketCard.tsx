import { Check } from "lucide-react";
import { Banner } from "@/components/ui/banner.tsx";
import { usd } from "@/lib/format.ts";

/** A leg of the preview (mantua_simulate_basket). */
export interface BasketPreviewLeg {
  label: string | null;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  amountUsdc: number;
  executable: boolean;
  blockers: string[];
  contracts: number | null;
  effectivePriceBps: number | null;
}

/** A leg after execution (mantua_execute_basket). */
export interface BasketFillLeg {
  label: string | null;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  amountUsdc: number;
  status: "filled" | "failed";
  received: string | null;
  effectivePriceBps: number | null;
  error: string | null;
}

const cents = (bps: number | null) => (bps === null ? "—" : `@ ${(bps / 100).toFixed(0)}¢`);
const legName = (l: { label: string | null; providerEventId: string; outcomeIndex: 0 | 1 }) =>
  l.label ?? `Game ${l.providerEventId} · ${l.outcomeIndex === 0 ? "home" : "away"} YES`;

/**
 * "Order preview · $X basket": one row per leg with contracts, cost and
 * price. `approve` renders the Approve row (the preview is executable and
 * not yet acted on).
 */
export function BasketPreviewCard({
  legs,
  totalUsdc,
  budgetUsdc,
  approve,
}: {
  legs: BasketPreviewLeg[];
  totalUsdc: number;
  budgetUsdc: number | null;
  approve: React.ReactNode;
}) {
  const blocked = legs.filter((l) => !l.executable);
  return (
    <div data-testid="basket-preview" className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold">
        Order preview · {usd(budgetUsdc ?? totalUsdc)} basket
      </div>
      <div className="flex flex-col gap-1.5">
        {legs.map((l) => (
          <div
            key={`${l.providerEventId}-${String(l.outcomeIndex)}`}
            className="flex items-baseline gap-3 text-[13px]"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{legName(l)}</span>
            <span className="font-mono text-text-dim">
              {l.contracts === null ? "—" : `${l.contracts.toFixed(2)} ct`}
            </span>
            <span className="font-mono">{usd(l.amountUsdc)}</span>
            <span className="font-mono text-[12px] text-text-dim">
              {cents(l.effectivePriceBps)}
            </span>
          </div>
        ))}
      </div>
      {blocked.length > 0 && (
        <Banner tone="error" icon="⊘" title="Not executable">
          {blocked.map((l) => `${legName(l)}: ${l.blockers.join(" ")}`).join(" · ")}
        </Banner>
      )}
      {blocked.length === 0 && approve}
    </div>
  );
}

/** The same card after execution: every row marked, a banner, the totals line. */
export function BasketFillsCard({
  legs,
  placedUsdc,
  requestedUsdc,
  leftoverUsdc,
  budgetUsdc,
}: {
  legs: BasketFillLeg[];
  placedUsdc: number;
  requestedUsdc: number;
  leftoverUsdc: number;
  budgetUsdc: number | null;
}) {
  const allFilled = legs.every((l) => l.status === "filled");
  return (
    <div data-testid="basket-fills" className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold">
        Order preview · {usd(budgetUsdc ?? requestedUsdc)} basket
      </div>
      <div className="flex flex-col gap-1.5">
        {legs.map((l) => (
          <div
            key={`${l.providerEventId}-${String(l.outcomeIndex)}`}
            className="flex items-baseline gap-3 text-[13px]"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{legName(l)}</span>
            <span className="font-mono text-text-dim">{l.received ?? "—"}</span>
            <span className="font-mono">{usd(l.amountUsdc)}</span>
            <span className="font-mono text-[12px] text-text-dim">
              {cents(l.effectivePriceBps)}
            </span>
            {l.status === "filled" ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-green">
                <Check className="h-3 w-3" aria-hidden /> Filled
              </span>
            ) : (
              <span className="text-[12px] font-medium text-red" title={l.error ?? undefined}>
                Failed
              </span>
            )}
          </div>
        ))}
      </div>
      <div
        className={`rounded-md border px-3 py-2 text-center text-[12.5px] font-medium ${
          allFilled
            ? "border-green/35 bg-green/10 text-green"
            : "border-yellow/40 bg-yellow/10 text-yellow"
        }`}
      >
        {allFilled
          ? "Orders filled"
          : `${String(legs.filter((l) => l.status === "filled").length)} of ${String(legs.length)} legs filled`}
      </div>
      <div className="text-center text-[12px] text-text-dim">
        <span className="font-mono text-text">{usd(placedUsdc)}</span> of{" "}
        <span className="font-mono text-text">{usd(budgetUsdc ?? requestedUsdc)}</span> placed;{" "}
        <span className="font-mono text-text">{usd(leftoverUsdc)}</span> stays in your agent wallet.
      </div>
      {legs
        .filter((l) => l.status === "failed")
        .map((l) => (
          <div key={`err-${l.providerEventId}`} className="text-[12px] text-red">
            {legName(l)}: {l.error ?? "failed"}
          </div>
        ))}
    </div>
  );
}
