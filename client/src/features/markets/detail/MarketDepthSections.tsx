import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SlateEvent } from "../use-slate.ts";
import { DepthPanel } from "./DepthPanel.tsx";
import type { MarketDepthRead } from "./depth-types.ts";
import {
  ALL_CLOSED,
  anyOpen,
  openAll,
  sectionsFor,
  toggle,
  type SectionId,
} from "./disclosure-core.ts";
import { FeesAndExecution } from "./FeesAndExecution.tsx";
import { PastMarkets } from "./PastMarkets.tsx";
import { ResearchSection } from "./ResearchSection.tsx";

/**
 * Phase 12 (D-004) — layered disclosure. Every deeper section starts
 * closed under one heading; a casual user never sees a depth ladder they
 * did not open, and "Open all" gives a pro the whole layer in one tap. The
 * section model and its rules live in `disclosure-core.ts`.
 */
export function MarketDepthSections({
  event,
  league,
  depth,
  onBrowseHistory,
}: {
  event: SlateEvent;
  league: string;
  depth: MarketDepthRead | null;
  onBrowseHistory: () => void;
}) {
  const sections = sectionsFor({
    hasMarkets: depth?.hasMarkets ?? false,
    hasResearch: depth !== null,
  });
  const [open, setOpen] = useState(ALL_CLOSED);
  const body = (id: SectionId) => {
    switch (id) {
      case "depth":
        return <DepthPanel metrics={depth?.metrics ?? null} depth={depth?.depth ?? null} />;
      case "fees":
        return <FeesAndExecution />;
      case "research":
        return <ResearchSection event={event} />;
      case "history":
        return <PastMarkets league={league} onBrowseHistory={onBrowseHistory} />;
    }
  };
  return (
    <section data-testid="market-sections" aria-label="Go deeper" className="mt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-text">Go deeper</h3>
        <button
          type="button"
          data-testid="open-all"
          onClick={() => {
            setOpen(anyOpen(open) ? ALL_CLOSED : openAll(sections));
          }}
          className="text-[12px] text-text-dim hover:text-text cursor-pointer"
        >
          {anyOpen(open) ? "Close all" : "Open all"}
        </button>
      </div>
      <div className="mt-2 flex flex-col divide-y divide-border-soft rounded-md border border-border-soft bg-panel-solid">
        {sections.map((s) => (
          <div
            key={s.id}
            data-testid={`section-${s.id}`}
            data-open={open[s.id]}
            className="px-4 py-3"
          >
            <button
              type="button"
              aria-expanded={open[s.id]}
              aria-controls={`section-body-${s.id}`}
              data-testid={`toggle-${s.id}`}
              onClick={() => {
                setOpen((o) => toggle(o, s.id));
              }}
              className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
            >
              <span>
                <span className="block text-[13px] font-medium text-text">{s.title}</span>
                <span className="block text-[11.5px] text-text-dim">{s.blurb}</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-text-dim transition-transform ${open[s.id] ? "rotate-180" : ""}`}
              />
            </button>
            {open[s.id] && (
              <div id={`section-body-${s.id}`} className="mt-3">
                {s.available ? body(s.id) : <p className="text-[12.5px] text-text-dim">{s.note}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
