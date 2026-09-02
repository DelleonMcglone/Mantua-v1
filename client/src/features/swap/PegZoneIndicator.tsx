import { PEG_ZONES, PEG_ZONE_META, type PegZone } from "./hook-types.ts";

interface PegZoneIndicatorProps {
  zone: PegZone;
  /** Optional deviation in bps for the secondary line. */
  deviationBps?: number;
}

/**
 * P5-003 — Stable Protection 5-zone peg status indicator. Renders a
 * 5-segment bar with the active zone highlighted, plus a label line
 * showing the current zone name + optional deviation.
 */
export function PegZoneIndicator({ zone, deviationBps }: PegZoneIndicatorProps) {
  const activeIdx = PEG_ZONES.indexOf(zone);
  const meta = PEG_ZONE_META[zone];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-[0.12em] text-text-mute uppercase">
          Peg Status
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span aria-hidden>{meta.emoji}</span>
          <span className="font-mono" style={{ color: meta.color }}>
            {meta.label.toUpperCase()}
          </span>
          {deviationBps !== undefined && (
            <span className="text-text-dim font-mono">· {(deviationBps / 100).toFixed(2)}%</span>
          )}
        </div>
      </div>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-valuenow={activeIdx + 1}
        aria-valuemin={1}
        aria-valuemax={5}
      >
        {PEG_ZONES.map((z, i) => {
          const m = PEG_ZONE_META[z];
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          return (
            <div
              key={z}
              className="flex-1 h-2 rounded-xs transition-all"
              style={{
                background: isActive || isPast ? m.color : "var(--chip)",
                opacity: isActive ? 1 : isPast ? 0.45 : 1,
                boxShadow: isActive ? `0 0 0 1px ${m.color}40` : "none",
              }}
            />
          );
        })}
      </div>
      <div className="text-[11px] text-text-dim leading-snug">{meta.description}</div>
    </div>
  );
}
