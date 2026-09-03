import type { ReactNode } from "react";

export type IntentConfidence = "high" | "low" | "failed";

export interface IntentMetaRow {
  label: string;
  value: ReactNode;
}

interface IntentCardProps {
  /** Subject summary line (e.g. "Swap 10 USDC → ETH") with optional
   *  leading icon node. */
  what: ReactNode;
  /** Tone of the parser. Drives border + headline color:
   *  - high   → accent purple (default)
   *  - low    → amber (clarification needed)
   *  - failed → red (parser couldn't map to an action) */
  confidence?: IntentConfidence;
  /** Header label override. Defaults to "INTENT DETECTED" for high,
   *  "DID YOU MEAN?" for low, "COULDN'T PARSE" for failed. */
  headline?: string;
  /** Right-aligned label inside the head row (e.g. "confidence: high"). */
  headlineRight?: ReactNode;
  /** Two-column meta grid (label / value). Renders below `what`. */
  rows?: IntentMetaRow[];
  /** Footer action buttons. Pass two buttons (cancel + primary) to match
   *  the prototype's `flex:1 / flex:2` layout. */
  actions?: ReactNode;
}

/** Token-class tone tables (B-015) — the old hardcoded dark-theme rgba
 *  fills rendered the wrong hue in light mode. */
const TONE: Record<IntentConfidence, { frame: string; head: string }> = {
  high: {
    frame: "border-accent ring-[3px] ring-accent/10",
    head: "bg-accent/10 text-accent border-b border-accent/25",
  },
  low: {
    frame: "border-amber ring-[3px] ring-amber/10",
    head: "bg-amber/10 text-amber border-b border-amber/25",
  },
  failed: {
    frame: "border-red ring-[3px] ring-red/10",
    head: "bg-red/10 text-red border-b border-red/25",
  },
};

const DEFAULT_HEADLINE: Record<IntentConfidence, string> = {
  high: "INTENT DETECTED",
  low: "DID YOU MEAN?",
  failed: "COULDN'T PARSE",
};

/**
 * IntentCard — port of `.intent` from `Mantua Agent Flows.html`. Used by
 * F7 (Autonomous mode parsed step) and reserved for F8 (Command bar
 * parse-preview) in pass 2. Three confidence tones drive border/header
 * color; everything else is content-driven.
 */
export function IntentCard({
  what,
  confidence = "high",
  headline,
  headlineRight,
  rows,
  actions,
}: IntentCardProps) {
  const tone = TONE[confidence];
  return (
    <div className={`mt-2.5 overflow-hidden rounded-md border ${tone.frame}`}>
      <div
        className={`flex items-center justify-between px-3 py-2 font-mono text-[10px] font-semibold tracking-[0.12em] ${tone.head}`}
      >
        <span>{headline ?? DEFAULT_HEADLINE[confidence]}</span>
        {headlineRight && (
          <span className="font-normal tracking-normal text-text-mute">{headlineRight}</span>
        )}
      </div>
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2.5 text-[14px] font-semibold">{what}</div>
        {rows && rows.length > 0 && (
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[11px] text-text-dim">
            {rows.map((row, i) => (
              <div key={i} className="contents">
                <span className="text-text-mute">{row.label}</span>
                <span className="text-right">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex gap-2 border-t border-border-soft bg-bg-elev px-3.5 py-2.5">
          {actions}
        </div>
      )}
    </div>
  );
}
