import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { api, ApiError } from "@/lib/api.ts";
import { DEFAULT_LIMITS, type ComboLimits } from "./use-combos.ts";

type ComboPolicy = ComboLimits["policy"];
type Field = "maxLegs" | "maxStakeUsd" | "maxOpenExposureUsd" | "maxPayoutUsd";

const FIELDS: { key: Field; label: string; step: string }[] = [
  { key: "maxLegs", label: "Max legs", step: "1" },
  { key: "maxStakeUsd", label: "Max stake ($)", step: "1" },
  { key: "maxOpenExposureUsd", label: "Max open exposure ($)", step: "1" },
  { key: "maxPayoutUsd", label: "Max payout ($)", step: "1" },
];

/**
 * Task 072 / CB-010 — the user's own combo limits, one PATCH to the agent
 * policy's `combo` block. The platform's limits cap these; the server
 * validates strictly and audits every change.
 */
export function ComboLimitsForm() {
  const [policy, setPolicy] = useState<ComboPolicy>(DEFAULT_LIMITS.policy);
  const [platform, setPlatform] = useState(DEFAULT_LIMITS.platform);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ tickets: unknown; limits: ComboLimits }>("/api/combos")
      .then((r) => {
        setPolicy(r.limits.policy);
        setPlatform(r.limits.platform);
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await api.patch("/api/agent/policy", { combo: policy });
      setNotice("Saved.");
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="combo-limits"
      className="mt-3 rounded-md border border-border-soft px-4 py-3.5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
        Your combo limits
      </h3>
      <p className="mt-1 text-[11px] text-text-dim">
        The platform allows up to {String(platform.maxLegs)} legs and $
        {platform.maxStakeUsd.toFixed(0)} a ticket; yours apply within that. The agent builds combos
        only inside these.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-[12px]">
            <span className="text-text-dim">{f.label}</span>
            <Input
              type="number"
              inputMode="decimal"
              step={f.step}
              value={String(policy[f.key])}
              onChange={(e) => {
                setPolicy({ ...policy, [f.key]: Number(e.target.value) });
              }}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="text-text-dim">Take profit at (% of payout)</span>
          <Input
            type="number"
            inputMode="numeric"
            value={String(policy.takeProfitBps / 100)}
            onChange={(e) => {
              setPolicy({ ...policy, takeProfitBps: Math.round(Number(e.target.value) * 100) });
            }}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-col gap-1.5 text-[12px]">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(e) => {
              setPolicy({ ...policy, enabled: e.target.checked });
            }}
          />
          Combos allowed
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={policy.autoManage}
            onChange={(e) => {
              setPolicy({ ...policy, autoManage: e.target.checked });
            }}
          />
          Let the agent manage its own combo tickets (take profit, hedge the last leg) when it runs
          autonomously
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save limits"}
        </Button>
        {notice && <span className="text-[11px] text-text-dim">{notice}</span>}
      </div>
    </section>
  );
}
