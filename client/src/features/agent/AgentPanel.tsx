import { CircleAgentChat } from "./CircleAgentChat.tsx";

interface AgentPanelProps {
  onClose: () => void;
  /** Command typed from another panel — auto-sent once when the agent opens. */
  initialMessage?: string;
}

/**
 * Agent panel entry point — "Your Circle Agent", a free-form conversational
 * surface. The user types in the global bar; each turn streams from
 * `/api/agent/chat`, with the agent executing tools (swap / send / data /
 * portfolio) on its Circle wallet on Base. No forms; money-moving actions are
 * previewed and run only after the user's explicit "confirm" (D-114).
 */
export function AgentPanel({ onClose, initialMessage }: AgentPanelProps) {
  return <CircleAgentChat onClose={onClose} {...(initialMessage ? { initialMessage } : {})} />;
}
