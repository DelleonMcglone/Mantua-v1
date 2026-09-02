import { Input } from "@/components/ui/input.tsx";
import { MAX_SLIPPAGE_BPS } from "./constants.ts";

export function SlippageInput({
  valueBps,
  onChange,
}: {
  valueBps: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-dim">
      Slippage
      <Input
        type="number"
        min={0}
        max={MAX_SLIPPAGE_BPS}
        step={5}
        value={valueBps}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(MAX_SLIPPAGE_BPS, n)));
        }}
        className="w-20 h-7 text-xs px-2"
      />
      bps
    </label>
  );
}
