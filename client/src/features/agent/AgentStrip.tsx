import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

interface AgentStripProps {
  /** Top line — "Agent wallet" / "From agent wallet" / "Sending to" / etc. */
  label: string;
  /** Bottom line — truncated address or context string. Pass a ReactNode
   *  if you need an explorer link inside it. */
  addr: ReactNode;
  /** Right-side cap pill. Tone shifts the colors:
   *  - default → chip background, dim text ("$32 / $100 today")
   *  - green   → "$68 left" or "$132 / $100 today" (cap reset bonus)
   *  - red     → "$0 left" / cap-exceeded warning
   *  Omit entirely to render no pill. */
  cap?: { text: string; tone?: "default" | "green" | "red" };
}

const CAP_TONES: Record<NonNullable<AgentStripProps["cap"]>["tone"] & string, string> = {
  default: "bg-chip border-border-soft text-text-dim",
  green: "bg-green/10 border-green/35 text-green",
  red: "bg-red/10 border-red/35 text-red",
};

/**
 * AgentStrip — port of `.agent-strip` from `mantua-ai/project/Mantua
 * Agent Flows.html`, rewritten on the token layer (B-015) so the cap
 * pill renders correct hues in both themes. Sits at the top of every
 * agent-scoped panel so the agent's identity (wallet address + remaining
 * daily cap) is visible on every step.
 */
export function AgentStrip({ label, addr, cap }: AgentStripProps) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border-soft bg-transparent px-3.5 py-2.5">
      <div>
        <div className="text-[11px] text-text-dim">{label}</div>
        <div className="mono text-[11px] text-text">{addr}</div>
      </div>
      {cap && (
        <div
          className={cn(
            "ml-auto rounded-[6px] border px-[7px] py-[3px] font-mono text-[10px]",
            CAP_TONES[cap.tone ?? "default"],
          )}
        >
          {cap.text}
        </div>
      )}
    </div>
  );
}
