/**
 * Circle credential preflight — `npm run circle:preflight -w @mantua/server`.
 *
 * Verifies the credentials in the current environment actually work, WITHOUT
 * printing any secret material: it reports shapes, ids, and live API results
 * only. Run it after pasting credentials into `.env` (or after setting them
 * in the Vercel dashboard, with `vercel env pull`) and before the first
 * deploy that expects agent wallets to function.
 *
 * Exit code 0 = usable, 1 = something needs fixing.
 */
import { env, circleCredentialIssues } from "../env.ts";
import {
  getCircleClient,
  getAgentWalletSetId,
  CircleUnavailableError,
} from "../lib/circle/client.ts";

/** Redact to a shape, never a value: `LIVE_API_KEY:1a2b…:••••`. */
function keyShape(key: string): string {
  const [prefix, id] = key.split(":");
  return `${prefix}:${id.slice(0, 4)}…:${"•".repeat(8)}`;
}

const ok = (m: string) => {
  console.log(`  ✓ ${m}`);
};
const bad = (m: string) => {
  console.log(`  ✗ ${m}`);
};

async function main(): Promise<number> {
  let failed = false;
  console.log("\nCircle credential preflight\n");

  console.log("Configuration");
  if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) {
    bad("CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET not set — agent wallets are disabled.");
    console.log("\n  See docs/tasks/018-circle-credentials.md for the provisioning runbook.\n");
    return 1;
  }
  ok(`CIRCLE_API_KEY present (${keyShape(env.CIRCLE_API_KEY)})`);
  ok("CIRCLE_ENTITY_SECRET present (64 hex chars, value never logged)");
  if (/^TEST_API_KEY:/i.test(env.CIRCLE_API_KEY)) {
    bad("This is a TEST key — the agent would run on testnet, not Base Mainnet.");
    failed = true;
  }

  // Boot-time validation only hard-fails in production; surface the same
  // issues here regardless of NODE_ENV so dev can see what prod will reject.
  const issues = circleCredentialIssues(env);
  for (const issue of issues) {
    bad(issue);
    failed = true;
  }

  console.log("\nLive checks");
  try {
    const client = await getCircleClient();
    ok("SDK client constructed (entity secret accepted locally)");

    // The first authenticated call is what actually proves the API key and
    // the registered entity secret ciphertext are valid together.
    const setId = await getAgentWalletSetId();
    ok(`Wallet set reachable: ${setId}`);

    const wallets = await client.listWallets({ walletSetId: setId, pageSize: 10 });
    const count = wallets.data?.wallets.length ?? 0;
    ok(`Authenticated to Circle; wallet set holds ${String(count)} wallet(s)`);

    const blockchains = new Set(
      (wallets.data?.wallets ?? []).map((w) => w.blockchain).filter(Boolean),
    );
    if (blockchains.size > 0) {
      const list = [...blockchains].join(", ");
      if (blockchains.has("BASE")) ok(`Wallets on BASE (also: ${list})`);
      else bad(`No BASE wallets — found ${list}. The app provisions on BASE.`);
    }
  } catch (err) {
    if (err instanceof CircleUnavailableError) bad(err.message);
    else bad(`Live check failed: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  }

  console.log("\nGas Station (paymaster)");
  if (env.CIRCLE_GAS_STATION_POLICY_ID) {
    ok(`Policy id recorded: ${env.CIRCLE_GAS_STATION_POLICY_ID}`);
    console.log(
      "    Note: Developer-Controlled Wallets has no paymaster API credential — sponsorship\n" +
        "    is console-side policy. This id documents that it was configured deliberately;\n" +
        "    confirm in Console → Gas Station that the policy covers this wallet set on Base.",
    );
  } else {
    bad("No CIRCLE_GAS_STATION_POLICY_ID — agent transactions are unsponsored.");
    failed = true;
  }

  console.log(
    failed
      ? "\nResult: NOT ready. Fix the ✗ items above.\n"
      : "\nResult: credentials look usable.\n",
  );
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
