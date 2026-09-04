/**
 * C-005 (D-111) — gasless provider shell.
 *
 * When `VITE_GASLESS_ENABLED` is on, mounts Privy's SmartWalletsProvider
 * (which provisions/tracks the user's ERC-4337 smart wallet over the
 * embedded signer, using the bundler + paymaster configured per chain in
 * the Privy Dashboard). When off — the default — this renders children
 * untouched: zero behavior change, no smart-wallet code on the render path.
 *
 * Must be mounted INSIDE MantuaPrivyProvider (it consumes Privy context).
 */
import type { ReactNode } from "react";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { GASLESS_CONFIG } from "./config.ts";

export function GaslessProvider({ children }: { children: ReactNode }) {
  if (!GASLESS_CONFIG.enabled) return <>{children}</>;
  const ctx = GASLESS_CONFIG.paymasterContext;
  return (
    <SmartWalletsProvider {...(ctx ? { config: { paymasterContext: ctx } } : {})}>
      {children}
    </SmartWalletsProvider>
  );
}
