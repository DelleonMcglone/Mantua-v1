import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import type { SlateEvent } from "../use-slate.ts";
import { ActivityTab } from "./ActivityTab.tsx";
import { AgentTab } from "./AgentTab.tsx";
import { CommentsTab } from "./CommentsTab.tsx";
import type { DetailResponse } from "./detail-types.ts";
import { HoldersTab } from "./HoldersTab.tsx";
import { PositionsTab } from "./PositionsTab.tsx";

type Tab = "positions" | "comments" | "activity" | "holders" | "agent";

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Your positions" },
  { id: "comments", label: "Comments" },
  { id: "activity", label: "Activity" },
  { id: "holders", label: "Top holders" },
  { id: "agent", label: "Agent" },
];

/**
 * T-010 — the market page's "More" layer: positions, comments, activity,
 * holders, agent, behind one toggle. Phase 12's deeper sections sit above
 * it (`MarketDepthSections.tsx`).
 */
export function MarketTabs({
  event,
  detail,
  onAgent,
}: {
  event: SlateEvent;
  detail: DetailResponse | null;
  onAgent: (message: string) => void;
}) {
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<Tab>("positions");
  return (
    <>
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
    </>
  );
}
