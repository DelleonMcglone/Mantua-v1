import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api.ts";
import { TERMS_VERSION } from "@/lib/legal-version.ts";
import { termsGate, type AcceptanceWire, type GateState } from "./legal-core.ts";

interface AcceptanceResponse {
  terms: AcceptanceWire;
  privacy: AcceptanceWire;
}

/**
 * Task 067 (G-014) — the signed-in user's standing against the current
 * Terms, and the one call that records acceptance. Read once per login;
 * `accept` flips the gate to clear on success.
 */
export function useLegalAcceptance(): {
  gate: GateState;
  accepting: boolean;
  error: string | null;
  accept: () => Promise<void>;
} {
  const { ready, authenticated } = usePrivy();
  const [loaded, setLoaded] = useState(false);
  const [terms, setTerms] = useState<AcceptanceWire | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    api
      .get<AcceptanceResponse>("/api/legal/acceptance")
      .then((res) => {
        if (!cancelled) setTerms(res.terms);
      })
      .catch(() => {
        if (!cancelled) setTerms(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated]);

  const accept = useCallback(async () => {
    setAccepting(true);
    setError(null);
    try {
      await api.post("/api/legal/acceptance", { doc: "terms", version: TERMS_VERSION });
      setTerms({
        version: TERMS_VERSION,
        acceptedVersion: TERMS_VERSION,
        acceptedAt: new Date().toISOString(),
        current: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record your acceptance.");
    } finally {
      setAccepting(false);
    }
  }, []);

  return { gate: termsGate({ authenticated, loaded, terms }), accepting, error, accept };
}
