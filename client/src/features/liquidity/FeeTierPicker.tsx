import {
  FEE_TIERS,
  FEE_TIER_HINTS,
  FEE_TIER_LABELS,
  TICK_SPACING_BY_FEE,
  type FeeTier,
} from "./fee-tiers.ts";

interface Props {
  value: FeeTier;
  onChange: (f: FeeTier) => void;
}

export function FeeTierPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {FEE_TIERS.map((f) => {
        const active = value === f;
        return (
          <button
            key={f}
            type="button"
            onClick={() => {
              onChange(f);
            }}
            className={`text-left p-3 rounded-sm border transition-colors ${
              active
                ? "border-accent bg-chip"
                : "border-border-soft bg-bg-elev hover:border-text-mute"
            }`}
          >
            <div className="font-mono text-sm">{FEE_TIER_LABELS[f]}</div>
            <div className="text-[10px] text-text-mute uppercase tracking-wider mt-1">
              {FEE_TIER_HINTS[f]}
            </div>
            <div className="text-[10px] text-text-mute mt-0.5">tick {TICK_SPACING_BY_FEE[f]}</div>
          </button>
        );
      })}
    </div>
  );
}
