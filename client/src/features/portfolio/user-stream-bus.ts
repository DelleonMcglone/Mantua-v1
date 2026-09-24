import type { BalancesFrame, PositionsFrame } from "./user-stream-core.ts";

/**
 * Phase 7 / R-001 — where the signed-in stream's user frames enter the
 * client, mirroring the platform-status bus: whichever page's stream is
 * open publishes here, and the balance/position hooks listen, so a fill
 * shows the moment the server pushes it. Pages with no open stream keep
 * polling exactly as before.
 */
export const USER_POSITIONS_EVENT = "mantua:user-positions";
export const USER_BALANCES_EVENT = "mantua:user-balances";

export function publishUserPositions(frame: PositionsFrame): void {
  window.dispatchEvent(new CustomEvent<PositionsFrame>(USER_POSITIONS_EVENT, { detail: frame }));
}

export function publishUserBalances(frame: BalancesFrame): void {
  window.dispatchEvent(new CustomEvent<BalancesFrame>(USER_BALANCES_EVENT, { detail: frame }));
}

/** Subscribe; returns the unsubscribe. */
export function onUserPositions(fn: (frame: PositionsFrame) => void): () => void {
  const h = (e: Event) => {
    fn((e as CustomEvent<PositionsFrame>).detail);
  };
  window.addEventListener(USER_POSITIONS_EVENT, h);
  return () => {
    window.removeEventListener(USER_POSITIONS_EVENT, h);
  };
}

export function onUserBalances(fn: (frame: BalancesFrame) => void): () => void {
  const h = (e: Event) => {
    fn((e as CustomEvent<BalancesFrame>).detail);
  };
  window.addEventListener(USER_BALANCES_EVENT, h);
  return () => {
    window.removeEventListener(USER_BALANCES_EVENT, h);
  };
}
