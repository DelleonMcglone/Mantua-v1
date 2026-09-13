/**
 * Task 067 (G-001) — stands in for `@privy-io/react-auth/smart-wallets`
 * under `VITE_E2E_AUTH=shim`. The gasless path is flag-gated off in the
 * suite, so the provider only has to pass children through and the hook
 * only has to exist.
 */
import type { ReactNode } from "react";

export type SmartWalletClientType = never;

export function SmartWalletsProvider({ children }: { children: ReactNode }): ReactNode {
  return children;
}

export function useSmartWallets(): { getClientForChain: () => Promise<null> } {
  return { getClientForChain: () => Promise.resolve(null) };
}
