import { FeeExplainer } from "../FeeExplainer.tsx";
import type { FeeLine } from "../fee-lines.ts";
import type { FeeSummary } from "../market-trade-core.ts";
import type { TradeCalldata } from "../use-market-trade.ts";

/**
 * T-008 — the review block: what you get, then Position / Fee / Fee rate /
 * Total straight from the hook's quote, in every season. The fee
 * explainer (T-009) is one tap below it.
 */
export function TicketReview({
  quote,
  summary,
  lines,
  direction,
  teamName,
  quoting,
}: {
  quote: TradeCalldata["quote"] | null;
  summary: FeeSummary | null;
  lines: FeeLine[];
  direction: "buy" | "sell";
  teamName: string;
  quoting: boolean;
}) {
  const out = quote ? Number(quote.amountOut) / 1e6 : null;
  return (
    <div className="mt-3 min-h-[38px] text-[12px] leading-relaxed text-text-dim">
      {quoting && <span role="status">Pricing…</span>}
      {quote && out !== null && (
        <p data-testid="you-get">
          {direction === "buy" ? (
            <>
              You get <span className="font-mono text-text">{out.toFixed(2)}</span> contracts · pays{" "}
              <span className="font-mono text-text">${out.toFixed(2)}</span> if the {teamName} win
            </>
          ) : (
            <>
              You get <span className="font-mono text-text">${out.toFixed(2)}</span> now
            </>
          )}
        </p>
      )}
      {summary && (
        <dl
          data-testid="fee-lines"
          className="mt-2 grid grid-cols-2 gap-y-0.5 rounded-sm border border-border-soft px-3 py-2"
        >
          {lines.map((l) => (
            <div key={l.label} className="contents">
              <dt>{l.label}</dt>
              <dd className="text-right font-mono text-text">{l.value}</dd>
            </div>
          ))}
          <div className="col-span-2 mt-1 text-[10.5px] text-text-mute">
            {summary.playoffs ? "Playoff game · dynamic fee" : "Regular season · no trading fee"}
          </div>
        </dl>
      )}
      <div className="mt-2">
        <FeeExplainer />
      </div>
    </div>
  );
}
