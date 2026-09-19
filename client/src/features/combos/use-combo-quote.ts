import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import { legRefs, type BuilderLeg, type ComboQuoteResult } from "./combo-core.ts";

/**
 * Task 072 / CB-002, CB-003 — the debounced combo quote
 * (`POST /api/combos/quote`): rules, policy gate and pricing for the
 * current legs and stake, no ink, no cap touch. The previous quote stays
 * on screen during a re-quote (R-003).
 */

export type ComboQuotePhase =
  | { kind: "idle" }
  | { kind: "quoting"; previous: ComboQuoteResult | null }
  | { kind: "quoted"; quote: ComboQuoteResult }
  | { kind: "error"; message: string; code: string };

export const QUOTE_DEBOUNCE_MS = 400;

export function useComboQuote(legs: readonly BuilderLeg[], stake: string, enabled: boolean) {
  const [phase, setPhase] = useState<ComboQuotePhase>({ kind: "idle" });
  const refs = JSON.stringify(legRefs(legs));
  const raw = Math.round(Number(stake) * 1e6);
  const active = enabled && legs.length >= 2 && Number.isFinite(raw) && raw > 0;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      setPhase((prev) => ({
        kind: "quoting",
        previous:
          prev.kind === "quoted" ? prev.quote : prev.kind === "quoting" ? prev.previous : null,
      }));
      api
        .post<ComboQuoteResult>("/api/combos/quote", {
          chainId: BASE_CHAIN_ID,
          legs: JSON.parse(refs) as unknown,
          stakeRaw: String(raw),
        })
        .then((quote) => {
          setPhase({ kind: "quoted", quote });
        })
        .catch((err: unknown) => {
          // A refused quote (422) still carries the violations to show.
          if (err instanceof ApiError && err.status === 422 && err.details === undefined) {
            setPhase({ kind: "error", message: err.message, code: err.code });
            return;
          }
          setPhase({
            kind: "error",
            message: err instanceof Error ? err.message : "Quote failed",
            code: err instanceof ApiError ? err.code : "UNKNOWN",
          });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [active, refs, raw]);

  // An inactive builder (too few legs, no stake) shows no quote, whatever
  // the last request returned.
  const quote: ComboQuoteResult | null = !active
    ? null
    : phase.kind === "quoted"
      ? phase.quote
      : phase.kind === "quoting"
        ? phase.previous
        : null;
  return { phase, quote, quoting: active && phase.kind === "quoting" };
}
