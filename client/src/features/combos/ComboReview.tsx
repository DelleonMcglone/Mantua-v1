import { FeeExplainer } from "@/features/markets/FeeExplainer.tsx";
import { comboFeeLines, payoutLine, premiumLine, type ComboQuoteResult } from "./combo-core.ts";

/**
 * Task 072 / CB-003, CB-004 — the review block: the combined position and
 * payout, the fair-vs-pool line, then Position / Fee / Fee rate / Total
 * from the hook's own quote with the separate-tickets comparison — the
 * single-trade fee standard, one tap from its explainer. Rule violations
 * and policy refusals render here in the server's words.
 */
export function ComboReview({
  quote,
  quoting,
}: {
  quote: ComboQuoteResult | null;
  quoting: boolean;
}) {
  if (!quote) {
    return (
      <div className="mt-3 min-h-[38px] text-[12px] text-text-dim" aria-busy={quoting}>
        {quoting && <span role="status">Pricing…</span>}
      </div>
    );
  }
  if (!quote.ok) {
    return (
      <ul
        data-testid="combo-violations"
        className="mt-3 flex flex-col gap-1 text-[12px] text-yellow"
      >
        {quote.violations.map((v, i) => (
          <li key={`${v.code}-${String(i)}`}>{v.detail}</li>
        ))}
      </ul>
    );
  }
  const lines = comboFeeLines(quote);
  const shares = Number(quote.sharesRaw) / 1e6;
  return (
    <div
      className={`mt-3 text-[12px] leading-relaxed text-text-dim transition-opacity ${quoting ? "opacity-60" : ""}`}
      aria-busy={quoting}
    >
      <p data-testid="combo-you-get">
        You get <span className="font-mono text-text">{shares.toFixed(2)}</span> combo shares ·{" "}
        <span className="text-text">{payoutLine(quote)}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-text-mute">{premiumLine(quote)}</p>
      {lines.length > 0 ? (
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
            {quote.fee.playoffs ? "Playoff leg · dynamic fee" : "Regular season · no trading fee"} ·
            one fee for the whole combo
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-yellow">Fee quote out of range — try again in a moment.</p>
      )}
      {!quote.gate.ok && (
        <ul data-testid="combo-gate" className="mt-2 flex flex-col gap-1 text-yellow">
          {quote.gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10.5px] text-text-mute">
        Legs are priced as independent games. Limits: up to {String(quote.limits.maxLegs)} legs, $
        {quote.limits.maxStakeUsd.toFixed(0)} per ticket, ${quote.limits.openExposureUsd.toFixed(2)}{" "}
        of ${quote.limits.maxOpenExposureUsd.toFixed(0)} open exposure used.
      </p>
      <div className="mt-2">
        <FeeExplainer />
      </div>
    </div>
  );
}
