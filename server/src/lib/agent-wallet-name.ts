/**
 * Stable, idempotent CDP account name derived from our internal user.id
 * (a UUID). CDP's `getOrCreateAccount({ name })` matches on this string,
 * so calling provision twice for the same user reuses the same on-chain
 * account. The `mantua-agent-` prefix namespaces our accounts inside the
 * CDP project against any other tooling that might write to it.
 *
 * Pure module — no DB or env imports — so unit tests can pull it in
 * without booting the full server.
 */
export function deriveAgentAccountName(userId: string): string {
  return `mantua-agent-${userId}`;
}
