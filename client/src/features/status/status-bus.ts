import type { PlatformStatusWire } from "./connection-status-core.ts";

/**
 * Phase 7 / R-005 — the one place a platform status enters the client.
 * Any live stream that receives a `status` frame publishes it here; the
 * PlatformStatusProvider listens, so the banner updates the instant the
 * server pushes a change on any open stream, not on its next poll.
 */
export const PLATFORM_STATUS_EVENT = "mantua:platform-status";

export function publishPlatformStatus(status: PlatformStatusWire): void {
  window.dispatchEvent(
    new CustomEvent<PlatformStatusWire>(PLATFORM_STATUS_EVENT, { detail: status }),
  );
}

export function isPlatformStatusWire(value: unknown): value is PlatformStatusWire {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["generatedAt"] === "number" &&
    typeof v["mode"] === "string" &&
    typeof v["reads"] === "string" &&
    typeof v["trading"] === "string" &&
    typeof v["killSwitch"] === "boolean" &&
    (v["message"] === null || typeof v["message"] === "string")
  );
}
