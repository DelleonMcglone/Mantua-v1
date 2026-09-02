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

const TONE: Record<IntentConfidence, { border: string; bg: string; head: string; ring: string }> = {
  high: {
    border: "var(--accent)",
    bg: "rgba(139,108,240,0.10)",
    head: "var(--accent)",
    ring: "0 0 0 3px rgba(139,108,240,0.10)",
  },
  low: {
    border: "var(--amber)",
    bg: "rgba(245,165,36,0.10)",
    head: "var(--amber)",
    ring: "0 0 0 3px rgba(245,165,36,0.10)",
  },
  failed: {
    border: "var(--red)",
    bg: "rgba(255,107,107,0.10)",
    head: "var(--red)",
    ring: "0 0 0 3px rgba(255,107,107,0.10)",
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
    <div
      style={{
        border: `1px solid ${tone.border}`,
        borderRadius: 12,
        overflow: "hidden",
        marginTop: 10,
        boxShadow: tone.ring,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background: tone.bg,
          fontSize: 10,
          letterSpacing: ".12em",
          color: tone.head,
          fontFamily: "JetBrains Mono, monospace",
          fontWeight: 600,
          borderBottom: `1px solid ${tone.border}40`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{headline ?? DEFAULT_HEADLINE[confidence]}</span>
        {headlineRight && (
          <span
            style={{
              color: "var(--text-mute)",
              letterSpacing: 0,
              fontWeight: 400,
            }}
          >
            {headlineRight}
          </span>
        )}
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {what}
        </div>
        {rows && rows.length > 0 && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "var(--text-dim)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "4px 14px",
            }}
          >
            {rows.map((row, i) => (
              <div key={i} style={{ display: "contents" }}>
                <span style={{ color: "var(--text-mute)" }}>{row.label}</span>
                <span style={{ textAlign: "right" }}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {actions && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid var(--border-soft)",
            background: "var(--bg-elev)",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
