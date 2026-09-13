/**
 * Task 067 (G-016 / G-017) — runs the incident runbook §13 kill-switch
 * drill against a deployment and prints the log to file.
 *
 *   npm run drill:kill-switch -w @mantua/server -- --target https://<staging-host> \
 *     [--operator name] [--observer name] [--commit sha]
 *
 * Environment (the server `.env` is loaded if present):
 *   CRON_SECRET   optional — step 5 checks a money cron refuses while engaged
 *
 * The operator flips the runtime lever (`mantua:kill-switch` in Upstash)
 * when prompted; this script does the timing, the polling, and the write-up.
 * The two client observations (steps 4 and 8) are answered at the prompt.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  classifyWrite,
  judge,
  renderLog,
  type DrillPoll,
  type DrillRecord,
} from "../lib/ops/drill-core.ts";

const POLL_MS = 2_000;
const GIVE_UP_MS = 120_000;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function poll(target: string): Promise<DrillPoll> {
  const at = Date.now();
  const write = await fetch(`${target}/api/markets/trade/calldata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
  const body = write ? ((await write.json().catch(() => null)) as { code?: string } | null) : null;
  const statusRes = await fetch(`${target}/api/status`).catch(() => null);
  const status = statusRes?.ok
    ? ((await statusRes.json()) as { killSwitch: boolean; trading: string })
    : null;
  return {
    at,
    writeCode: write?.status ?? null,
    writeErrorCode: body?.code ?? null,
    status: status ? { killSwitch: status.killSwitch, trading: status.trading } : null,
  };
}

/** Poll until the write path reads as `want`, or give up. */
async function until(target: string, want: "engaged" | "open"): Promise<DrillPoll | null> {
  const deadline = Date.now() + GIVE_UP_MS;
  while (Date.now() < deadline) {
    const p = await poll(target);
    stdout.write(
      `  ${new Date(p.at).toISOString()} write=${p.writeCode === null ? "—" : String(p.writeCode)} kill=${p.status ? String(p.status.killSwitch) : "—"}\n`,
    );
    if (classifyWrite(p) === want) return p;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

async function cronRefuses(target: string): Promise<boolean | null> {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return null;
  const res = await fetch(`${target}/api/cron/rebalance`, {
    headers: { authorization: `Bearer ${secret}` },
  }).catch(() => null);
  return res?.status === 503;
}

async function main(): Promise<void> {
  const target = arg("target", "").replace(/\/$/, "");
  if (!target) throw new Error("--target https://<host> is required");
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (q: string) => rl.question(`${q} `);
  const yes = async (q: string) => /^y/i.test((await ask(`${q} [y/n]`)).trim());

  const baseline = await poll(target);
  if (baseline.status?.killSwitch !== false) throw new Error("step 0: kill switch must be off");
  const record: DrillRecord = {
    host: target,
    commit: arg("commit", "unknown"),
    operator: arg("operator", "operator"),
    observer: arg("observer", "observer"),
    t0: baseline.at,
    t1: null,
    t2: null,
    t3: null,
    clientPaused: null,
    cron503: null,
    t6: null,
    t7: null,
    clientResumed: null,
  };

  await ask("Step 1 — engage the runtime lever (mantua:kill-switch = 1), then press Enter.");
  record.t1 = Date.now();
  const engaged = await until(target, "engaged");
  record.t2 = engaged?.at ?? null;
  record.t3 = engaged?.status?.killSwitch ? engaged.at : null;
  record.clientPaused = await yes(
    "Step 4 — does the ticket read 'Trading paused' without a reload?",
  );
  record.cron503 = await cronRefuses(target);

  await ask("Step 6 — release the lever (mantua:kill-switch = 0), then press Enter.");
  record.t6 = Date.now();
  record.t7 = (await until(target, "open"))?.at ?? null;
  record.clientResumed = await yes("Step 8 — did Confirm come back without a reload?");
  rl.close();

  const verdict = judge(record);
  stdout.write(`\n${renderLog(record, verdict)}\n`);
  process.exitCode = verdict.pass ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
