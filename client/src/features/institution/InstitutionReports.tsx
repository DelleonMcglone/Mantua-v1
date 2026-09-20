import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { api, ApiError } from "@/lib/api.ts";
import {
  hasPermission,
  RECONCILE_LABELS,
  shortAddress,
  type InstitutionView,
} from "./institution-core.ts";

interface Reconciliation {
  at: string;
  wallets: { address: string; circleRaw: string | null; chainRaw: string | null; status: string }[];
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function usdc(raw: string | null): string {
  return raw === null
    ? "—"
    : (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Task 073 / IC-002 — reports for members with `view_reports`: the period
 * statement and the audit trail as CSV downloads, and reconciliation of
 * the balance Circle reports against the chain for every member wallet.
 */
export function InstitutionReports({ view }: { view: InstitutionView }) {
  // Lazy initialisers: the clock is read once, when the section mounts.
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const [notice, setNotice] = useState<string | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  if (!hasPermission(view.me, "view_reports")) return null;

  const period = `from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`;
  const download = async (kind: "statement" | "audit") => {
    setNotice(null);
    try {
      const blob = await api.getBlob(`/api/institution/reports/${kind}?${period}&format=csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${view.institution.slug}-${kind}-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Download failed.");
    }
  };
  const reconcile = async () => {
    setNotice(null);
    try {
      setRecon(await api.get<Reconciliation>("/api/institution/reports/reconciliation"));
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Reconciliation failed.");
    }
  };

  return (
    <div className="mt-3" data-testid="institution-reports">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">Reports</h4>
      <div className="mt-1 flex flex-wrap items-end gap-2 text-[12px]">
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">From</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">To</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
        </label>
        <Button variant="ghost" size="sm" onClick={() => void download("statement")}>
          Statement CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void download("audit")}>
          Audit CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void reconcile()}>
          Reconcile with Circle
        </Button>
      </div>
      {recon && (
        <ul className="mt-2 flex flex-col gap-1 text-[12px]">
          {recon.wallets.length === 0 && <li className="text-text-dim">No wallets yet.</li>}
          {recon.wallets.map((w) => (
            <li key={w.address} className="flex flex-wrap justify-between gap-2">
              <span className="font-mono">{shortAddress(w.address)}</span>
              <span>
                Circle {usdc(w.circleRaw)} · chain {usdc(w.chainRaw)} USDC
              </span>
              <span className="text-text-dim">{RECONCILE_LABELS[w.status] ?? w.status}</span>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="mt-1 text-[11px] text-text-dim">{notice}</p>}
    </div>
  );
}
