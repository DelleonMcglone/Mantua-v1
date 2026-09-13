import { Router, type Request, type Response } from "express";
import { db, dbPoolSnapshot } from "../db/client.ts";
import {
  evaluateAlerts,
  type Alert,
  type AlertInput,
  type FrozenNotFinalRow,
} from "../lib/alerts.ts";
import { counters, latency, LATENCY_BUDGETS_MS, CONFIRMATION_BUDGET_MS } from "../lib/metrics.ts";
import type { PlatformStatus } from "../lib/platform-status.ts";
import { rpcHealthSnapshot } from "../lib/rpc-client.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { readFrozenNotFinal } from "../lib/sports/store.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { liveStreamConnections, MAX_CONNECTIONS } from "./live-stream.ts";
import { platformStatusReader } from "./platform-status.ts";

/**
 * Phase 7 / R-010 — the operator's metrics and alerts reads. Guarded like
 * the crons (Bearer CRON_SECRET). Everything latency/counter-shaped is
 * per lambda instance — the response says so — and the alert evaluator
 * is the one paging policy (docs/ops/monitoring.md).
 */

export interface OpsDeps {
  readStatus: () => Promise<PlatformStatus>;
  readFrozenNotFinal: () => Promise<readonly FrozenNotFinalRow[]>;
  latencySnapshot: () => ReturnType<typeof latency.snapshot>;
  counterSnapshot: () => Record<string, number>;
  streamConnections: () => number;
  now: () => number;
}

export function defaultOpsDeps(): OpsDeps {
  return {
    readStatus: platformStatusReader,
    readFrozenNotFinal: () => readFrozenNotFinal(db),
    latencySnapshot: () => latency.snapshot(),
    counterSnapshot: () => counters.snapshot(),
    streamConnections: liveStreamConnections,
    now: () => Date.now(),
  };
}

export async function buildAlertInput(deps: OpsDeps): Promise<AlertInput> {
  const [status, frozenNotFinal] = await Promise.all([
    deps.readStatus(),
    deps.readFrozenNotFinal().catch((): readonly FrozenNotFinalRow[] => []),
  ]);
  return {
    status,
    latency: deps.latencySnapshot(),
    counters: deps.counterSnapshot(),
    frozenNotFinal,
    stream: { connections: deps.streamConnections(), max: MAX_CONNECTIONS },
  };
}

export function createOpsMetricsRouter(overrides: Partial<OpsDeps> = {}): Router {
  const deps: OpsDeps = { ...defaultOpsDeps(), ...overrides };
  const router = Router();

  router.get("/api/ops/metrics", requireCronSecret, async (_req: Request, res: Response) => {
    const input = await buildAlertInput(deps);
    const alerts: Alert[] = evaluateAlerts(input);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      generatedAt: deps.now(),
      scope:
        "per-instance (latency, counters, stream, cache); platform-wide (status, rpc, frozenNotFinal)",
      budgets: { ...LATENCY_BUDGETS_MS, confirmation_client: CONFIRMATION_BUDGET_MS },
      latency: input.latency,
      counters: input.counters,
      stream: input.stream,
      cache: sharedCache.snapshot(),
      rpc: rpcHealthSnapshot(),
      db: dbPoolSnapshot(),
      status: input.status,
      frozenNotFinal: input.frozenNotFinal,
      alerts,
    });
  });

  router.get("/api/ops/alerts", requireCronSecret, async (_req: Request, res: Response) => {
    const input = await buildAlertInput(deps);
    const alerts = evaluateAlerts(input);
    res.setHeader("Cache-Control", "no-store");
    res.json({ generatedAt: deps.now(), count: alerts.length, alerts });
  });

  return router;
}

export const opsMetricsRouter = createOpsMetricsRouter();
