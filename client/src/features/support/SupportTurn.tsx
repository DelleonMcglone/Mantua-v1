import { Banner } from "@/components/ui/banner.tsx";
import { Caret, RichText, UserBubble } from "@/features/agent/chat-text.tsx";
import { Spinner } from "@/features/agent/agent-primitives.tsx";

/**
 * Task 070 / AE-007, AE-010 — one turn of the support conversation: the
 * user's bubble, or the assistant's streamed text with its ticket banner
 * when the agent handed off to a person.
 */

export interface SupportTurnData {
  id: number;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  failed?: string;
  ticketId?: string;
}

export function SupportTurn({ turn }: { turn: SupportTurnData }) {
  if (turn.role === "user") return <UserBubble text={turn.text} />;
  return (
    <div className="flex flex-col gap-2">
      {turn.streaming && turn.text === "" && (
        <div className="flex items-center gap-2">
          <Spinner agent />
          <span className="text-[13px] text-text-dim">Looking into it…</span>
        </div>
      )}
      {turn.text && (
        <div className="text-[13px] leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>
          <RichText text={turn.text} />
          {turn.streaming && <Caret />}
        </div>
      )}
      {turn.ticketId && (
        <Banner tone="info" icon="✉" title="Handed to a person">
          Ticket {turn.ticketId}. Keep this id for follow-up.
        </Banner>
      )}
      {turn.failed && (
        <Banner tone="error" icon="⊘" title="Something went wrong">
          {turn.failed}
        </Banner>
      )}
    </div>
  );
}
