/**
 * C-005 (D-111) — gasless user transactions: configuration resolution.
 *
 * Pure, dependency-light module (no Privy imports) so the node test runner
 * can exercise it directly. The feature is OFF unless `VITE_GASLESS_ENABLED`
 * is explicitly truthy; every other variable is optional.
 *
 * What lives where:
 *  - The ERC-4337 bundler URL and paymaster URL are configured PER CHAIN in
 *    the Privy Dashboard (Wallet infrastructure → Smart wallets), not here.
 *    The client never sees those URLs; Privy's SmartWalletsProvider reads
 *    them from the app's dashboard config.
 *  - `VITE_GASLESS_PAYMASTER_CONTEXT` (optional JSON object) is forwarded
 *    verbatim as the `paymasterContext` — some paymasters (e.g. Biconomy
 *    mode flags, Alchemy gas-manager policy hints) take per-request context.
 *    Circle Paymaster and Pimlico sponsorship policies typically need none.
 */
import { cleanEnv } from "../env.ts";

export interface GaslessConfig {
  /** Master flag — false means the EOA path is used unconditionally. */
  enabled: boolean;
  /**
   * Optional context object forwarded to the smart-wallet paymaster on
   * every sponsored user operation. Undefined when unset or invalid.
   */
  paymasterContext: Record<string, unknown> | undefined;
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Strict boolean parse of a flag env var: only explicit truthy values enable. */
export function parseFlag(raw: string | undefined): boolean {
  return TRUTHY.has(cleanEnv(raw).toLowerCase());
}

/**
 * Parse the paymaster-context JSON. Anything other than a JSON object
 * (arrays, scalars, invalid JSON) resolves to undefined — a malformed
 * value must never take the trade path down, only degrade to "no context".
 */
export function parsePaymasterContext(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  const v = cleanEnv(raw);
  if (!v) return undefined;
  try {
    const parsed: unknown = JSON.parse(v);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through — treated as unset
  }
  return undefined;
}

/** Resolve the full gasless config from an env record (pure; testable). */
export function resolveGaslessConfig(env: Record<string, string | undefined>): GaslessConfig {
  return {
    enabled: parseFlag(env["VITE_GASLESS_ENABLED"]),
    paymasterContext: parsePaymasterContext(env["VITE_GASLESS_PAYMASTER_CONTEXT"]),
  };
}

// `import.meta.env` only exists under Vite — the node-based test runner
// loads this module too, so read defensively (same pattern as chains.ts).
const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** The app-wide gasless config, resolved once at module load (build-time env). */
export const GASLESS_CONFIG: GaslessConfig = resolveGaslessConfig(viteEnv);
