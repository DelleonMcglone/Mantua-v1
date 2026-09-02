import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api } from "@/lib/api.ts";
import { Button } from "@/components/ui/button.tsx";

interface StrategyRow {
  id: string;
  strategyType: string;
  status: "armed" | "triggered" | "executed" | "expired" | "disarmed";
  config: Record<string, unknown>;
  capUsd: string;
  disarmedReason: string | null;
  armedAt: string;
}

interface PreviewResponse {
  draft: { kind: string; takeProfitBps?: number; stopBps?: number; capUsd?: number };
  preview: string[];
  candidates: { marketId: string; side: "yes"; label: string; league: string }[];
}

const STATUS_STYLE: Record<StrategyRow["status"], string> = {
  armed: "bg-green/15 text-green",
  triggered: "bg-accent/15 text-accent",
  executed: "bg-accent/15 text-accent",
  expired: "bg-chip text-text-mute",
  disarmed: "bg-chip text-text-mute",
};

/**
 * B9-006 — the strategy dashboard, inside the profile. Lists every
 * strategy with its lifecycle state and audit reason, offers the
 * per-strategy kill (B9-007), and arms new ones through the two-step
 * preview → confirm flow: natural language only ever produces a draft
 * the user confirms as structured numbers (B9-004).
 */
export function StrategiesSection() {
  const [rows, setRows] = useState<StrategyRow[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .get<{ strategies: StrategyRow[] }>("/api/strategies")
      .then((res) => {
        setRows(res.strategies);
      })
      .catch(() => {
        setRows([]);
      });
  }, []);
  useEffect(reload, [reload]);

  const handlePreview = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.post<PreviewResponse>("/api/strategies/preview", { text });
      setPreview(res);
      setChosen(res.candidates.length === 1 ? (res.candidates[0]?.marketId ?? null) : null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't parse that strategy.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleArm = async () => {
    if (!preview) return;
    const { draft } = preview;
    if (draft.kind !== "take-profit-stop" || !chosen) return;
    setBusy(true);
    setNote(null);
    try {
      await api.post("/api/strategies", {
        config: {
          kind: "take-profit-stop",
          marketId: chosen,
          side: "yes",
          ...(draft.takeProfitBps !== undefined ? { takeProfitBps: draft.takeProfitBps } : {}),
          ...(draft.stopBps !== undefined ? { stopBps: draft.stopBps } : {}),
        },
        capUsd: draft.capUsd ?? 100,
      });
      setPreview(null);
      setText("");
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Failed to arm.");
    } finally {
      setBusy(false);
    }
  };

  const handleDisarm = async (id: string) => {
    try {
      await api.post(`/api/strategies/${id}/disarm`, {});
    } finally {
      reload();
    }
  };

  return (
    <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <ShieldAlert className="h-3.5 w-3.5" /> Hedging strategies
      </h3>

      {rows.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
          None yet. Describe one below — e.g. &ldquo;take profit at 80% on the Chiefs&rdquo; or
          &ldquo;stop loss at 30%&rdquo;. Strategies auto-disarm at kickoff.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-sm border border-border-soft px-2.5 py-2"
            >
              <span
                className={`rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase ${STATUS_STYLE[row.status]}`}
              >
                {row.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px]">
                {row.strategyType.replaceAll("_", " ")} · cap ${row.capUsd}
                {row.disarmedReason ? ` · ${row.disarmedReason}` : ""}
              </span>
              {row.status === "armed" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void handleDisarm(row.id);
                  }}
                >
                  Disarm
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder='e.g. "take profit at 80% on the Chiefs"'
          className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-transparent px-2.5 text-[12.5px] outline-none placeholder:text-text-mute"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || text.length < 3}
          onClick={() => void handlePreview()}
        >
          Preview
        </Button>
      </div>

      {note && <p className="mt-2 text-[11.5px] text-yellow">{note}</p>}

      {preview && (
        <div className="mt-2.5 rounded-sm border border-accent/30 bg-accent/5 px-3 py-2.5">
          <ul className="flex flex-col gap-0.5 text-[12px] text-text-dim">
            {preview.preview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {preview.draft.kind === "take-profit-stop" && (
            <>
              {preview.candidates.length === 0 ? (
                <p className="mt-2 text-[11.5px] text-yellow">
                  No upcoming market matches that team — check the name, or wait for the slate.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  {preview.candidates.map((c) => (
                    <label key={c.marketId} className="flex items-center gap-2 text-[12px]">
                      <input
                        type="radio"
                        name="strategy-market"
                        checked={chosen === c.marketId}
                        onChange={() => {
                          setChosen(c.marketId);
                        }}
                      />
                      {c.label} <span className="text-text-mute">({c.league.toUpperCase()})</span>
                    </label>
                  ))}
                </div>
              )}
              <Button
                variant="primary"
                size="sm"
                className="mt-2.5"
                disabled={busy || !chosen}
                onClick={() => void handleArm()}
              >
                Confirm &amp; arm
              </Button>
            </>
          )}
          {preview.draft.kind === "delta-hedge" && (
            <p className="mt-2 text-[11.5px] text-text-mute">
              Delta hedges arm once you hold positions across markets — trading opens with the
              market pools.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
