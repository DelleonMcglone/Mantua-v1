import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateWallet, usePrivy } from "@privy-io/react-auth";

export type WalletSetupStatus = "idle" | "creating" | "failed";

/**
 * Repairs a signed-in session that has no wallet. The provider creates the
 * embedded wallet at login (`createOnLogin`), but only then: a login whose
 * wallet step failed leaves the user signed in with nothing to trade from,
 * on every later visit. This creates the wallet once per mount when that
 * state is seen, and exposes a retry for the header.
 */
export function useEnsureWallet(): { status: WalletSetupStatus; retry: () => void } {
  const { ready, authenticated, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const [status, setStatus] = useState<WalletSetupStatus>("idle");
  const attempted = useRef(false);
  const missing = ready && authenticated && !user?.wallet?.address;

  const run = useCallback(() => {
    setStatus("creating");
    createWallet()
      .then(() => {
        setStatus("idle");
      })
      .catch((err: unknown) => {
        console.warn("wallet setup failed", err);
        setStatus("failed");
      });
  }, [createWallet]);

  useEffect(() => {
    if (!missing) {
      attempted.current = false;
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    run();
  }, [missing, run]);

  return { status: missing ? status : "idle", retry: run };
}
