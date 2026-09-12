import type { PlatformStatus } from "./platform-status.ts";
import type { LatencySnapshot } from "./metrics.ts";
import { IN_PLAY_FEED_MAX_AGE_MS } from "./sports/market-trade-build.ts";

/**
 * Phase 7 / R-010 — the alert evaluator, pure. Inputs are the snapshots
 * the platform already computes (status, latency, trade counters, RPC,
 * the M-01 divergence query); output is the list of conditions that
 * warrant a human, each with a severity and the runbook section. The
 * thresholds ARE the paging policy (docs/ops/monitoring.md); the evaluator
 * runs on every `/api/ops/alerts` read and on every live-sync tick, which
 * logs each firing alert as a structured `alert` event for the log drain.
 */

export type AlertSeverity = "info" | "warn" | "critical";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Where to look — a runbook section. */
  runbook: string;
}

export interface FrozenNotFinalRow {
  marketId: string;
  providerEventId: string;
  eventStatus: string;
  frozenForMs: number;
}

export interface AlertInput {
  status: PlatformStatus;
  latency: readonly LatencySnapshot[];
  /** Trade counters from `metrics.ts` (per instance). */
  counters: Readonly<Record<string, number>>;
  /** Markets FROZEN whose canonical event is not final (M-01). */
  frozenNotFinal: readonly FrozenNotFinalRow[];
  /** Stream connections vs the per-instance cap. */
  stream: { connections: number; max: number };
}

/** Minimum samples before a p95 is trusted for paging. */
export const LATENCY_MIN_SAMPLES = 20;
/** Minimum fill reports before the success rate is trusted for paging. */
export const TRADE_MIN_SAMPLES = 10;
/** Verified-fill failure rate that pages. */
export const TRADE_FAILURE_RATE_CRITICAL = 0.1;
/** How long a FROZEN-but-not-final divergence may persist before paging (M-01). */
export const FROZEN_NOT_FINAL_GRACE_MS = 5 * 60_000;
/** Minimum gated agent executions (ok + refused) before the refusal rate is trusted. */
export const AGENT_GATE_MIN_SAMPLES = 10;
/** Share of gated executions refused that warns (A-040 — the funnel is breaking). */
export const AGENT_REFUSAL_RATE_WARN = 0.5;

export function evaluateAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const s = input.status;

  if (s.killSwitch) {
    alerts.push({
      id: "kill_switch",
      severity: "info",
      title: "Kill switch engaged",
      detail:
        "Writes are refused platform-wide (operator action). Reads and read-only crons continue.",
      runbook: "docs/ops/incident-runbook.md §1",
    });
  }

  for (const [league, f] of Object.entries(s.feeds)) {
    if (f.liveGames === 0) continue;
    if (f.buysHalted) {
      alerts.push({
        id: `feed_dark:${league}`,
        severity: "critical",
        title: `${league.toUpperCase()} feed dark during play — buys halted`,
        detail: `Last ingest ${f.ageMs === null ? "never" : `${String(Math.round(f.ageMs / 1000))} s ago`}; ${String(f.liveGames)} game(s) in play. Check the live-sync loop and the provider breakers.`,
        runbook: "docs/ops/incident-runbook.md §3, §8",
      });
    } else if (f.ageMs !== null && f.ageMs > IN_PLAY_FEED_MAX_AGE_MS / 2) {
      alerts.push({
        id: `feed_lag:${league}`,
        severity: "warn",
        title: `${league.toUpperCase()} feed lagging during play`,
        detail: `Last ingest ${String(Math.round(f.ageMs / 1000))} s ago — past half the halt threshold (${String(IN_PLAY_FEED_MAX_AGE_MS / 1000)} s). One more missed tick halts buys.`,
        runbook: "docs/ops/incident-runbook.md §8",
      });
    }
  }

  if (s.openBreakers.length > 0) {
    alerts.push({
      id: "provider_breaker_open",
      severity: "warn",
      title: "Sports data provider breaker open",
      detail: `Open: ${s.openBreakers.join(", ")}. Stale-serve is in effect; ingestion heals when the host recovers.`,
      runbook: "docs/ops/incident-runbook.md §3",
    });
  }

  if (s.rpc && !s.rpc.healthy) {
    alerts.push({
      id: "rpc_down",
      severity: "critical",
      title: "All RPC hosts failing",
      detail: `${s.rpc.detail ?? "no detail"}. Balances, prices and the fill verifier cannot read the chain.`,
      runbook: "docs/ops/incident-runbook.md §9",
    });
  } else if (s.rpc?.detail?.includes("on fallback")) {
    alerts.push({
      id: "rpc_on_fallback",
      severity: "warn",
      title: "RPC primary failing — reads on fallback",
      detail: s.rpc.detail,
      runbook: "docs/ops/incident-runbook.md §9",
    });
  }

  for (const l of input.latency) {
    if (l.count < LATENCY_MIN_SAMPLES || l.p95 === null) continue;
    if (l.p95 > l.budgetMs * 2) {
      alerts.push({
        id: `latency:${l.key}`,
        severity: "critical",
        title: `${l.key} p95 ${String(l.p95)} ms — over 2× budget (${String(l.budgetMs)} ms)`,
        detail: `${String(l.violations)}/${String(l.count)} requests over budget in the window; ${String(l.errors)} server errors.`,
        runbook: "docs/ops/monitoring.md §Latency",
      });
    } else if (l.p95 > l.budgetMs) {
      alerts.push({
        id: `latency:${l.key}`,
        severity: "warn",
        title: `${l.key} p95 ${String(l.p95)} ms — over budget (${String(l.budgetMs)} ms)`,
        detail: `${String(l.violations)}/${String(l.count)} requests over budget in the window.`,
        runbook: "docs/ops/monitoring.md §Latency",
      });
    }
  }

  const fillsOk = input.counters["fill.recorded"] ?? 0;
  const fillsFailed =
    (input.counters["fill.tx_failed"] ?? 0) +
    (input.counters["fill.wrong_target"] ?? 0) +
    (input.counters["fill.verify_failed"] ?? 0);
  const fills = fillsOk + fillsFailed;
  if (fills >= TRADE_MIN_SAMPLES && fillsFailed / fills > TRADE_FAILURE_RATE_CRITICAL) {
    alerts.push({
      id: "trade_success_rate",
      severity: "critical",
      title: `Trade success rate ${String(Math.round((fillsOk / fills) * 100))}%`,
      detail: `${String(fillsFailed)} of ${String(fills)} reported fills failed verification (reverted, wrong target, or unreadable receipt).`,
      runbook: "docs/ops/monitoring.md §Trades",
    });
  }

  // PF-011 / D-116 — a priced token valued at zero means a feed is dead and
  // every portfolio total that includes it is silently short.
  const zeroPrices = input.counters["pricing.fallback_zero"] ?? 0;
  if (zeroPrices > 0) {
    alerts.push({
      id: "pricing_zero",
      severity: "warn",
      title: `Price feed returned $0 ${String(zeroPrices)}× this instance`,
      detail:
        "Pyth and the DefiLlama fallback both failed for a priced token; portfolio and earnings totals undervalue it until a feed recovers. Cap enforcement is unaffected (strict pricing fails closed).",
      runbook: "docs/ops/monitoring.md §Pricing",
    });
  }

  // A-040 — the agent's execution gate: many refusals per execution means
  // the model is calling money tools without the user's confirm (a prompt
  // regression) or previews are drifting; both are worth a look, not a page.
  const executed = input.counters["agent.funnel.execute_ok"] ?? 0;
  let refused = 0;
  const byCode: string[] = [];
  for (const [k, v] of Object.entries(input.counters)) {
    if (k.startsWith("agent.funnel.refused.")) {
      refused += v;
      byCode.push(`${k.slice("agent.funnel.refused.".length)} ${String(v)}`);
    }
  }
  const gated = executed + refused;
  if (gated >= AGENT_GATE_MIN_SAMPLES && refused / gated > AGENT_REFUSAL_RATE_WARN) {
    alerts.push({
      id: "agent_refusal_rate",
      severity: "warn",
      title: `Agent gate refused ${String(Math.round((refused / gated) * 100))}% of executions`,
      detail: `${String(refused)} refused vs ${String(executed)} executed this instance (${byCode.join(", ")}). Check the prompt's confirm protocol and simulation drift.`,
      runbook: "docs/ops/incident-runbook.md §12",
    });
  }

  const divergent = input.frozenNotFinal.filter((r) => r.frozenForMs > FROZEN_NOT_FINAL_GRACE_MS);
  if (divergent.length > 0) {
    alerts.push({
      id: "frozen_not_final",
      severity: "critical",
      title: `M-01: ${String(divergent.length)} FROZEN market(s) whose game is not final`,
      detail: divergent
        .map(
          (r) =>
            `${r.marketId.slice(0, 10)}… (game ${r.providerEventId} is ${r.eventStatus}, frozen ${String(Math.round(r.frozenForMs / 60_000))} min)`,
        )
        .join("; "),
      runbook: "docs/ops/incident-runbook.md §2; docs/security/markets-contracts-review.md M-01",
    });
  }

  if (input.stream.max > 0 && input.stream.connections >= input.stream.max) {
    alerts.push({
      id: "stream_at_capacity",
      severity: "warn",
      title: "Live stream at per-instance capacity",
      detail: `${String(input.stream.connections)}/${String(input.stream.max)} connections; new clients are polling.`,
      runbook: "docs/ops/incident-runbook.md §8",
    });
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
