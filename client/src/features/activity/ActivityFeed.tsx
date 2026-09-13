import { useState } from "react";
import { ArrowDownUp, ArrowLeftRight, Bot, Droplet, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { TxRow } from "@/components/ui/tx-row.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import {
  ACTIVITY_FILTERS,
  groupByDay,
  metaLine,
  relativeTime,
  statusLabel,
  statusTone,
  type ActivityCategory,
  type ActivityFilter,
  type ActivityItem,
} from "./activity-core.ts";
import { useActivity } from "./use-activity.ts";

/**
 * Phase 9 / PF-018, PF-019, PF-020 — the Activity timeline: one
 * chronological feed of everything that happened to the user's money —
 * their trades, their agent's trades and hedges, liquidity, transfers,
 * settlements and the agent's research — as cards grouped by day with an
 * activity-specific icon, a status chip, the amount and value, the time,
 * and a verification link rendered through the neutral tx row (no chain
 * branding in this surface).
 */

const ICONS: Record<ActivityCategory, typeof ArrowLeftRight> = {
  trade: ArrowLeftRight,
  liquidity: Droplet,
  transfer: ArrowDownUp,
  agent: Bot,
  settlement: Trophy,
};

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  success: "bg-green/10 border-green/35 text-green",
  error: "bg-red/10 border-red/35 text-red",
  pending: "bg-chip border-border-soft text-text-dim animate-pulse",
  muted: "bg-chip border-border-soft text-text-mute",
};

export function ActivityFeed({ walletAddress }: { walletAddress: string | null }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const feed = useActivity(walletAddress, filter);
  // Captured once per mount: relative times are coarse (minutes / hours).
  const [now] = useState(() => Date.now());

  if (!walletAddress) {
    return <EmptyState>Connect a wallet to see your activity.</EmptyState>;
  }

  const groups = groupByDay(feed.items, now);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-border-soft">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setFilter(f.key);
            }}
            aria-pressed={filter === f.key}
            className={`px-2.5 py-1 rounded-full border text-[11px] cursor-pointer ${
              filter === f.key
                ? "bg-chip border-accent text-text"
                : "bg-transparent border-border-soft text-text-dim"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {feed.error && <EmptyState tone="error">{feed.error}</EmptyState>}
      {!feed.error && feed.items.length === 0 && !feed.loading && (
        <EmptyState>
          {filter === "all"
            ? "Nothing yet — trades, transfers and your agent's actions will show up here."
            : "Nothing in this category yet."}
        </EmptyState>
      )}
      {!feed.error && feed.items.length === 0 && feed.loading && (
        <EmptyState>Loading activity…</EmptyState>
      )}

      {groups.map((g) => (
        <section key={g.key} className="border-b border-border-soft">
          <div className="px-4 pt-3 pb-1.5 text-[11px] uppercase tracking-wide text-text-mute">
            {g.label}
          </div>
          <ul className="flex flex-col gap-2 px-4 pb-3 list-none m-0 p-0">
            {g.items.map((item) => (
              <ActivityCard key={item.id} item={item} nowMs={now} />
            ))}
          </ul>
        </section>
      ))}

      {feed.hasMore && (
        <div className="px-4 py-3">
          <Button size="sm" variant="ghost" disabled={feed.loading} onClick={feed.loadMore}>
            {feed.loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ActivityCard({ item, nowMs }: { item: ActivityItem; nowMs: number }) {
  const Icon = ICONS[item.category];
  const tone = statusTone(item.status);
  const meta = metaLine(item);
  return (
    <li className="rounded-md border border-border-soft bg-bg-elev p-3 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-chip text-text-dim"
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text leading-snug">{item.summary}</div>
          {meta && <div className="text-[11px] text-text-dim mt-0.5">{meta}</div>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] px-1.5 py-px rounded-full border ${TONE_CLASS[tone]}`}>
            {statusLabel(item.status)}
          </span>
          <time dateTime={item.createdAt} className="text-[11px] text-text-mute">
            {relativeTime(item.createdAt, nowMs)}
          </time>
        </div>
      </div>
      {item.txHash && (
        <TxRow hash={item.txHash} explorerUrl={getExplorerTxUrl(BASE_CHAIN_ID, item.txHash)} />
      )}
    </li>
  );
}
