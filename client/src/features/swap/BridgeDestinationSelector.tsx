import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { BRIDGE_DESTINATIONS, type BridgeDestination } from "@/features/bridge/bridge-chains.ts";
import { TokenIcon } from "./TokenIcon.tsx";

/**
 * Buy-side picker for the Swap panel's Bridge venue — same pill +
 * dropdown pattern as `TokenSelector` (shared Radix primitive), but the
 * choices are "USDC on <chain>" for every CCTP destination the bridge
 * can reach. Bridging is USDC-only and 1:1, so the token never changes;
 * only the destination network does.
 */
export function BridgeDestinationSelector({
  value,
  onChange,
  disabled,
}: {
  value: BridgeDestination;
  onChange: (d: BridgeDestination) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-panel-solid border border-border hover:border-text-mute transition-colors text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <TokenIcon symbol="USDC" size={20} />
          <span>USDC on {value.label}</span>
          <ChevronDown className="h-3 w-3 text-text-mute" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-[210px] max-h-[260px]">
        {BRIDGE_DESTINATIONS.map((d) => (
          <DropdownMenuItem
            key={d.sdkName}
            className={d.sdkName === value.sdkName ? "bg-chip" : ""}
            onSelect={() => {
              onChange(d);
            }}
          >
            <TokenIcon symbol="USDC" size={18} />
            <span className="flex-1">USDC on {d.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
