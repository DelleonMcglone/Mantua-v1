/**
 * C-013 — credential-gated Circle E2E harness.
 * `npm run circle:e2e -w @mantua/server`.
 *
 * With real Circle credentials in the environment this runs the REAL flow
 * against Circle testnet:
 *
 *   1. provision (or fetch) an agent wallet in the configured wallet set
 *   2. execute one tiny sponsored no-op — an ERC-20 `transfer(self, 0)` of
 *      USDC — through the production executeAgent path
 *      (`executeAgentAbiCall`: allowlist check → sponsorship guard/refId →
 *      idempotency-keyed create → poll to a TERMINAL state)
 *   3. mirror the agent-send finalization writes (audit log + daily spend
 *      ledger, $0) and verify the rows actually landed in Postgres
 *
 * Without credentials it prints exactly what is missing and exits 0 with a
 * clear SKIPPED status — CI-safe, and ready to run the moment the pending
 * Circle-side entity-secret reset lands.
 *
 * Environment:
 *   CIRCLE_API_KEY        required — must be a TEST key (testnet) unless
 *                         CIRCLE_E2E_ALLOW_MAINNET=1 is set explicitly
 *   CIRCLE_ENTITY_SECRET  required
 *   CIRCLE_WALLET_SET_ID  recommended (unset falls back to the dev
 *                         create-on-the-fly path in client.ts)
 *   DATABASE_URL          optional — absent, the audit/spend verification is
 *                         skipped gracefully (same spirit as circle-preflight)
 *
 * No secret material is ever printed — key shapes only, matching
 * circle-preflight.ts.
 */
import { env } from "../env.ts";
import type { Blockchain } from "@circle-fin/developer-controlled-wallets";

const ok = (m: string) => {
  console.log(`  ✓ ${m}`);
};
const bad = (m: string) => {
  console.log(`  ✗ ${m}`);
};
const note = (m: string) => {
  console.log(`  – ${m}`);
};

/** Redact to a shape, never a value — same style as circle-preflight.ts. */
function keyShape(key: string): string {
  const [prefix, id = ""] = key.split(":");
  return `${prefix}:${id.slice(0, 4)}…:${"•".repeat(8)}`;
}

/** USDC per DCW blockchain — the no-op transfer target (an allowlisted-or-
 *  registered ERC-20; `transfer(self, 0)` moves nothing and touches no state
 *  beyond an event). */
const USDC_BY_BLOCKCHAIN: Partial<Record<Blockchain, `0x${string}`>> = {
  BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "BASE-SEPOLIA": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

async function main(): Promise<number> {
  console.log("\nCircle E2E harness (C-013)\n");

  // ── Credential gate — checked on raw process.env BEFORE any src import,
  // because src/env.ts hard-exits when required vars are missing. ──────────
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
  const walletSetIdEnv = process.env.CIRCLE_WALLET_SET_ID?.trim();
  if (!apiKey || !entitySecret) {
    const missing = [
      ...(apiKey ? [] : ["CIRCLE_API_KEY"]),
      ...(entitySecret ? [] : ["CIRCLE_ENTITY_SECRET"]),
    ];
    console.log("Status: SKIPPED — Circle credentials not present.\n");
    console.log("  Missing environment variables:");
    for (const name of missing) console.log(`    - ${name}`);
    if (!walletSetIdEnv) {
      console.log("    - CIRCLE_WALLET_SET_ID (recommended; dev fallback would create a new set)");
    }
    console.log(
      "\n  Nothing was executed. Set the variables above (docs/tasks/018-circle-credentials.md)\n" +
        "  and re-run — the harness runs the full testnet flow the moment they land.\n",
    );
    return 0; // SKIPPED is a clean exit: this is the expected CI state today.
  }

  console.log("Configuration");
  ok(`CIRCLE_API_KEY present (${keyShape(apiKey)})`);
  ok("CIRCLE_ENTITY_SECRET present (value never logged)");
  const isTestKey = /^TEST_API_KEY:/i.test(apiKey);
  const blockchain: Blockchain = isTestKey ? "BASE-SEPOLIA" : "BASE";
  if (!isTestKey && process.env.CIRCLE_E2E_ALLOW_MAINNET !== "1") {
    bad(
      "CIRCLE_API_KEY is a LIVE key. This harness targets Circle testnet; refusing to execute " +
        "on Base Mainnet. Set CIRCLE_E2E_ALLOW_MAINNET=1 to override deliberately.",
    );
    return 1;
  }
  ok(`Key family → executing on ${blockchain}`);
  if (walletSetIdEnv) ok(`CIRCLE_WALLET_SET_ID pinned: ${walletSetIdEnv}`);
  else note("CIRCLE_WALLET_SET_ID unset — the dev fallback will create a wallet set on the fly");

  // src/env.ts requires DATABASE_URL / PRIVY_* at module load. The harness
  // itself needs none of Privy and only needs Postgres for the verification
  // step, so absent values get inert stubs and the affected step is skipped
  // gracefully (circle-preflight's approach: report, don't crash).
  let dbVerification = true;
  if (!process.env.DATABASE_URL) {
    dbVerification = false;
    process.env.DATABASE_URL = "postgres://stub:stub@localhost:5432/stub";
    note("DATABASE_URL not set — audit-log / daily-spend verification will be SKIPPED");
  }
  process.env.PRIVY_APP_ID ??= "circle-e2e-stub";
  process.env.PRIVY_APP_SECRET ??= "circle-e2e-stub";

  // Imports deferred past the gate (see above).
  const { getCircleClient, getAgentWalletSetId } = await import("../lib/circle/client.ts");
  const { executeAgentAbiCall, CircleReceiptTimeoutError, CircleTransactionFailedError } =
    await import("../lib/circle/execute.ts");
  const { isAllowedTarget, registerDynamicTargets } =
    await import("../lib/circle/allowed-targets.ts");

  // ── 1. Provision (or fetch) an agent wallet in the set ───────────────────
  console.log("\nAgent wallet");
  const client = await getCircleClient();
  const walletSetId = await getAgentWalletSetId();
  ok(`Wallet set: ${walletSetId}`);
  const listed = await client.listWallets({ walletSetId, pageSize: 50 });
  // Wallets in the agent set are provisioned as SCA (agent-wallet.ts and
  // the create below) — matching on blockchain is sufficient here.
  let wallet = (listed.data?.wallets ?? []).find((w) => w.blockchain === blockchain);
  if (wallet) {
    ok(`Reusing existing wallet ${wallet.id} (${wallet.address})`);
  } else {
    const created = await client.createWallets({
      blockchains: [blockchain],
      count: 1,
      walletSetId,
      accountType: "SCA",
      scaConfiguration: { scaCore: env.CIRCLE_SCA_CORE },
    } as Parameters<typeof client.createWallets>[0]);
    wallet = created.data?.wallets.at(0);
    if (!wallet?.id || !wallet.address) {
      bad("Circle createWallets returned no wallet");
      return 1;
    }
    ok(`Provisioned SCA wallet ${wallet.id} (${wallet.address}) on ${blockchain}`);
  }
  const agentAddress = wallet.address.toLowerCase();

  // ── 2. One tiny sponsored no-op through the executeAgent path ────────────
  console.log("\nSponsored no-op execution (USDC transfer(self, 0))");
  const usdc = USDC_BY_BLOCKCHAIN[blockchain];
  if (!usdc) {
    bad(`no USDC address recorded for ${blockchain}`);
    return 1;
  }
  if (!isAllowedTarget(usdc)) {
    // The static allowlist is built from mainnet registries; on testnet the
    // harness registers the testnet USDC through the sanctioned extension
    // hook (registerDynamicTargets) rather than bypassing the choke point.
    registerDynamicTargets([usdc]);
    note(`Registered ${blockchain} USDC ${usdc} as a dynamic execution target`);
  }
  let receipt: { id: string; txHash: `0x${string}`; state: string };
  try {
    receipt = await executeAgentAbiCall({
      walletId: wallet.id,
      to: usdc,
      abiFunctionSignature: "transfer(address,uint256)",
      abiParameters: [wallet.address, "0"],
    });
    ok(`Terminal state ${receipt.state} — Circle tx ${receipt.id}`);
    ok(`txHash ${receipt.txHash}`);
  } catch (err) {
    if (err instanceof CircleReceiptTimeoutError) {
      bad(
        `INDETERMINATE — ${err.message} (txHash so far: ${err.txHash ?? "none"}). ` +
          "The webhook finalizer may still resolve it; the E2E run itself did not confirm.",
      );
      return 1;
    }
    if (err instanceof CircleTransactionFailedError) {
      bad(`Transaction terminated in ${err.state}${err.errorReason ? `: ${err.errorReason}` : ""}`);
      return 1;
    }
    bad(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // ── 3. Audit-log + daily-spend rows, written and verified ────────────────
  console.log("\nDurable rails (audit log + daily spend ledger)");
  if (!dbVerification) {
    note("SKIPPED — no DATABASE_URL. Re-run with Postgres configured to verify the rails.");
  } else {
    try {
      const { logAudit } = await import("../lib/audit.ts");
      const { recordSpending } = await import("../lib/spending-cap.ts");
      const { db } = await import("../db/client.ts");
      const { and, eq, sql } = await import("drizzle-orm");
      const { dailyWalletSpend, mantuaAuditLog } = await import("../db/schema/safety.ts");

      // Mirror the agent-send finalization sequence: record the (zero-USD)
      // spend and the audit entry only after the confirmed receipt.
      await recordSpending(agentAddress, 0);
      await logAudit({
        walletAddress: agentAddress,
        action: "agent_send",
        outcome: "success",
        txHash: receipt.txHash,
        params: {
          harness: "circle-e2e",
          circleTxId: receipt.id,
          blockchain,
          note: "sponsored no-op self-transfer of 0 USDC",
        },
      });

      const auditRows = await db
        .select({ id: mantuaAuditLog.id })
        .from(mantuaAuditLog)
        .where(eq(mantuaAuditLog.txHash, receipt.txHash))
        .limit(1);
      if (auditRows.length > 0) ok(`mantua_audit_log row present for ${receipt.txHash}`);
      else {
        bad(
          `no mantua_audit_log row for ${receipt.txHash} (logAudit swallows insert errors — check server logs)`,
        );
        return 1;
      }

      const spendRows = await db
        .select({ id: dailyWalletSpend.id, txCount: dailyWalletSpend.txCount })
        .from(dailyWalletSpend)
        .where(
          and(
            eq(dailyWalletSpend.walletAddress, agentAddress),
            eq(dailyWalletSpend.spendDate, sql`(now() at time zone 'utc')::date`),
          ),
        )
        .limit(1);
      const spendRow = spendRows.at(0);
      if (spendRow) {
        ok(
          `daily_wallet_spend row present for ${agentAddress} (txCount ${String(spendRow.txCount)})`,
        );
      } else {
        bad(`no daily_wallet_spend row for ${agentAddress} today`);
        return 1;
      }
    } catch (err) {
      bad(`database verification failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  console.log("\nResult: E2E flow completed — provision → sponsored execute → terminal receipt");
  console.log(
    dbVerification
      ? "        → audit + spend rows verified.\n"
      : "        (database verification skipped — no DATABASE_URL).\n",
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
    // The db pool (when opened) holds the event loop; exit explicitly.
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
