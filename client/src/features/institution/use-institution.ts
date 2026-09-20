import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.ts";
import type { InstitutionView, Withdrawal } from "./institution-core.ts";

/**
 * Task 074 — the signed-in user's institution (`GET /api/institution`).
 * `"none"` when they belong to no institution (404), null while loading;
 * reloads on demand and on the app-wide refresh event.
 */
export function useInstitution(enabled: boolean) {
  const [view, setView] = useState<InstitutionView | "none" | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    api
      .get<InstitutionView>("/api/institution")
      .then(setView)
      .catch(() => {
        // 404 NOT_MEMBER is the normal answer for a retail user; any other
        // failure hides the section the same way rather than half-rendering it.
        setView("none");
      });
  }, [enabled]);
  useEffect(() => {
    reload();
    window.addEventListener("mantua:refresh-portfolio", reload);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", reload);
    };
  }, [reload]);
  return { view, reload };
}

/** The institution's withdrawals (`GET /api/institution/withdrawals`). */
export function useWithdrawals(enabled: boolean) {
  const [rows, setRows] = useState<Withdrawal[] | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    api
      .get<{ withdrawals: Withdrawal[] }>("/api/institution/withdrawals")
      .then((r) => {
        setRows(r.withdrawals);
      })
      .catch(() => {
        setRows((prev) => prev ?? []);
      });
  }, [enabled]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { rows, reload };
}

/** One POST with the API's message as the notice; resolves to the notice. */
export async function post(path: string, body: unknown): Promise<string> {
  try {
    const r = await api.post<{ code?: string; error?: string; kind?: string }>(path, body);
    return r.kind ? r.kind.replaceAll("_", " ") : "Done.";
  } catch (err) {
    return err instanceof ApiError ? err.message : "Request failed.";
  }
}
