import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  onClose?: () => void;
  right?: ReactNode;
}

/**
 * Panel-specific subheader rendered just under the shared
 * `<PanelHeader />`. Matches the design's per-panel title row
 * (e.g. "Swap" + close X, "Create Pool" + subtitle + close X,
 * "Research — ETH" + close X).
 */
export function PanelSubHeader({ title, subtitle, onBack, onClose, right }: Props) {
  return (
    <div className="px-5 pt-4 pb-3.5">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="mt-0.5 h-7 w-7 inline-flex items-center justify-center rounded-xs border border-border-soft bg-transparent text-text-dim hover:text-text"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="min-w-0">
            <div className="text-[18px] font-semibold">{title}</div>
            {subtitle && <div className="text-[13px] text-text-dim mt-0.5">{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {right}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="h-7 w-7 inline-flex items-center justify-center rounded-xs border border-border-soft bg-transparent text-text-dim hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
