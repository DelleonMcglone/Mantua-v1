import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { SourcePill } from "@/features/agent/SourcePill.tsx";
import { appendStep, appendText, type MessagePart } from "@/features/agent/message-parts.ts";
import {
  needsInput,
  promptText,
  STARTER_PROMPTS,
  STARTER_PROMPTS_TITLE,
} from "./starter-prompts.ts";
import { Banner } from "@/components/ui/banner.tsx";
import { Spinner } from "@/features/agent/agent-primitives.tsx";
import { UserBubble, RichText, Caret } from "@/features/agent/chat-text.tsx";
import {
  streamAnalyzeChat,
  AnalyzeStreamError,
  type AnalyzeHistoryTurn,
} from "./analyze-stream.ts";
import { PredictionNote } from "@/features/markets/PredictionNote.tsx";

/** Empty-state cards: NFL questions that route through the free-form
 *  analyst stream, which reads the live canonical slate. */

// --- Conversation turn model -------------------------------------------------

interface UserTurn {
  id: string;
  role: "user";
  text: string;
}
/** An AI-streamed free-form research answer. */
interface ChatStep {
  id: string;
  tool: string;
  status: "running" | "ok" | "error";
  data?: unknown;
}
interface ChatTurn {
  id: string;
  role: "chat";
  text: string;
  /** Text and data reads in arrival order; reads render as source pills. */
  parts: MessagePart[];
  steps: ChatStep[];
  streaming: boolean;
  failed?: string;
}
type Turn = UserTurn | ChatTurn;

let seq = 0;
const nextId = () => `t${String(++seq)}`;

interface AnalyzePanelProps {
  onClose: () => void;
  /** Back affordance — returns to where the user came from (e.g. the home
   *  board after a tap-to-analyze). Falls back to "clear the thread" when
   *  absent. */
  onBack?: () => void;
  /** Original free-form question — seeds the first turn. */
  initialQuestion?: string;
}

/**
 * Analyze & Research — a conversational, inline research thread. Each
 * suggestion-card click or typed question appends a turn that streams from
 * the read-only AI analyst (`/api/analyze/chat`).
 *
 * Input comes from the global `<InputBar />`: while this panel is open, App.tsx
 * forwards submissions here via the `mantua:analyze-input` event (so the thread
 * persists instead of remounting per query).
 */
export function AnalyzePanel({ onClose, onBack, initialQuestion }: AnalyzePanelProps) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<Turn[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const patch = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  // AI research stream for a free-form question.
  const streamChat = useCallback(
    async (id: string, question: string, history: AnalyzeHistoryTurn[]) => {
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await streamAnalyzeChat(
          { message: question, history },
          (ev) => {
            if (ev.type === "text") {
              patch(id, (m) =>
                m.role === "chat"
                  ? { ...m, text: m.text + ev.delta, parts: appendText(m.parts, ev.delta) }
                  : m,
              );
            } else if (ev.type === "tool_start") {
              patch(id, (m) =>
                m.role === "chat"
                  ? {
                      ...m,
                      parts: appendStep(m.parts, ev.id),
                      steps: [...m.steps, { id: ev.id, tool: ev.tool, status: "running" }],
                    }
                  : m,
              );
            } else if (ev.type === "tool_result") {
              patch(id, (m) =>
                m.role === "chat"
                  ? {
                      ...m,
                      steps: m.steps.map((st) =>
                        st.id === ev.id
                          ? { ...st, status: ev.ok ? "ok" : "error", data: ev.data }
                          : st,
                      ),
                    }
                  : m,
              );
            } else if (ev.type === "error") {
              patch(id, (m) => (m.role === "chat" ? { ...m, failed: ev.message } : m));
            }
          },
          ac.signal,
        );
        patch(id, (m) => (m.role === "chat" ? { ...m, streaming: false } : m));
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg =
          err instanceof AnalyzeStreamError
            ? err.status === 503
              ? "Research is unavailable right now."
              : err.message
            : "The analyst hit an unexpected error.";
        // Free-quota exhausted (owner's 3-free-questions funnel): surface
        // the message AND open the login modal in the same beat.
        if (err instanceof AnalyzeStreamError && err.status === 401) {
          window.dispatchEvent(new Event("mantua:open-login"));
        }
        patch(id, (m) => (m.role === "chat" ? { ...m, streaming: false, failed: msg } : m));
      }
    },
    [patch],
  );

  // Plain-text history of prior turns, for AI context.
  const buildHistory = useCallback((): AnalyzeHistoryTurn[] => {
    const out: AnalyzeHistoryTurn[] = [];
    for (const m of messagesRef.current) {
      if (m.role === "user") out.push({ role: "user", text: m.text });
      else if (m.text) out.push({ role: "assistant", text: m.text });
    }
    return out;
  }, []);

  const ask = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;

      const history = buildHistory();
      const userTurn: UserTurn = { id: nextId(), role: "user", text };
      const turnId = nextId();
      const chatTurn: ChatTurn = {
        id: turnId,
        role: "chat",
        text: "",
        parts: [],
        steps: [],
        streaming: true,
      };
      setMessages((prev) => [...prev, userTurn, chatTurn]);
      void streamChat(turnId, text, history).finally(() => {
        busyRef.current = false;
      });
    },
    [buildHistory, streamChat],
  );

  // Listen for input forwarded from the global InputBar (App.tsx).
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);
  useEffect(() => {
    const onInput = (e: Event) => {
      askRef.current((e as CustomEvent<string>).detail);
    };
    window.addEventListener("mantua:analyze-input", onInput);
    return () => {
      window.removeEventListener("mantua:analyze-input", onInput);
    };
  }, []);

  // Seed the first turn once from the route props. `ask` owns its own
  // setState (not called lexically here), so the thread stays lint-clean.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (initialQuestion) askRef.current(initialQuestion);
  }, [initialQuestion]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    busyRef.current = false;
    setMessages([]);
  }, []);

  return (
    <>
      <PanelHeader onNewChat={newChat} />
      <PanelSubHeader
        title={STARTER_PROMPTS_TITLE}
        subtitle="Five prompts that take you from finding an opportunity to a managed position. Pick one, or ask anything."
        {...(onBack ? { onBack } : messages.length > 0 ? { onBack: newChat } : {})}
        onClose={onClose}
      />

      <div className="px-5 py-3.5 flex-1 overflow-auto flex flex-col gap-3.5">
        {messages.length === 0 ? (
          <EmptyState
            onSend={(text) => {
              ask(text);
            }}
          />
        ) : (
          messages.map((m) => <TurnView key={m.id} turn={m} />)
        )}
        <div ref={endRef} />
      </div>
    </>
  );
}

/**
 * The five starter cards. A prompt the user must complete (a game or team)
 * is placed in the dock to edit; the rest are sent as they are.
 */
function EmptyState({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      {STARTER_PROMPTS.map((p) => {
        const edit = needsInput(p);
        return (
          <button
            key={p.step}
            type="button"
            data-testid="starter-prompt"
            onClick={() => {
              if (edit) {
                window.dispatchEvent(
                  new CustomEvent("mantua:dock-prefill", { detail: promptText(p) }),
                );
              } else {
                onSend(promptText(p));
              }
            }}
            className="flex flex-col gap-1 px-3.5 py-3 bg-bg-elev border border-border-soft rounded-md cursor-pointer text-left hover:border-accent transition-colors"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-mute">
              Prompt {p.step} · {p.title}
            </span>
            <span className="text-[13px] font-medium leading-snug">{p.headline}</span>
            {edit && (
              <span className="text-[11px] text-text-dim">Fill in the blank, then send.</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") return <UserBubble text={turn.text} />;
  const thinking = turn.streaming && turn.text === "";
  return (
    <div className="self-stretch flex flex-col gap-2.5">
      {thinking && (
        <div className="flex items-center gap-2">
          <Spinner agent />
          <span className="text-[13px] text-text-dim">Researching…</span>
        </div>
      )}
      {turn.parts.map((part, i) => {
        if (part.kind === "step") {
          const step = turn.steps.find((st) => st.id === part.id);
          return step ? (
            <SourcePill key={part.id} tool={step.tool} status={step.status} data={step.data} />
          ) : null;
        }
        const last = i === turn.parts.length - 1;
        return (
          <div
            key={`text-${String(i)}`}
            className="text-[13px] text-text leading-relaxed"
            style={{ whiteSpace: "pre-wrap", maxWidth: "92%" }}
          >
            <RichText text={part.text} />
            {turn.streaming && last && <Caret />}
          </div>
        );
      })}
      {turn.failed && (
        <Banner tone="error" icon="⊘" title="Something went wrong">
          {turn.failed}
        </Banner>
      )}
      {/* T-022: an analysis is a view, never a promise. */}
      {!turn.streaming && turn.text && <PredictionNote />}
    </div>
  );
}
