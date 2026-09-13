import { useState } from "react";
import { PredictionNote } from "../PredictionNote.tsx";
import { ProbabilityTag } from "../ProbabilityTag.tsx";
import type { SlateEvent } from "../use-slate.ts";
import { researchView } from "./research-core.ts";
import { useMarketAnalysis } from "./use-market-analysis.ts";

const DIRECTION_TONE = { up: "text-green", down: "text-yellow", flat: "text-text-mute" } as const;

/**
 * Phase 12 (D-003) — the analyst's research for one side of the market,
 * powered by the same `sports_intelligence` the agent uses. The
 * probability is an agent estimate and is tagged as one (T-021); the
 * standing prediction note closes the section (T-022).
 */
export function ResearchSection({ event }: { event: SlateEvent }) {
  const [side, setSide] = useState<0 | 1>(0);
  const { read, loading, failed } = useMarketAnalysis(event.providerEventId, side);
  const v = researchView(read);
  return (
    <div data-testid="market-research" className="flex flex-col gap-3">
      <div role="group" aria-label="Side to analyse" className="flex gap-2 text-[12px]">
        {([0, 1] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            data-testid={`research-side-${String(s)}`}
            onClick={() => {
              setSide(s);
            }}
            className={`rounded-full border px-3 py-1 cursor-pointer ${side === s ? "border-accent bg-accent/15 text-text" : "border-border-soft text-text-dim"}`}
          >
            {(s === 0 ? event.home : event.away).name}
          </button>
        ))}
      </div>
      {loading && (
        <p role="status" className="text-[12.5px] text-text-dim">
          Reading the matchup…
        </p>
      )}
      {!loading && (failed || !v) && (
        <p className="text-[12.5px] text-text-dim">Research is not available for this game yet.</p>
      )}
      {v && (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12.5px] text-text-dim">{v.team}</span>
            <span
              data-testid="research-probability"
              className="font-mono text-[22px] font-semibold text-text"
            >
              {v.probability}
            </span>
            <ProbabilityTag model />
            <span className="rounded-[3px] bg-chip px-1 py-px font-mono text-[9px] uppercase tracking-wider text-text-mute">
              {v.confidence} confidence
            </span>
          </div>
          {v.versusMarket && <p className="text-[12px] text-text-dim">{v.versusMarket}</p>}
          <p data-testid="research-action" className="text-[12.5px] text-text">
            {v.action} <span className="text-text-dim">{v.rationale}</span>
          </p>
          <ul data-testid="research-evidence" className="flex flex-col gap-1 text-[11.5px]">
            {v.evidence.map((e) => (
              <li key={e.factor} className="flex items-baseline gap-2">
                <span className={`w-14 shrink-0 font-mono ${DIRECTION_TONE[e.direction]}`}>
                  {e.effect}
                </span>
                <span className="text-text">{e.factor}</span>
                <span className="text-text-dim">{e.detail}</span>
              </li>
            ))}
          </ul>
          {v.risks.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-[11.5px] text-yellow">
              {v.risks.map((r) => (
                <li key={r}>Risk: {r}</li>
              ))}
            </ul>
          )}
          {v.disclaimers.map((d) => (
            <p key={d} className="text-[10.5px] text-text-mute">
              {d}
            </p>
          ))}
          <PredictionNote />
        </>
      )}
    </div>
  );
}
