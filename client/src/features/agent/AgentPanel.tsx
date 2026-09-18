import { CircleAgentChat } from "./CircleAgentChat.tsx";

interface AgentPanelProps {
  onClose: () => void;
  initialMessage?: string;
  /**
   * Task 069 (V-009) — the seed message arrived by voice. Carried so the
   * first turn is sent with its provenance and cannot mint a confirmation.
   */
  initialSpoken?: boolean;
}

/**
 * The agent surface. A thin wrapper over the chat so the route can open it
 * with, or without, an opening message.
 */
export function AgentPanel({ onClose, initialMessage, initialSpoken }: AgentPanelProps) {
  return (
    <CircleAgentChat
      onClose={onClose}
      {...(initialMessage ? { initialMessage } : {})}
      {...(initialSpoken ? { initialSpoken: true } : {})}
    />
  );
}
