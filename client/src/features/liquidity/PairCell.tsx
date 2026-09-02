import { Input } from "@/components/ui/input.tsx";
import { TokenSelector } from "@/features/swap/TokenSelector.tsx";
import type { TokenSymbol } from "@/lib/tokens.ts";

interface Props {
  label: string;
  symbol: TokenSymbol;
  onSymbolChange: (s: TokenSymbol) => void;
  disabledSymbol: TokenSymbol;
  amount: string;
  onAmountChange: (s: string) => void;
}

export function PairCell({
  label,
  symbol,
  onSymbolChange,
  disabledSymbol,
  amount,
  onAmountChange,
}: Props) {
  return (
    <div className="bg-panel-solid border border-border-soft rounded-md p-3 space-y-2">
      <div className="text-xs text-text-dim">{label}</div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => {
            onAmountChange(e.target.value);
          }}
          className="border-0 bg-transparent text-lg font-mono p-0 h-auto"
        />
        <TokenSelector value={symbol} onChange={onSymbolChange} disabledSymbol={disabledSymbol} />
      </div>
    </div>
  );
}
