import { Plus } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  onNewChat?: () => void;
  right?: ReactNode;
}

/**
 * Shared "Ask Mantua" header strip — matches `PanelHeader` in
 * `mantua-ai/project/src/panels.jsx` (used at the top of every right-
 * column panel: Home, PoolList, Swap, AddLiquidity, Analyze, Agent).
 *
 * The right-column Card always renders this strip first, then the
 * panel-specific subheader (e.g. "Swap", "Create Pool"), then the
 * panel body, then the shared `<InputBar />` at the bottom.
 *
 * When `onNewChat` isn't supplied (the default for non-home panels) the
 * button falls back to dispatching the window event `mantua:new-chat`.
 * App.tsx listens for it so the button works without each panel having
 * to thread props.
 */
export function PanelHeader({ onNewChat, right }: Props) {
  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
    } else {
      window.dispatchEvent(new Event("mantua:new-chat"));
    }
  };
  return (
    <div className="flex items-start gap-2.5 px-5 pt-4 pb-3.5 border-b border-border-soft">
      <div className="flex-1 min-w-0">
        <div className="text-[17px] font-semibold -tracking-[0.01em]">Ask Mantua</div>
      </div>
      <div className="flex gap-2">
        {right}
        <button
          type="button"
          onClick={handleNewChat}
          className="px-3 py-1.5 rounded-xs border border-border bg-transparent text-text-dim text-[12px] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
      </div>
    </div>
  );
}
