import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api.ts";
import { ClaimWinnings } from "../ClaimWinnings.tsx";
import type { SportId } from "../sports.ts";
import type { Slate, SlateEvent } from "../use-slate.ts";
import type { DetailResponse } from "./detail-types.ts";
import { LiveGamePanel } from "./LiveGamePanel.tsx";
import { MarketDepthSections } from "./MarketDepthSections.tsx";
import { MarketSummary } from "./MarketSummary.tsx";
import { MarketTabs } from "./MarketTabs.tsx";
import { PriceChart } from "./PriceChart.tsx";
import { useMarketDepth } from "./use-market-depth.ts";

interface Props {
  event: SlateEvent;
  slate: Slate;
  league: SportId;
  onBack: () => void;
  onAgent: (message: string) => void;
  /** Phase 11 — the full historical browser, from the Past markets section. */
  onBrowseHistory: () => void;
}

/**
 * The market page. Simple layer first (T-010): summary, the live game when
 * there is one, claim, chart. Then Phase 11's deeper layer — depth, fees
 * and execution, research, past markets — each section closed until
 * opened (D-004), and the "More" tabs below. Nothing here leaves the page.
 */
export function MarketDetail({ event, slate, league, onBack, onAgent, onBrowseHistory }: Props) {
  const { user } = usePrivy();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const depth = useMarketDepth(event.providerEventId, event.status === "in_progress");

  useEffect(() => {
    let cancelled = false;
    api
      .get<DetailResponse>(`/api/markets/detail?providerEventId=${event.providerEventId}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [event.providerEventId]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to games"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-[18px] font-semibold">
          {event.away.name} at {event.home.name}
        </h2>
      </div>

      <MarketSummary event={event} slate={slate} detail={detail} />
      <div className="mt-4">
        <LiveGamePanel league={league} event={event} game={depth.read?.game ?? null} />
      </div>
      <div className="mt-4">
        <ClaimWinnings address={user?.wallet?.address} providerEventId={event.providerEventId} />
      </div>
      <div className="mt-4">
        <PriceChart
          event={event}
          detail={detail}
          failed={failed}
          annotations={depth.read?.annotations ?? []}
        />
      </div>

      <MarketDepthSections
        event={event}
        league={league}
        depth={depth.read}
        onBrowseHistory={onBrowseHistory}
      />

      <MarketTabs event={event} detail={detail} onAgent={onAgent} />
    </div>
  );
}
