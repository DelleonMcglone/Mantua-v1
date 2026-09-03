import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, Bot, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { api } from "@/lib/api.ts";
import type { SlateEvent } from "./use-slate.ts";

const EXPLORER = "https://basescan.org/tx/";

// ─── Data shapes (mirror server/src/routes/market-detail.ts) ─────────────────

interface PricePoint {
  t: number;
  outcomeIndex: number;
  priceBps: number;
}

interface ActivityRow {
  t: number;
  address: string;
  direction: string;
  outcomeIndex: number;
  usdc: number;
  tokens: number;
  txHash: string;
}

interface HolderRow {
  address: string;
  isContract: boolean;
  label: string | null;
  balance: string;
  pctOfSupply: number;
}

interface OutcomeHolders {
  outcomeIndex: number;
  holders: HolderRow[];
  top10Pct: number;
}

interface DetailResponse {
  hasMarkets: boolean;
  prices: PricePoint[];
  activity: ActivityRow[];
  holders: OutcomeHolders[];
}

interface Comment {
  id: string;
  address: string;
  body: string;
  t: number;
}

interface PositionRow {
  marketId: string;
  label: string;
  side: "yes" | "no";
  balance: string;
  impliedProbBps: number | null;
  valueRaw: string;
  providerEventId: string | null;
  entryPriceBps: number | null;
  pnlRaw: string | null;
}

type Tab = "comments" | "holders" | "positions" | "activity" | "agent";

const TABS: { id: Tab; label: string }[] = [
  { id: "comments", label: "Comments" },
  { id: "holders", label: "Top Holders" },
  { id: "positions", label: "Positions" },
  { id: "activity", label: "Activity" },
  { id: "agent", label: "Agent" },
];

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function timeAgo(t: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${String(Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${String(Math.floor(s / 3600))}h ago`;
  return `${String(Math.floor(s / 86_400))}d ago`;
}

interface Props {
  event: SlateEvent;
  /** Back to the games list. */
  onBack: () => void;
  /** Hand this matchup to the autonomous agent. */
  onAgent: (message: string) => void;
}

/**
 * Polymarket-style market detail for one matchup: the fill-derived price
 * chart up top, then Comments / Top Holders / Positions / Activity / Agent
 * tabs. Renders in place of the games list; the trade sidebar stays put.
 */
export function MarketDetail({ event, onBack, onAgent }: Props) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("comments");

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

  const time = new Date(event.startsAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
        <div>
          <h2 className="text-[18px] font-semibold">
            {event.away.name} at {event.home.name}
          </h2>
          <p className="text-[12px] text-text-dim">
            {event.status === "final" ? "Final" : time}
            {event.liveOdds ? " · market odds live" : ""}
          </p>
        </div>
      </div>

      <PriceChart event={event} detail={detail} failed={failed} />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Tab);
        }}
      >
        <TabsList className="mt-5 flex gap-4 border-b border-border-soft text-[13px]">
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

        <TabsContent value="comments" className="mt-4">
          <CommentsTab providerEventId={event.providerEventId} />
        </TabsContent>
        <TabsContent value="holders" className="mt-4">
          <HoldersTab event={event} detail={detail} />
        </TabsContent>
        <TabsContent value="positions" className="mt-4">
          <PositionsTab event={event} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab event={event} detail={detail} />
        </TabsContent>
        <TabsContent value="agent" className="mt-4">
          <AgentTab event={event} onAgent={onAgent} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Chart ───────────────────────────────────────────────────────────────────

const CHART_W = 640;
const CHART_H = 180;

function polyline(points: PricePoint[], t0: number, t1: number): string {
  const span = Math.max(1, t1 - t0);
  return points
    .map((p) => {
      const x = ((p.t - t0) / span) * CHART_W;
      const y = CHART_H - (Math.min(10_000, Math.max(0, p.priceBps)) / 10_000) * CHART_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function PriceChart({
  event,
  detail,
  failed,
}: {
  event: SlateEvent;
  detail: DetailResponse | null;
  failed: boolean;
}) {
  const { home, away } = useMemo(() => {
    const prices = detail?.prices ?? [];
    const h = prices.filter((p) => p.outcomeIndex === 0);
    const a = prices.filter((p) => p.outcomeIndex === 1);
    // The slate's live implied probability anchors the right edge, so the
    // chart always ends at the price the row shows. Anchored a step past
    // the last fill (or kickoff) to keep this render-pure.
    if (typeof event.homeWinProbabilityBps === "number") {
      const anchor = prices.reduce((m, p) => Math.max(m, p.t), event.startsAt) + 60;
      h.push({ t: anchor, outcomeIndex: 0, priceBps: event.homeWinProbabilityBps });
      a.push({ t: anchor, outcomeIndex: 1, priceBps: 10_000 - event.homeWinProbabilityBps });
    }
    // A lone point draws nothing — extend it left so it reads as a flat line.
    for (const series of [h, a]) {
      if (series.length === 1) {
        const only = series[0];
        series.unshift({ ...only, t: only.t - 3600 });
      }
    }
    return { home: h, away: a };
  }, [detail, event.homeWinProbabilityBps, event.startsAt]);

  const all = [...home, ...away];
  if (failed) {
    return (
      <div className="rounded-md border border-border-soft px-4 py-8 text-center text-[12.5px] text-text-dim">
        Chart unavailable right now.
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <div className="rounded-md border border-border-soft px-4 py-8 text-center text-[12.5px] text-text-dim">
        No market prices yet — the chart draws from live trades once this game&apos;s market opens.
      </div>
    );
  }

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const latest = (pts: PricePoint[]) => pts.at(-1)?.priceBps;
  const homePct = latest(home);
  const awayPct = latest(away);

  return (
    <div className="rounded-md border border-border-soft bg-panel-solid p-4">
      <div className="mb-2 flex items-center gap-4 text-[12px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          {event.home.abbreviation}
          {typeof homePct === "number" && (
            <span className="font-mono font-semibold text-text">{(homePct / 100).toFixed(0)}%</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green" />
          {event.away.abbreviation}
          {typeof awayPct === "number" && (
            <span className="font-mono font-semibold text-text">{(awayPct / 100).toFixed(0)}%</span>
          )}
        </span>
        <span className="ml-auto text-[11px] text-text-mute">implied win probability</span>
      </div>
      <svg
        viewBox={`0 0 ${String(CHART_W)} ${String(CHART_H)}`}
        className="h-[180px] w-full"
        preserveAspectRatio="none"
        aria-label="Price history"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={CHART_W}
            y1={CHART_H * f}
            y2={CHART_H * f}
            stroke="var(--border-soft)"
            strokeDasharray="3 5"
          />
        ))}
        {home.length > 0 && (
          <polyline
            points={polyline(home, t0, t1)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        )}
        {away.length > 0 && (
          <polyline
            points={polyline(away, t0, t1)}
            fill="none"
            stroke="var(--green)"
            strokeWidth={2}
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-text-mute">
        <span>
          {new Date(t0 * 1000).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
          })}
        </span>
        <span>now</span>
      </div>
    </div>
  );
}

// ─── Comments ────────────────────────────────────────────────────────────────

function CommentsTab({ providerEventId }: { providerEventId: string }) {
  const { authenticated } = usePrivy();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .get<{ comments: Comment[] }>(`/api/markets/comments?providerEventId=${providerEventId}`)
      .then((res) => {
        setComments(res.comments);
      })
      .catch(() => {
        setComments([]);
      });
  }, [providerEventId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const post = () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    api
      .post<{ comment: Comment | null }>("/api/markets/comments", { providerEventId, body })
      .then(() => {
        setDraft("");
        reload();
      })
      .catch(() => {
        setError("Could not post the comment. Try again.");
      })
      .finally(() => {
        setPosting(false);
      });
  };

  return (
    <div>
      {authenticated ? (
        <div className="mb-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") post();
            }}
            maxLength={400}
            placeholder="Add a comment…"
            className="flex-1 rounded-md border border-border-soft bg-bg-elev px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
          <Button variant="primary" disabled={posting || draft.trim() === ""} onClick={post}>
            {posting ? "Posting…" : "Post"}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event("mantua:open-login"));
          }}
          className="mb-4 w-full rounded-md border border-border-soft px-3 py-2 text-[12.5px] text-text-dim hover:text-text cursor-pointer"
        >
          Log in to join the conversation
        </button>
      )}
      {error && <p role="alert" className="mb-2 text-[12px] text-yellow">{error}</p>}
      {comments === null ? (
        <p role="status" className="text-[12.5px] text-text-dim">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-[12.5px] text-text-dim">No comments yet — start the thread.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border-soft px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-text-mute">
                <span className="font-mono text-text-dim">{shortAddr(c.address)}</span>
                {timeAgo(c.t)}
              </div>
              <p className="text-[13px] leading-relaxed text-text">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Top holders ─────────────────────────────────────────────────────────────

function HoldersTab({ event, detail }: { event: SlateEvent; detail: DetailResponse | null }) {
  if (!detail) return <p role="status" className="text-[12.5px] text-text-dim">Loading holders…</p>;
  const sides = [0, 1].map((idx) => ({
    idx,
    team: idx === 0 ? event.home : event.away,
    data: detail.holders.find((h) => h.outcomeIndex === idx),
  }));
  const any = sides.some((s) => (s.data?.holders.length ?? 0) > 0);
  if (!any) {
    return (
      <p className="text-[12.5px] text-text-dim">
        No holders yet — positions appear here once this market trades.
      </p>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sides.map(({ idx, team, data }) => (
        <div key={idx} className="rounded-md border border-border-soft p-3.5">
          <h4 className="mb-2 text-[12px] font-semibold">{team.name} YES</h4>
          {data && data.holders.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {data.holders.map((h) => (
                <li key={h.address} className="flex items-center justify-between text-[12px]">
                  <span className="font-mono text-text-dim">
                    {h.label ?? shortAddr(h.address)}
                    {h.isContract ? " (contract)" : ""}
                  </span>
                  <span className="font-mono text-text">{h.pctOfSupply.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-text-dim">No holders yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Positions ───────────────────────────────────────────────────────────────

function PositionsTab({ event }: { event: SlateEvent }) {
  const { authenticated, user } = usePrivy();
  const address = user?.wallet?.address;
  const [rows, setRows] = useState<PositionRow[] | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    api
      .get<{ positions: PositionRow[] }>(`/api/markets/positions?address=${address}`)
      .then((res) => {
        if (!cancelled) {
          setRows(res.positions.filter((p) => p.providerEventId === event.providerEventId));
        }
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address, event.providerEventId]);

  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new Event("mantua:open-login"));
        }}
        className="w-full rounded-md border border-border-soft px-3 py-2 text-[12.5px] text-text-dim hover:text-text cursor-pointer"
      >
        Log in to see your positions in this market
      </button>
    );
  }
  if (rows === null) return <p role="status" className="text-[12.5px] text-text-dim">Loading positions…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-text-dim">
        No position in this market yet — use the trade panel to take one.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((p) => {
        const value = Number(p.valueRaw) / 1e6;
        const pnl = p.pnlRaw === null ? null : Number(p.pnlRaw) / 1e6;
        return (
          <li
            key={p.marketId}
            className="flex items-center justify-between rounded-md border border-border-soft px-3.5 py-2.5 text-[13px]"
          >
            <div>
              <div className="font-medium">{p.label}</div>
              <div className="text-[11px] text-text-dim">
                {Number(p.balance).toFixed(2)} YES
                {p.entryPriceBps !== null &&
                  ` · avg entry ${String(Math.round(p.entryPriceBps / 100))}¢`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono">${value.toFixed(2)}</div>
              {pnl !== null && (
                <div className={`font-mono text-[11px] ${pnl >= 0 ? "text-green" : "text-yellow"}`}>
                  {pnl >= 0 ? "+" : ""}
                  {pnl.toFixed(2)}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

function ActivityTab({ event, detail }: { event: SlateEvent; detail: DetailResponse | null }) {
  if (!detail) return <p role="status" className="text-[12.5px] text-text-dim">Loading activity…</p>;
  if (detail.activity.length === 0) {
    return (
      <p className="text-[12.5px] text-text-dim">
        No trades yet — activity appears here as this market trades.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {detail.activity.map((a) => {
        const team = a.outcomeIndex === 0 ? event.home : event.away;
        return (
          <li
            key={a.txHash}
            className="flex items-center justify-between rounded-md border border-border-soft px-3.5 py-2.5 text-[12.5px]"
          >
            <div>
              <span className="font-mono text-text-dim">{shortAddr(a.address)}</span>{" "}
              <span className={a.direction === "buy" ? "text-green" : "text-yellow"}>
                {a.direction === "buy" ? "bought" : "sold"}
              </span>{" "}
              {a.tokens.toFixed(2)} {team.abbreviation} YES
              <span className="text-text-dim"> for ${a.usdc.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-text-mute">
              {timeAgo(a.t)}
              <a
                href={`${EXPLORER}${a.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View transaction"
                className="text-text-dim hover:text-text"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Agent ───────────────────────────────────────────────────────────────────

function AgentTab({ event, onAgent }: { event: SlateEvent; onAgent: (message: string) => void }) {
  const message =
    `Evaluate the ${event.away.name} at ${event.home.name} game ` +
    `(event ${event.providerEventId}). Read the live market odds, compare them with your ` +
    `research, and recommend whether to place a bet — and if so, which side and how much.`;
  return (
    <div className="rounded-md border border-border-soft px-4 py-5 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Bot className="h-5 w-5" />
      </div>
      <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-text-dim">
        Hand this matchup to your Circle agent: it reads the live slate and pool odds, buys any
        research it needs, and can place the bet from its own wallet — within your daily cap.
      </p>
      <Button
        variant="primary"
        className="mt-4"
        onClick={() => {
          onAgent(message);
        }}
      >
        Evaluate with your agent
      </Button>
    </div>
  );
}
