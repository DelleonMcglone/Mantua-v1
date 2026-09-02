import type { ReactNode } from "react";

interface AgentStripProps {
  /** Top line — "Agent wallet" / "From agent wallet" / "Sending to" / etc. */
  label: string;
  /** Bottom line — truncated address or context string. Pass a ReactNode
   *  if you need an BaseScan link inside it. */
  addr: ReactNode;
  /** Right-side cap pill. Tone shifts the colors:
   *  - default → chip background, dim text ("$32 / $100 today")
   *  - green   → "$68 left" or "$132 / $100 today" (cap reset bonus)
   *  - red     → "$0 left" / cap-exceeded warning
   *  Omit entirely to render no pill. */
  cap?: { text: string; tone?: "default" | "green" | "red" };
}

const STRIP_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderBottom: "1px solid var(--border-soft)",
  background: "transparent",
};

const CAP_BASE: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 10,
  fontFamily: "JetBrains Mono, monospace",
  padding: "3px 7px",
  borderRadius: 6,
};

const CAP_TONES: Record<NonNullable<AgentStripProps["cap"]>["tone"] & string, React.CSSProperties> =
  {
    default: {
      background: "var(--chip)",
      border: "1px solid var(--border-soft)",
      color: "var(--text-dim)",
    },
    green: {
      background: "rgba(61,220,151,.10)",
      border: "1px solid rgba(61,220,151,.35)",
      color: "var(--green)",
    },
    red: {
      background: "rgba(255,107,107,.10)",
      border: "1px solid rgba(255,107,107,.35)",
      color: "var(--red)",
    },
  };

/**
 * AgentStrip — pixel port of `.agent-strip` from
 * `mantua-ai/project/Mantua Agent Flows.html`. Sits at the top of every
 * agent-scoped panel so the agent's identity (wallet address + remaining
 * daily cap) is visible on every step.
 */
export function AgentStrip({ label, addr, cap }: AgentStripProps) {
  return (
    <div style={STRIP_STYLE}>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text)" }}>
          {addr}
        </div>
      </div>
      {cap && <div style={{ ...CAP_BASE, ...CAP_TONES[cap.tone ?? "default"] }}>{cap.text}</div>}
    </div>
  );
}
