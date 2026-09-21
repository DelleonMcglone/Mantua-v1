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
import { env, circleCredentialIssues, circleDegradations } from "../env.ts";
import {
  getCircleClient,
  getAgentWalletSetId,
  CircleUnavailableError,
} from "../lib/circle/client.ts";
import { getGasStationPolicyId } from "../lib/circle/sponsorship.ts";

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
const warn = (m: string) => {
  console.log(`  ! ${m}`);
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
  const parts = env.CIRCLE_API_KEY.split(":").length;
  if (parts !== 3) {
    bad(
      `Key has ${String(parts)} colon-separated parts; Circle's console format is 3 ` +
        `(PREFIX:ID:SECRET). If you pasted the key AND a separate "ID" field, drop the ` +
        `extra — the id is already the middle segment. Copy the key verbatim from the ` +
        `console. The live check below is authoritative either way.`,
    );
  }
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
  // Degradations are real gaps, but they don't fail the boot or this check:
  // the agent is refused at transaction time, everything else keeps working.
  for (const issue of circleDegradations(env)) warn(issue);

  console.log("\nLive checks");
  // C-017 — captured for the Gas Station section: a policy can only sponsor
  // transactions whose wallet set is live and holds BASE wallets.
  let walletSetLive = false;
  let baseWallets = false;
  try {
    const client = await getCircleClient();
    ok("SDK client constructed (entity secret accepted locally)");

    // The first authenticated call is what actually proves the API key and
    // the registered entity secret ciphertext are valid together.
    const setId = await getAgentWalletSetId();
    ok(`Wallet set reachable: ${setId}`);
    walletSetLive = true;

    const wallets = await client.listWallets({ walletSetId: setId, pageSize: 10 });
    const count = wallets.data?.wallets.length ?? 0;
    ok(`Authenticated to Circle; wallet set holds ${String(count)} wallet(s)`);

    const blockchains = new Set(
      (wallets.data?.wallets ?? []).map((w) => w.blockchain).filter(Boolean),
    );
    baseWallets = blockchains.has("BASE");
    if (blockchains.size > 0) {
      const list = [...blockchains].join(", ");
      if (baseWallets) ok(`Wallets on BASE (also: ${list})`);
      else bad(`No BASE wallets — found ${list}. The app provisions on BASE.`);
    }
  } catch (err) {
    if (err instanceof CircleUnavailableError) bad(err.message);
    else bad(`Live check failed: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  }

  console.log("\nGas Station (paymaster)");
  const policyId = getGasStationPolicyId();
  if (policyId) {
    ok(`Policy id recorded (UUID, boot-validated): ${policyId}`);
    if (walletSetLive && baseWallets) {
      ok(
        "Sponsorship dependencies verified live: wallet set reachable and holds BASE wallets — " +
          "Gas Station auto-sponsors those SCA transactions from the policy that is ACTIVE " +
          "and default for Base.",
      );
    } else {
      bad("Policy's live dependencies unverified — wallet set / BASE wallet checks above failed.");
      failed = true;
    }
    console.log(
      "    Provenance: every transaction the server creates carries refId `gas-station:<id>`.\n" +
        "    Circle's console lists sponsored transactions per policy, so a transaction that\n" +
        "    does NOT appear under this policy means the recorded id is not the one actually\n" +
        "    sponsoring the code. Circle exposes no policy-read API (management is\n" +
        "    console-only), so also confirm in Console → Gas Station that the policy is\n" +
        "    ACTIVE and is the default policy for Base — transactions use only the\n" +
        "    network's default policy.",
    );
  } else {
    bad(
      "No CIRCLE_GAS_STATION_POLICY_ID — agent transactions are unsponsored (production refuses to create them). In Console → Gas Station, create a policy for this wallet set on Base, ACTIVATE it, and make it the default policy for Base — then record its id.",
    );
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
