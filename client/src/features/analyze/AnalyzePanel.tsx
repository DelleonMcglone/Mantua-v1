import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { ApiError, api } from "@/lib/api.ts";
import { Banner } from "@/components/ui/banner.tsx";
import { Spinner } from "@/features/agent/agent-primitives.tsx";
import { UserBubble, RichText, Caret } from "@/features/agent/chat-text.tsx";
import {
  streamAnalyzeChat,
  AnalyzeStreamError,
  type AnalyzeHistoryTurn,
} from "./analyze-stream.ts";
import { resolveAnalyzeQuestion } from "./question-router.ts";

interface AnalyzeMetric {
  label: string;
  value: string;
  hint?: string;
}

interface AnalyzeSource {
  name: string;
  url?: string;
}

interface AnalyzeResponse {
  topic: Topic;
  title: string;
  summary: string;
  metrics?: AnalyzeMetric[];
  bullets?: string[];
  sources?: AnalyzeSource[];
}

type Topic =
  | "eth-price"
  | "cbbtc-price"
  | "eurc-peg"
  | "usdc-eurc-pool"
  | "top-stablecoins"
  | "cbbtc-24h-volume"
  | "usdc-24h-volume"
  | "market-summary"
  | "base-pools"
  | "coinbase-prices"
  | "mantua-hooks"
  | "token-price";

/** Empty-state cards: the top three are stablecoin questions (deterministic
 *  topics), the remaining four are sports questions with no `topic` — they
 *  route through the free-form analyst stream, which reads the live slate. */
const SUGGESTIONS: { topic?: Topic; question: string }[] = [
  { topic: "market-summary", question: "Stablecoin market summary for USDC and EURC" },
  { topic: "eurc-peg", question: "Is EURC holding its peg right now?" },
  { topic: "top-stablecoins", question: "Show me top performing stablecoins" },
  { question: "Analyze today's NFL games and matchups" },
  { question: "Analyze today's WNBA games and matchups" },
  { question: "Which game looks closest today, and where is the value?" },
  { question: "What should a prediction-market bettor watch this week?" },
];

// --- Conversation turn model -------------------------------------------------

interface UserTurn {
  id: string;
  role: "user";
  text: string;
}
/** A deterministic, cited answer from a known analyze topic. */
interface TopicTurn {
  id: string;
  role: "topic";
  topic: string;
  symbol?: string;
  data: AnalyzeResponse | null;
  loading: boolean;
  error: string | null;
}
/** An AI-streamed free-form research answer. */
interface ChatTurn {
  id: string;
  role: "chat";
  text: string;
  streaming: boolean;
  failed?: string;
}
type Turn = UserTurn | TopicTurn | ChatTurn;

let seq = 0;
const nextId = () => `t${String(++seq)}`;

interface AnalyzePanelProps {
  onClose: () => void;
  /** Back affordance — returns to where the user came from (e.g. the home
   *  board after a tap-to-analyze). Falls back to "clear the thread" when
   *  absent. */
  onBack?: () => void;
  /** Skip the suggestions and run this topic immediately (chat input matched a
   *  known topic). */
  initialTopic?: Topic;
  /** Original free-form question — seeds the first turn. */
  initialQuestion?: string;
  /** Token symbol for the `token-price` runner. */
  initialSymbol?: string;
}

/**
 * Analyze & Research — a conversational, inline research thread. Each
 * suggestion-card click or typed question appends a turn:
 *   - questions that map to a known topic are answered by the fast, cited
 *     deterministic `/api/analyze` runner (rendered as a structured card)
 *   - anything else streams from the read-only AI analyst (`/api/analyze/chat`)
 *
 * Input comes from the global `<InputBar />`: while this panel is open, App.tsx
 * forwards submissions here via the `mantua:analyze-input` event (so the thread
 * persists instead of remounting per query).
 */
export function AnalyzePanel({
  onClose,
  onBack,
  initialTopic,
  initialQuestion,
  initialSymbol,
}: AnalyzePanelProps) {
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

  // Deterministic topic fetch for a given turn id.
  const fetchTopic = useCallback(
    (id: string, topic: string, symbol?: string) => {
      patch(id, (m) => (m.role === "topic" ? { ...m, loading: true, error: null, data: null } : m));
      const params = new URLSearchParams({ topic });
      if (symbol) params.set("symbol", symbol);
      api
        .get<AnalyzeResponse>(`/api/analyze?${params.toString()}`)
        .then((res) => {
          patch(id, (m) => (m.role === "topic" ? { ...m, data: res, loading: false } : m));
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Unknown error";
          patch(id, (m) => (m.role === "topic" ? { ...m, error: msg, loading: false } : m));
        });
    },
    [patch],
  );

  // Append a user turn + a deterministic topic turn, then fetch it.
  const seedTopic = useCallback(
    (topic: string, question: string, symbol?: string) => {
      const userTurn: UserTurn = { id: nextId(), role: "user", text: question };
      const turnId = nextId();
      const topicTurn: TopicTurn = {
        id: turnId,
        role: "topic",
        topic,
        ...(symbol ? { symbol } : {}),
        data: null,
        loading: true,
        error: null,
      };
      setMessages((prev) => [...prev, userTurn, topicTurn]);
      fetchTopic(turnId, topic, symbol);
    },
    [fetchTopic],
  );

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
              patch(id, (m) => (m.role === "chat" ? { ...m, text: m.text + ev.delta } : m));
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
      else if (m.role === "topic" && m.data)
        out.push({ role: "assistant", text: `${m.data.title}: ${m.data.summary}` });
      else if (m.role === "chat" && m.text) out.push({ role: "assistant", text: m.text });
    }
    return out;
  }, []);

  const ask = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;

      const resolved = resolveAnalyzeQuestion(text);
      if (resolved) {
        seedTopic(resolved.topic, text, resolved.symbol);
        busyRef.current = false; // deterministic fetch manages its own turn
        return;
      }

      const history = buildHistory();
      const userTurn: UserTurn = { id: nextId(), role: "user", text };
      const turnId = nextId();
      const chatTurn: ChatTurn = { id: turnId, role: "chat", text: "", streaming: true };
      setMessages((prev) => [...prev, userTurn, chatTurn]);
      void streamChat(turnId, text, history).finally(() => {
        busyRef.current = false;
      });
    },
    [buildHistory, seedTopic, streamChat],
  );

  // Suggestion card → deterministic topic turn when the card names a topic,
  // otherwise the free-form analyst stream (the sports cards).
  const runSuggestion = useCallback(
    (s: { topic?: Topic; question: string }) => {
      if (busyRef.current) return;
      if (s.topic) seedTopic(s.topic, s.question);
      else ask(s.question);
    },
    [seedTopic, ask],
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

  // Seed the first turn once from the route props. `seedTopic`/`ask` own their
  // own setState (not called lexically here), so the thread stays lint-clean.
  const seededRef = useRef(false);
  const seedTopicRef = useRef(seedTopic);
  useEffect(() => {
    seedTopicRef.current = seedTopic;
  }, [seedTopic]);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (initialTopic) {
      const question =
        initialQuestion ?? SUGGESTIONS.find((s) => s.topic === initialTopic)?.question ?? "Analyze";
      seedTopicRef.current(initialTopic, question, initialSymbol);
    } else if (initialQuestion) {
      askRef.current(initialQuestion);
    }
  }, [initialTopic, initialQuestion, initialSymbol]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    busyRef.current = false;
    setMessages([]);
  }, []);

  return (
    <>
      <PanelHeader onNewChat={newChat} />
      <PanelSubHeader
        title="Analyze & Research"
        subtitle="Ask about prices, pegs, pools, or anything markets — pick a suggestion or type."
        {...(onBack ? { onBack } : messages.length > 0 ? { onBack: newChat } : {})}
        onClose={onClose}
      />

      <div className="px-5 py-3.5 flex-1 overflow-auto flex flex-col gap-3.5">
        {messages.length === 0 ? (
          <EmptyState onPick={runSuggestion} />
        ) : (
          messages.map((m) => <TurnView key={m.id} turn={m} onRetry={fetchTopic} />)
        )}
        <div ref={endRef} />
      </div>
    </>
  );
}

function EmptyState({ onPick }: { onPick: (s: { topic?: Topic; question: string }) => void }) {
  return (
    <>
      <div className="text-[11px] text-text-mute tracking-[0.08em] mb-1 font-semibold">
        SUGGESTED QUESTIONS
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.question}
            type="button"
            onClick={() => {
              onPick(s);
            }}
            className="flex items-center px-3.5 py-3.5 bg-bg-elev border border-border-soft rounded-md cursor-pointer text-left text-[13px] leading-snug font-medium min-h-[56px] hover:border-accent transition-colors"
          >
            {s.question}
          </button>
        ))}
      </div>
    </>
  );
}

function TurnView({
  turn,
  onRetry,
}: {
  turn: Turn;
  onRetry: (id: string, topic: string, symbol?: string) => void;
}) {
  if (turn.role === "user") return <UserBubble text={turn.text} />;
  if (turn.role === "chat") {
    const thinking = turn.streaming && turn.text === "";
    return (
      <div className="self-stretch flex flex-col gap-2.5">
        {thinking && (
          <div className="flex items-center gap-2">
            <Spinner agent />
            <span className="text-[13px] text-text-dim">Researching…</span>
          </div>
        )}
        {turn.text && (
          <div
            className="text-[13px] text-text leading-relaxed"
            style={{ whiteSpace: "pre-wrap", maxWidth: "92%" }}
          >
            <RichText text={turn.text} />
            {turn.streaming && <Caret />}
          </div>
        )}
        {turn.failed && (
          <Banner tone="error" icon="⊘" title="Something went wrong">
            {turn.failed}
          </Banner>
        )}
      </div>
    );
  }
  // topic turn
  return (
    <div className="self-stretch">
      <ResultBody
        data={turn.data}
        loading={turn.loading}
        error={turn.error}
        onRetry={() => {
          onRetry(turn.id, turn.topic, turn.symbol);
        }}
      />
    </div>
  );
}

function ResultBody({
  data,
  loading,
  error,
  onRetry,
}: {
  data: AnalyzeResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="bg-bg-elev border border-border-soft rounded-md p-5 text-[13px] text-text-dim">
        Pulling live data…
      </div>
    );
  }
  if (error) {
    const isRateLimit = /429|rate.?limit/i.test(error);
    return (
      <div className="bg-bg-elev border border-red/40 rounded-md p-5 text-[13px] text-red space-y-2">
        <div>{error}</div>
        {isRateLimit && (
          <div className="text-text-dim text-[12px]">
            CoinGecko's free tier rate-limits aggressive callers. The server caches successful
            responses for 5 minutes; one successful fetch will be served from cache for everyone
            after that.
          </div>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 rounded-xs border border-red/40 bg-transparent text-red text-[12px] cursor-pointer hover:bg-red/10 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="bg-bg-elev border border-border-soft rounded-md p-5">
        <div className="font-semibold text-text text-[15px] mb-2">{data.title}</div>
        <p className="text-[13px] text-text leading-relaxed">{data.summary}</p>
      </div>

      {data.metrics && data.metrics.length > 0 && (
        <div className="bg-bg-elev border border-border-soft rounded-md p-5">
          <div className="text-[10px] text-text-mute tracking-[0.08em] font-semibold mb-3">
            METRICS
          </div>
          <dl className="grid grid-cols-1 gap-y-2.5">
            {data.metrics.map((m, i) => (
              <div
                key={`${m.label}-${String(i)}`}
                className="flex items-center justify-between text-[13px]"
              >
                <dt className="text-text-dim">{m.label}</dt>
                <dd className="font-mono text-text">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {data.bullets && data.bullets.length > 0 && (
        <div className="bg-bg-elev border border-border-soft rounded-md p-5">
          <ul className="space-y-2 text-[13px] text-text leading-relaxed list-disc list-outside pl-4 marker:text-text-mute">
            {data.bullets.map((b, i) => (
              <li key={String(i)}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {data.sources && data.sources.length > 0 && (
        <div className="text-[11px] text-text-mute">
          Sources:{" "}
          {data.sources.map((s, i, arr) => (
            <span key={`${s.name}-${String(i)}`}>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-dim hover:text-accent inline-flex items-center gap-0.5"
                >
                  {s.name} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : (
                <span>{s.name}</span>
              )}
              {i < arr.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
