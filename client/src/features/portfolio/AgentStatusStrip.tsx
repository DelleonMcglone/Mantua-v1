import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { usd as fmtUsd } from "@/lib/format.ts";

interface PolicyView {
  status: "active" | "paused";
  autoTradeEnabled: boolean;
  maxStakePerTradeUsd: number;
  riskLevel: string;
  allowedLeagues: string[];
}

interface Performance {
  totals: {
    realizedPnlUsd: number;
    winRate: number | null;
    wins: number;
    losses: number;
    openMarkets: number;
    openCostUsd: number;
  };
}

/**
 * Phase 9 / PF-004 — the agent at a glance: active or paused, its trading
 * authority (per-trade ceiling, leagues, unprompted trading), and its
 * track record. Reads the policy and the performance ledger; each is
 * optional so a failed read shows "unavailable" for that line only.
 */
export function AgentStatusStrip() {
  const [policy, setPolicy] = useState<PolicyView | null | undefined>(undefined);
  const [perf, setPerf] = useState<Performance | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PolicyView>("/api/agent/policy")
      .then((p) => {
        if (!cancelled) setPolicy(p);
      })
      .catch(() => {
        if (!cancelled) setPolicy(null);
      });
    api
      .get<Performance>("/api/agent/performance")
      .then((p) => {
        if (!cancelled) setPerf(p);
      })
      .catch(() => {
        if (!cancelled) setPerf(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const paused = policy?.status === "paused";
  return (
    <div className="px-4 py-3 border-b border-border-soft flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${paused ? "bg-red" : policy ? "bg-green" : "bg-border-soft"}`}
          aria-hidden
        />
        <span className="text-[12px] font-medium">
          {policy === undefined
            ? "Checking status…"
            : policy === null
              ? "Status unavailable"
              : paused
                ? "Paused"
                : "Active"}
        </span>
        {policy && (
          <span className="text-[11px] text-text-dim">
            · max {fmtUsd(policy.maxStakePerTradeUsd)} per trade ·{" "}
            {policy.allowedLeagues.length === 0 ? "all leagues" : policy.allowedLeagues.join(", ")}{" "}
            · {policy.autoTradeEnabled ? "unprompted trades allowed" : "asks before every trade"}
          </span>
        )}
      </div>
      <div className="text-[11px] text-text-dim">
        {perf === undefined && "Loading track record…"}
        {perf === null && "Track record unavailable."}
        {perf && (
          <>
            Track record:{" "}
            <span
              className={`font-mono ${perf.totals.realizedPnlUsd >= 0 ? "text-green" : "text-red"}`}
            >
              {perf.totals.realizedPnlUsd >= 0 ? "+" : "−"}
              {fmtUsd(Math.abs(perf.totals.realizedPnlUsd))}
            </span>{" "}
            realized
            {perf.totals.winRate === null
              ? " · no resolved markets yet"
              : ` · ${(perf.totals.winRate * 100).toFixed(0)}% win rate (${String(perf.totals.wins)}-${String(perf.totals.losses)})`}
            {` · ${String(perf.totals.openMarkets)} open (${fmtUsd(perf.totals.openCostUsd)} at risk)`}
          </>
        )}
      </div>
    </div>
  );
}
