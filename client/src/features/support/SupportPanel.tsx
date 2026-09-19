import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { ChatStreamError } from "@/lib/chat-stream.ts";
import { streamSupportChat, type SupportHistoryTurn } from "./support-stream.ts";
import { SupportTurn, type SupportTurnData } from "./SupportTurn.tsx";

/**
 * Task 070 / AE-007 … AE-010 — the help surface. A conversation with the
 * read-only support agent: general help signed out, account-aware help
 * signed in, deterministic troubleshooting, and a ticket id when the
 * agent hands off to a person. Owns its own input so it works from any
 * route without the command bar.
 */

type Turn = SupportTurnData;

const SUGGESTIONS = [
  "How do markets and YES/NO prices work?",
  "Where is my deposit?",
  "My trade is stuck pending",
  "How does confirming an agent trade work?",
];

export function SupportPanel({ onClose }: { onClose?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const patch = useCallback((id: number, fn: (t: Turn) => Turn) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setBusy(true);
      const history: SupportHistoryTurn[] = turns
        .filter((t) => t.text.length > 0)
        .map((t) => ({ role: t.role, text: t.text }));
      const userId = ++idRef.current;
      const replyId = ++idRef.current;
      setTurns((prev) => [
        ...prev,
        { id: userId, role: "user", text },
        { id: replyId, role: "assistant", text: "", streaming: true },
      ]);
      setDraft("");
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await streamSupportChat(
          { message: text, history },
          (ev) => {
            if (ev.type === "text") patch(replyId, (t) => ({ ...t, text: t.text + ev.delta }));
            else if (ev.type === "error") patch(replyId, (t) => ({ ...t, failed: ev.message }));
            else if (ev.type === "tool_result" && ev.tool === "escalate_to_human" && ev.ok) {
              const ticketId = (ev.data as { ticketId?: string }).ticketId;
              if (ticketId) patch(replyId, (t) => ({ ...t, ticketId }));
            }
          },
          ac.signal,
        );
        patch(replyId, (t) => ({ ...t, streaming: false }));
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg =
          err instanceof ChatStreamError
            ? err.status === 503
              ? "Support chat is unavailable right now."
              : err.message
            : "Support hit an unexpected error.";
        patch(replyId, (t) => ({ ...t, streaming: false, failed: msg }));
      } finally {
        setBusy(false);
      }
    },
    [busy, patch, turns],
  );

  return (
    <>
      <PanelHeader
        onNewChat={() => {
          abortRef.current?.abort();
          setTurns([]);
          setBusy(false);
        }}
      />
      <PanelSubHeader
        title="Help & support"
        subtitle="How markets work, your deposits and positions, troubleshooting — or a person."
        {...(onClose ? { onClose } : {})}
      />
      <div className="px-5 py-3.5 flex-1 overflow-auto flex flex-col gap-3.5">
        {turns.length === 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="px-3.5 py-3.5 bg-bg-elev border border-border-soft rounded-md text-left text-[13px] font-medium hover:border-accent transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t) => (
          <SupportTurn key={t.id} turn={t} />
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-border-soft px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          placeholder="Ask a question or describe the problem"
          aria-label="Support message"
          maxLength={2000}
        />
        <Button type="submit" size="sm" disabled={busy || draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </>
  );
}
