import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { CalibrationReport } from "./calibration-core.ts";

/** `GET /api/calibration` — public, cached a minute server-side. */
export function useCalibration(): {
  report: CalibrationReport | null;
  error: string | null;
} {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<CalibrationReport>("/api/calibration")
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the report");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { report, error };
}
