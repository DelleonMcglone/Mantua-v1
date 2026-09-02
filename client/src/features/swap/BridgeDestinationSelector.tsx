import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BRIDGE_DESTINATIONS, type BridgeDestination } from "@/features/bridge/bridge-chains.ts";
import { TokenIcon } from "./TokenIcon.tsx";

/**
 * Buy-side picker for the Swap panel's Bridge venue — same pill + popover
 * pattern as `TokenSelector`, but the choices are "USDC on <chain>" for
 * every CCTP destination the bridge can reach. Bridging is USDC-only and
 * 1:1, so the token never changes; only the destination network does.
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-panel-solid border border-border hover:border-text-mute transition-colors text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        <TokenIcon symbol="USDC" size={20} />
        <span>USDC on {value.label}</span>
        <ChevronDown className="h-3 w-3 text-text-mute" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[210px] max-h-[260px] overflow-auto bg-panel-solid border border-border rounded-md p-1 shadow-xl">
          {BRIDGE_DESTINATIONS.map((d) => (
            <button
              key={d.sdkName}
              type="button"
              onClick={() => {
                onChange(d);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-xs text-left text-[13px] hover:bg-row-hover cursor-pointer ${
                d.sdkName === value.sdkName ? "bg-chip" : ""
              }`}
            >
              <TokenIcon symbol="USDC" size={18} />
              <span className="flex-1">USDC on {d.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
