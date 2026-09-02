import { Input } from "@/components/ui/input.tsx";
import { TokenSelector } from "./TokenSelector.tsx";
import type { TokenSymbol } from "@/lib/tokens.ts";

interface AmountInputProps {
  label: string;
  amount: string;
  onAmountChange?: (s: string) => void;
  symbol: TokenSymbol;
  onSymbolChange: (s: TokenSymbol) => void;
  disabledSymbol?: TokenSymbol;
  disabled?: boolean;
  showMax?: boolean;
  onMax?: () => void;
}

/**
 * Token amount cell — label, big number input, MAX button, token chip.
 * `disabled` makes the input read-only (output side); `onMax` wires MAX
 * to the wallet balance once Phase 8 surfaces it.
 */
export function AmountInput({
  label,
  amount,
  onAmountChange,
  symbol,
  onSymbolChange,
  disabledSymbol,
  disabled = false,
  showMax = false,
  onMax,
}: AmountInputProps) {
  return (
    <div className="bg-panel-solid border border-border-soft rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-text-dim">
        <span>{label}</span>
        {showMax && onMax && !disabled && (
          <button
            type="button"
            onClick={onMax}
            className="text-accent hover:text-accent-2 font-medium uppercase tracking-wider text-[10px]"
          >
            Max
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => onAmountChange?.(e.target.value)}
          disabled={disabled}
          className="border-0 bg-transparent text-2xl font-mono p-0 h-auto"
        />
        <TokenSelector
          value={symbol}
          onChange={onSymbolChange}
          {...(disabledSymbol !== undefined ? { disabledSymbol } : {})}
        />
      </div>
    </div>
  );
}
