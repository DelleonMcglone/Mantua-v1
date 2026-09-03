import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { getTokens, getUserFacingTokenSymbols, type TokenSymbol } from "@/lib/tokens.ts";
import { TokenIcon } from "./TokenIcon.tsx";

interface TokenSelectorProps {
  value: TokenSymbol;
  onChange: (s: TokenSymbol) => void;
  disabledSymbol?: TokenSymbol;
}

/**
 * Pill-style token picker — matches the design's `TokenPicker`
 * (panels_more.jsx:307). Built on the shared Radix dropdown primitive
 * (menu roles, arrow-key nav, focus return) with each user-facing token
 * for the *current* chain (Base). WETH is hidden; routing wraps ETH
 * internally.
 */
export function TokenSelector({ value, onChange, disabledSymbol }: TokenSelectorProps) {
  const chainId = BASE_CHAIN_ID;
  const symbols = useMemo(() => getUserFacingTokenSymbols(chainId), [chainId]);
  const tokens = useMemo(() => getTokens(chainId), [chainId]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-panel-solid border border-border hover:border-text-mute transition-colors text-[14px] font-medium cursor-pointer"
        >
          <TokenIcon symbol={value} size={20} />
          <span>{value}</span>
          <ChevronDown className="h-3 w-3 text-text-mute" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-[160px]">
        {symbols.map((sym) => {
          const tk = tokens[sym];
          return (
            <DropdownMenuItem
              key={sym}
              disabled={sym === disabledSymbol}
              className={sym === value ? "bg-chip" : ""}
              onSelect={() => {
                onChange(sym);
              }}
            >
              <TokenIcon symbol={sym} size={18} />
              <span className="flex-1">{tk.symbol}</span>
              {tk.native && <span className="text-[10px] text-text-mute uppercase">Native</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
