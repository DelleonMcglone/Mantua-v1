interface Props {
  value: number;
  onChange: (n: number) => void;
}

export function SlippageRow({ value, onChange }: Props) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-dim">Slippage</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={500}
          step={5}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onChange(Math.max(0, Math.min(500, n)));
          }}
          className="w-20 h-7 text-xs px-2 rounded-sm bg-bg-elev border border-border focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <span className="text-text-mute">bps</span>
      </div>
    </div>
  );
}
