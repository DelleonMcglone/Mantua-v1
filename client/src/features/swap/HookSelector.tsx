import { useState, useRef, useEffect } from "react";
import { ChevronDown, Shield, Zap, Layers, Check } from "lucide-react";
import { HOOK_OPTIONS, HOOK_META, type HookOption } from "./hook-types.ts";

interface HookSelectorProps {
  value: HookOption;
  onChange: (hook: HookOption) => void;
}

const HOOK_ICONS: Record<HookOption, React.ReactNode> = {
  none: null,
  "stable-protection": <Shield className="h-3.5 w-3.5" />,
  "dynamic-fee": <Zap className="h-3.5 w-3.5" />,
};

export function HookSelector({ value, onChange }: HookSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = HOOK_META[value];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold tracking-[0.12em] text-text-mute uppercase">
        Swap Hook
      </div>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="w-full flex items-center gap-3 bg-bg-elev border border-border-soft rounded-sm px-4 py-3.5 text-left hover:border-text-mute transition-colors"
        >
          <div className="flex-1">
            <div className="text-sm font-semibold">{selected.label}</div>
            <div className="text-xs text-green mt-0.5">{selected.description}</div>
          </div>
          <ChevronDown className="h-4 w-4 text-text-dim" />
        </button>
        {open && (
          <div className="absolute top-full mt-1.5 left-0 right-0 z-20 bg-panel-solid border border-border rounded-sm p-1.5 shadow-2xl max-h-80 overflow-auto">
            {HOOK_OPTIONS.map((opt) => {
              const meta = HOOK_META[opt];
              const isActive = opt === value;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xs text-left transition-colors ${
                    isActive ? "bg-chip" : "hover:bg-row-hover"
                  }`}
                >
                  <div className="w-7 h-7 rounded-xs bg-chip flex items-center justify-center text-green flex-shrink-0">
                    {HOOK_ICONS[opt] ?? <Layers className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">{meta.label}</div>
                    <div className="text-[11px] text-text-dim mt-0.5">{meta.description}</div>
                  </div>
                  {isActive && <Check className="h-3.5 w-3.5 text-green" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
