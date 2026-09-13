/**
 * Phase 7 / R-008 — the marquee-game spike, against a deployment.
 *
 *   npm run load:spike -w @mantua/server -- --target https://test-mantua.vercel.app [--spike]
 *
 * Environment (the server `.env` is loaded if present):
 *   LOAD_TEST_SECRET   the deployment's bypass secret (skips per-IP limiters)
 *   LOAD_TEST_TOKEN    optional Privy bearer — enables the quote flow
 *   CRON_SECRET        optional — reads /api/ops/metrics at the end
 *
 * Flags: --users N (default 50) --duration S (default 30) --trades-per-sec R
 * (default 2) --spike (the documented target: 500 users, 5 trades/s, 120 s)
 * --league nfl|wnba (default nfl).
 *
 * What a virtual user does, for the duration:
 *   - holds one live stream open (`/api/stream/live`), reconnecting as the
 *     client would; time-to-first-snapshot is the `stream_open` sample;
 *   - reads `/api/status` every 20 s and `/api/sports/slate` every 15 s
 *     (the client's fallback cadence);
 *   - with a token, the users collectively issue quotes at the requested
 *     aggregate rate (`/api/markets/trade/quote` for a game in the slate).
 *
 * Pass = every measured route's p95 within its budget (`latency-budgets.ts`),
 * error rate under 1 %, and ≥ 99 % of stream opens succeeded. Exit code 1
 * otherwise. `MARKETS_NOT_DEPLOYED` / `NO_MARKET` are reported but do not
 * count as errors (the repo's current gated state).
 */

import { LATENCY_BUDGETS_MS, type BudgetKey } from "../lib/latency-budgets.ts";

interface Args {
  target: string;
  users: number;
  durationS: number;
  tradesPerSec: number;
  league: string;
}

/** The documented marquee-game target (docs/tasks/054-load-chaos-drills.md). */
export const SPIKE_TARGET = { users: 500, tradesPerSec: 5, durationS: 120 } as const;

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const spike = argv.includes("--spike");
  const target = get("--target") ?? process.env["LOAD_TEST_TARGET"];
  if (!target) {
    console.error(
      "usage: load-test --target <origin> [--users N] [--duration S] [--trades-per-sec R] [--spike]",
    );
    process.exit(2);
  }
  return {
    target: target.replace(/\/$/, ""),
    users: Number(get("--users") ?? (spike ? SPIKE_TARGET.users : 50)),
    durationS: Number(get("--duration") ?? (spike ? SPIKE_TARGET.durationS : 30)),
    tradesPerSec: Number(get("--trades-per-sec") ?? (spike ? SPIKE_TARGET.tradesPerSec : 2)),
    league: get("--league") ?? "nfl",
  };
}

type Key = BudgetKey | "stream_open";

class Samples {
  readonly byKey = new Map<Key, number[]>();
  readonly errors = new Map<Key, number>();
  readonly skipped = new Map<string, number>();
  record(key: Key, ms: number): void {
    const arr = this.byKey.get(key) ?? [];
    arr.push(ms);
    this.byKey.set(key, arr);
  }
  error(key: Key): void {
    this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
  }
  skip(code: string): void {
    this.skipped.set(code, (this.skipped.get(code) ?? 0) + 1);
  }
}

function pct(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const secret = process.env["LOAD_TEST_SECRET"];
  if (secret) h["x-mantua-load-test"] = secret;
  const token = process.env["LOAD_TEST_TOKEN"];
  if (token) h["authorization"] = `Bearer ${token}`;
  return h;
}

async function timed(
  samples: Samples,
  key: Key,
  fn: () => Promise<Response>,
  okCodes: readonly string[] = [],
): Promise<Response | null> {
  const t0 = performance.now();
  try {
    const res = await fn();
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      samples.record(key, ms);
      return res;
    }
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code && okCodes.includes(body.code)) {
      samples.record(key, ms);
      samples.skip(body.code);
      return null;
    }
    samples.error(key);
    return null;
  } catch {
    samples.error(key);
    return null;
  }
}

/** Hold a stream for the run, measuring each open; reconnects like the client. */
async function holdStream(args: Args, samples: Samples, until: number): Promise<void> {
  while (Date.now() < until) {
    const ac = new AbortController();
    const kill = setTimeout(
      () => {
        ac.abort();
      },
      Math.max(1_000, until - Date.now()),
    );
    const t0 = performance.now();
    try {
      const res = await fetch(`${args.target}/api/stream/live?league=${args.league}`, {
        headers: headers({ accept: "text/event-stream" }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        samples.error("stream_open");
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const decoder = new TextDecoder();
      let text = "";
      let opened = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (!opened && text.includes("event: snapshot")) {
          opened = true;
          samples.record("stream_open", Math.round(performance.now() - t0));
          text = "";
        }
        if (text.length > 1_000_000) text = "";
      }
      if (!opened) samples.error("stream_open");
    } catch {
      // aborted at the end of the run, or dropped — reconnect below
    } finally {
      clearTimeout(kill);
    }
    if (Date.now() < until) await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function readerLoop(
  args: Args,
  samples: Samples,
  until: number,
  offsetMs: number,
): Promise<void> {
  await new Promise((r) => setTimeout(r, offsetMs));
  let lastStatus = 0;
  let lastSlate = 0;
  while (Date.now() < until) {
    const now = Date.now();
    if (now - lastStatus >= 20_000) {
      lastStatus = now;
      await timed(samples, "status", () =>
        fetch(`${args.target}/api/status`, { headers: headers() }),
      );
    }
    if (now - lastSlate >= 15_000) {
      lastSlate = now;
      await timed(samples, "slate", () =>
        fetch(`${args.target}/api/sports/slate?league=${args.league}`, { headers: headers() }),
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function quoteLoop(args: Args, samples: Samples, until: number): Promise<void> {
  if (!process.env["LOAD_TEST_TOKEN"] || args.tradesPerSec <= 0) return;
  // Pick a game from the slate once.
  const slateRes = await fetch(`${args.target}/api/sports/slate?league=${args.league}`, {
    headers: headers(),
  });
  const slate = (await slateRes.json().catch(() => null)) as {
    leagues?: Record<string, { events?: { providerEventId: string }[] }>;
  } | null;
  const eventId = slate?.leagues?.[args.league]?.events?.[0]?.providerEventId;
  if (!eventId) {
    console.warn("quote loop: no game in the slate — skipping quotes");
    return;
  }
  const intervalMs = 1_000 / args.tradesPerSec;
  while (Date.now() < until) {
    const t0 = Date.now();
    await timed(
      samples,
      "quote",
      () =>
        fetch(`${args.target}/api/markets/trade/quote`, {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            chainId: 8453,
            providerEventId: eventId,
            outcomeIndex: 0,
            direction: "buy",
            amountRaw: String(1_000_000 + Math.floor(Math.random() * 9_000_000)),
          }),
        }),
      ["MARKETS_NOT_DEPLOYED", "NO_MARKET", "BETTING_CLOSED", "TRADING_HALTED"],
    );
    const elapsed = Date.now() - t0;
    if (elapsed < intervalMs) await new Promise((r) => setTimeout(r, intervalMs - elapsed));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const samples = new Samples();
  const until = Date.now() + args.durationS * 1_000;
  console.log(
    `load-test → ${args.target}: ${String(args.users)} users, ${String(args.durationS)} s, ${String(args.tradesPerSec)} quotes/s${process.env["LOAD_TEST_TOKEN"] ? "" : " (no token: quotes skipped)"}${process.env["LOAD_TEST_SECRET"] ? "" : " (no LOAD_TEST_SECRET: per-IP limits apply)"}`,
  );

  const tasks: Promise<void>[] = [];
  for (let u = 0; u < args.users; u += 1) {
    // Stagger opens over the first 5 s so the spike is a ramp, not a wall.
    const offset = Math.floor((u / args.users) * 5_000);
    tasks.push(
      (async () => {
        await new Promise((r) => setTimeout(r, offset));
        await holdStream(args, samples, until);
      })(),
    );
    tasks.push(readerLoop(args, samples, until, offset + Math.floor(Math.random() * 15_000)));
  }
  tasks.push(quoteLoop(args, samples, until));
  await Promise.all(tasks);

  // ── Report ──
  let pass = true;
  const rows: string[] = [];
  const keys: Key[] = ["stream_open", "status", "slate", "quote"];
  let totalOk = 0;
  let totalErr = 0;
  for (const key of keys) {
    const s = [...(samples.byKey.get(key) ?? [])].sort((a, b) => a - b);
    const errs = samples.errors.get(key) ?? 0;
    totalOk += s.length;
    totalErr += errs;
    if (s.length === 0 && errs === 0) continue;
    const budget = key === "stream_open" ? LATENCY_BUDGETS_MS.stream_open : LATENCY_BUDGETS_MS[key];
    const p95 = pct(s, 95);
    const within = p95 !== null && p95 <= budget;
    if (!within && s.length > 0) pass = false;
    rows.push(
      `${key.padEnd(12)} n=${String(s.length).padStart(5)} err=${String(errs).padStart(4)} p50=${String(pct(s, 50) ?? "-").padStart(5)} p95=${String(p95 ?? "-").padStart(5)} p99=${String(pct(s, 99) ?? "-").padStart(5)} budget=${String(budget).padStart(5)} ${within ? "OK" : "OVER"}`,
    );
  }
  const errorRate = totalOk + totalErr === 0 ? 0 : totalErr / (totalOk + totalErr);
  const opens = samples.byKey.get("stream_open")?.length ?? 0;
  const openErr = samples.errors.get("stream_open") ?? 0;
  const openRate = opens + openErr === 0 ? 1 : opens / (opens + openErr);
  if (errorRate >= 0.01) pass = false;
  if (openRate < 0.99) pass = false;

  console.log("\n" + rows.join("\n"));
  console.log(
    `\nerror rate ${(errorRate * 100).toFixed(2)}% (limit 1%) · stream open success ${(openRate * 100).toFixed(1)}% (min 99%)`,
  );
  if (samples.skipped.size > 0) {
    console.log(
      `skipped (gated, not errors): ${[...samples.skipped.entries()].map(([c, n]) => `${c}×${String(n)}`).join(", ")}`,
    );
  }

  const cron = process.env["CRON_SECRET"];
  if (cron) {
    try {
      const res = await fetch(`${args.target}/api/ops/metrics`, {
        headers: { authorization: `Bearer ${cron}` },
      });
      const body = (await res.json()) as {
        alerts?: { severity: string; title: string }[];
        rpc?: { detail?: string };
      };
      console.log(
        `\nserver alerts: ${(body.alerts ?? []).map((a) => `[${a.severity}] ${a.title}`).join("; ") || "none"}`,
      );
      console.log(`server rpc: ${body.rpc?.detail ?? "n/a"}`);
    } catch {
      console.log("\n(server metrics unavailable)");
    }
  }

  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

void main();
