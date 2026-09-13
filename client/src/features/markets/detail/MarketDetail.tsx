import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { api } from "@/lib/api.ts";
import { ClaimWinnings } from "../ClaimWinnings.tsx";
import type { Slate, SlateEvent } from "../use-slate.ts";
import { ActivityTab } from "./ActivityTab.tsx";
import { AgentTab } from "./AgentTab.tsx";
import { CommentsTab } from "./CommentsTab.tsx";
import type { DetailResponse } from "./detail-types.ts";
import { HoldersTab } from "./HoldersTab.tsx";
import { MarketSummary } from "./MarketSummary.tsx";
import { PositionsTab } from "./PositionsTab.tsx";
import { PriceChart } from "./PriceChart.tsx";

type Tab = "positions" | "comments" | "activity" | "holders" | "agent";

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Your positions" },
  { id: "comments", label: "Comments" },
  { id: "activity", label: "Activity" },
  { id: "holders", label: "Top holders" },
  { id: "agent", label: "Agent" },
];

interface Props {
  event: SlateEvent;
  slate: Slate;
  onBack: () => void;
  onAgent: (message: string) => void;
}

/**
 * The market page. Simple layer first (T-010): summary, claim, chart.
 * Everything deeper — positions, comments, activity, holders, agent — sits
 * behind one "More" toggle. Renders in place of the games list; the ticket
 * stays alongside.
 */
export function MarketDetail({ event, slate, onBack, onAgent }: Props) {
  const { user } = usePrivy();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<Tab>("positions");

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
        <ClaimWinnings address={user?.wallet?.address} providerEventId={event.providerEventId} />
      </div>
      <div className="mt-4">
        <PriceChart event={event} detail={detail} failed={failed} />
      </div>

      <button
        type="button"
        aria-expanded={more}
        data-testid="market-more"
        onClick={() => {
          setMore((m) => !m);
        }}
        className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-dim hover:text-text cursor-pointer"
      >
        More about this market
        <ChevronDown className={`h-4 w-4 transition-transform ${more ? "rotate-180" : ""}`} />
      </button>

      {more && (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as Tab);
          }}
        >
          <TabsList className="mt-3 flex gap-4 border-b border-border-soft text-[13px]">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="pb-2 cursor-pointer text-text-dim hover:text-text data-[state=active]:border-b-2 data-[state=active]:border-text data-[state=active]:font-semibold data-[state=active]:text-text"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="positions" className="mt-4">
            <PositionsTab event={event} />
          </TabsContent>
          <TabsContent value="comments" className="mt-4">
            <CommentsTab providerEventId={event.providerEventId} />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <ActivityTab event={event} detail={detail} />
          </TabsContent>
          <TabsContent value="holders" className="mt-4">
            <HoldersTab event={event} detail={detail} />
          </TabsContent>
          <TabsContent value="agent" className="mt-4">
            <AgentTab event={event} onAgent={onAgent} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
