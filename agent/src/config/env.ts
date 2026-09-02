/**
 * Environment loader + validation for the Base agent. The signing key and
 * every contract address are loaded from env — never hardcoded in code.
 * Verified default values + their sources live in .env.example and
 * docs/architecture.md. Call loadEnv() from the composition root only;
 * action providers receive their dependencies as parameters so they stay
 * env-free and testable.
 */
import { z } from "zod";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte 0x address");

const schema = z.object({
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  /** Signing key for the agent's Base wallet (gas paid in ETH). */
  AGENT_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x 32-byte private key"),

  // ERC-8004 registries. No defaults — Base Mainnet deployment pending
  // (see docs/tasks/v2-roadmap.md); the identity/reputation actions are
  // skipped until all three are set.
  IDENTITY_REGISTRY_ADDRESS: hexAddress.optional(),
  REPUTATION_REGISTRY_ADDRESS: hexAddress.optional(),
  VALIDATION_REGISTRY_ADDRESS: hexAddress.optional(),
  // ERC-8183 job/escrow contract. No default — Base Mainnet deployment
  // pending; the job actions are skipped until it is set.
  AGENTIC_COMMERCE_ADDRESS: hexAddress.optional(),

  // Allowlisted assets (USDC/EURC/cbBTC) ERC-20 addresses. Defaults are
  // the canonical Base Mainnet deployments.
  USDC_ADDRESS: hexAddress.default("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  EURC_ADDRESS: hexAddress.default("0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"),
  CBBTC_ADDRESS: hexAddress.default("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"),

  /** Warn when the agent's native ETH gas balance drops below this many ETH. */
  LOW_GAS_WARN_ETH: z.coerce.number().positive().default(0.001),
});

export type AgentEnv = z.infer<typeof schema>;

export function loadEnv(): AgentEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid agent environment:\n${issues}\nSee agent/.env.example.`);
  }
  return parsed.data;
}
