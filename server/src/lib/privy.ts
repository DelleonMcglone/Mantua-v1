import { PrivyClient } from "@privy-io/server-auth";
import { env } from "../env.ts";

let cached: PrivyClient | null = null;

/**
 * Lazily-constructed Privy server client. Uses VITE_PRIVY_APP_ID (the same
 * public ID the client uses) and PRIVY_APP_SECRET (server-only).
 */
export function getPrivyClient(): PrivyClient {
  if (cached) return cached;
  cached = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  return cached;
}
