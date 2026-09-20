import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, Bot, Check, ExternalLink, X } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { Banner } from "@/components/ui/banner.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";
import { Button } from "@/components/ui/button.tsx";
import { useAgentPortfolio } from "./use-agent-portfolio.ts";
import { AgentWalletStrip, shortAddr } from "./agent-gate.tsx";
import { DetailRows, Spinner, TxRow } from "./agent-primitives.tsx";
import { streamAgentChat, AgentStreamError, type AgentChatEvent } from "./agent-stream.ts";
import { UserBubble, RichText, Caret } from "./chat-text.tsx";
import { PredictionNote } from "@/features/markets/PredictionNote.tsx";
import { AGENT_INPUT_EVENT, readAgentInput, sourceOf } from "@/features/voice/spoken-command.ts";
import {
  analysisCard,
  dailyBriefCard,
  simulationCard,
  type AnalysisResult,
  type DailyBriefResult,
  type SimulationResult,
} from "./agent-cards.ts";

/**
 * Phase 8 / A-043 — cards that offer the user an action (the preview's
 * Confirm button) send through the same path as typing: the user's own
 * message "confirm" is the only thing the server accepts as consent.
 */
const AgentActionsContext = createContext<{ send: (text: string) => void; busy: boolean }>({
  send: () => undefined,
  busy: false,
});

/**
 * "Your Sports Agent" — a free-form conversational agent on a Circle wallet.
 *
 * The user types in the global "Ask Mantua" bar (App.tsx forwards it via the
 * `mantua:agent-input` event). Each turn streams from `POST /api/agent/chat`:
 * assistant text tokens arrive live, and tool steps (swap / send / portfolio /
 * market data) render as result cards as the server executes them on the
 * Circle wallet. There are no forms: reads run as the agent goes, and every
 * money-moving action is previewed in the chat and executed only after the
 * user replies "confirm" (Phase 8 execution gate, D-114).
 *
 * Task 069 (V-009): a message that arrived by microphone is sent with
 * `source: "voice"`, and the server then refuses to mint a confirmation
 * from that turn. Speech can ask for anything and preview anything; only a
 * press can be the last step before money moves.
 */

interface Props {
  onClose: () => void;
  /** Command forwarded from another panel — auto-sent once on mount. */
  initialMessage?: string;
  /** Task 069 (V-009) — that command was spoken, not typed. */
  initialSpoken?: boolean;
}

interface ToolStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  data?: unknown;
  error?: string;
}

interface UserMsg {
  id: string;
  role: "user";
  text: string;
}
interface AssistantMsg {
  id: string;
  role: "assistant";
  text: string;
  steps: ToolStep[];
  streaming: boolean;
  failed?: string;
}
type Msg = UserMsg | AssistantMsg;

/**
 * Empty-state chips. `message` is what actually gets sent when the chip is
 * clicked. Every chip is something the agent does for an NFL prediction
 * market: the wallet, the brief, today's markets, a recommendation, the
 * user's positions, and a hedge review. Nothing here moves money without
 * the preview → "confirm" protocol on the server.
 */
const SUGGESTIONS: { label: string; message: string }[] = [
  { label: "Create / Manage Agent", message: "Create and manage agent wallet" },
  {
    label: "Daily Brief",
    message:
      "Give me my daily briefing: my agent wallet, open positions and P&L, and today's NFL " +
      "slate with anything worth trading. Keep it tight — headline numbers and takeaways, " +
      "not a play-by-play.",
  },
  { label: "Today's NFL markets", message: "Show me today's NFL markets with live prices." },
  {
    label: "Recommend a bet",
    message: "Evaluate today's NFL matchups and recommend a bet, with the evidence and risks.",
  },
  { label: "My positions", message: "Show my open positions and P&L." },
  {
    label: "Hedge my exposure",
    message: "Review my open positions and suggest a hedge — preview it first.",
  },
];

const TOOL_VERB: Record<string, string> = {
  get_portfolio: "Reading portfolio",
  manage_wallet: "Checking wallet",
  get_swap_quote: "Fetching a quote",
  swap: "Executing swap",
  send: "Sending tokens",
  get_market_data: "Pulling market data",
  get_sports_slate: "Reading today's games",
  mantua_search_markets: "Finding markets",
  mantua_get_market: "Reading the market",
  mantua_analyze_market: "Analyzing the matchup",
  mantua_simulate_trade: "Simulating the trade",
  mantua_preview_action: "Preparing the preview",
  mantua_execute_trade: "Placing the trade",
  mantua_sell_position: "Selling the position",
  mantua_get_position: "Reading the position",
  mantua_get_portfolio: "Reading the portfolio",
  mantua_get_performance: "Reading the track record",
  mantua_daily_brief: "Assembling the brief",
  mantua_get_policy: "Reading your policy",
};

let seq = 0;
const uid = () => {
  seq += 1;
  return `m${String(seq)}`;
};

export function CircleAgentChat({ onClose, initialMessage, initialSpoken }: Props) {
  const agent = useAgentPortfolio();
  const chainId = BASE_CHAIN_ID;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const patchAssistant = useCallback((id: string, fn: (m: AssistantMsg) => AssistantMsg) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.role === "assistant" ? fn(m) : m)));
  }, []);

  const send = useCallback(
    (raw: string, spoken = false) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;

      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", text },
        { id: assistantId, role: "assistant", text: "", steps: [], streaming: true },
      ]);
      setBusy(true);
      busyRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      const onEvent = (ev: AgentChatEvent) => {
        switch (ev.type) {
          case "session":
            sessionIdRef.current = ev.sessionId;
            break;
          case "text":
            patchAssistant(assistantId, (m) => ({ ...m, text: m.text + ev.delta }));
            break;
          case "tool_start":
            patchAssistant(assistantId, (m) => ({
              ...m,
              steps: [...m.steps, { id: ev.id, tool: ev.tool, args: ev.args, status: "running" }],
            }));
            break;
          case "tool_result":
            patchAssistant(assistantId, (m) => ({
              ...m,
              steps: m.steps.map((s) =>
                s.id === ev.id
                  ? {
                      ...s,
                      status: ev.ok ? "ok" : "error",
                      ...(ev.data !== undefined ? { data: ev.data } : {}),
                      ...(ev.error !== undefined ? { error: ev.error } : {}),
                    }
                  : s,
              ),
            }));
            break;
          case "error":
            patchAssistant(assistantId, (m) => ({ ...m, failed: ev.message }));
            break;
          case "done":
            break;
        }
      };

      streamAgentChat(
        { message: text, sessionId: sessionIdRef.current, chainId, source: sourceOf(spoken) },
        onEvent,
        controller.signal,
      )
        .catch((err: unknown) => {
          const msg =
            err instanceof AgentStreamError
              ? err.status === 401
                ? "Please sign in to use the agent."
                : err.message
              : err instanceof DOMException && err.name === "AbortError"
                ? null
                : "The agent connection dropped.";
          if (msg) patchAssistant(assistantId, (m) => ({ ...m, failed: msg }));
        })
        .finally(() => {
          patchAssistant(assistantId, (m) => ({ ...m, streaming: false }));
          setBusy(false);
          busyRef.current = false;
          abortRef.current = null;
        });
    },
    [patchAssistant, chainId],
  );

  // Always call the latest `send` from the window listener (no stale closure).
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => {
    const onInput = (e: Event) => {
      const command = readAgentInput((e as CustomEvent<unknown>).detail);
      if (command.text !== "") sendRef.current(command.text, command.spoken);
    };
    window.addEventListener(AGENT_INPUT_EVENT, onInput);
    return () => {
      window.removeEventListener(AGENT_INPUT_EVENT, onInput);
    };
  }, []);

  // Seed the first turn from a command typed in another panel (App.tsx routes
  // hookless / agent commands here). Fires once on mount; `send` owns its own
  // setState so this stays lint-clean.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !initialMessage) return;
    seededRef.current = true;
    sendRef.current(initialMessage, initialSpoken === true);
  }, [initialMessage, initialSpoken]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    sessionIdRef.current = undefined;
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
  }, []);

  return (
    <AgentActionsContext.Provider value={{ send, busy }}>
      <>
        <PanelHeader onNewChat={newChat} />

        <div className="flex items-center justify-between border-b border-border-soft bg-bg-elev px-4 py-3.5">
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button
                variant="icon"
                size="icon"
                className="h-[26px] w-[26px] rounded-[7px]"
                onClick={newChat}
                aria-label="Back to suggestions"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            )}
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <Bot className="h-4 w-4" aria-hidden /> Your Sports Agent
            </div>
          </div>
          <Button
            variant="icon"
            size="icon"
            className="h-[26px] w-[26px] rounded-[7px]"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {agent.agentAddress && (
          <AgentWalletStrip agent={agent} label={`Agent · ${shortAddr(agent.agentAddress)}`} />
        )}

        <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-4">
          {messages.length === 0 ? (
            <EmptyState onPick={send} disabled={busy} />
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.text} />
              ) : (
                <AssistantBubble key={m.id} msg={m} />
              ),
            )
          )}
          <div ref={endRef} />
        </div>
      </>
    </AgentActionsContext.Provider>
  );
}

function AssistantBubble({ msg }: { msg: AssistantMsg }) {
  const showThinking = msg.streaming && msg.text === "" && msg.steps.length === 0;
  return (
    <div className="flex flex-col gap-2.5 self-stretch">
      {showThinking && (
        <div className="flex items-center gap-2">
          <Spinner agent />
          <span className="text-[13px] text-text-dim">Thinking…</span>
        </div>
      )}

      {msg.steps.map((step) => (
        <StepCard key={step.id} step={step} />
      ))}

      {msg.text && (
        <div className="max-w-[92%] whitespace-pre-wrap text-[13px] leading-[1.55] text-text">
          <RichText text={msg.text} />
          {msg.streaming && <Caret />}
        </div>
      )}
      {/* T-022: the agent's read is an estimate, never a certainty. */}
      {!msg.streaming && msg.text && <PredictionNote className="max-w-[92%]" />}

      {msg.failed && (
        <Banner tone="error" icon="⊘" title="Something went wrong">
          {msg.failed}
        </Banner>
      )}
    </div>
  );
}

function StepCard({ step }: { step: ToolStep }) {
  if (step.status === "running") {
    return (
      <div className="flex items-center gap-2">
        <Spinner agent />
        <span className="text-[12px] text-text-dim">{TOOL_VERB[step.tool] ?? "Working"}…</span>
      </div>
    );
  }
  if (step.status === "error") {
    return (
      <Banner tone="error" icon="⊘" title={`${TOOL_VERB[step.tool] ?? step.tool} failed`}>
        {step.error ?? "Unknown error"}
      </Banner>
    );
  }
  // Tools without a meaningful result view render nothing — the assistant's
  // text already narrates the outcome, so an empty "Done." card is noise.
  const content = renderResult(step);
  if (content === null) return null;
  return <div className="rounded-md border border-border-soft bg-bg-elev p-3.5">{content}</div>;
}

// ── Result renderers (read-only views of the server tool results) ──

interface SwapData {
  txHash: string;
  explorerUrl: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
}
interface SendData {
  txHash: string;
  explorerUrl: string;
  amount: string;
  symbol: string;
  to: string;
}
interface PortfolioData {
  address: string;
  balances: { symbol: string; balance: string; usdValue: number }[];
}
interface QuoteData {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
}
interface WalletData {
  address: string;
  dailyCapUsd: string | number;
  status: string;
}
interface AnalyzeData {
  title: string;
  summary: string;
  metrics?: { label: string; value: string }[];
  bullets?: string[];
  sources?: { name: string; url?: string }[];
}

function fmtNum(s: string): string {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : s;
}

function ConfirmRow({ label }: { label: string }) {
  const { send, busy } = useContext(AgentActionsContext);
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="text-[11px] text-text-mute">
        Reply &quot;confirm&quot; or press the button — nothing runs until you do.
      </span>
      <Button
        size="sm"
        className="h-11 shrink-0 px-4 md:h-8"
        disabled={busy}
        onClick={() => {
          send("confirm");
        }}
      >
        {label}
      </Button>
    </div>
  );
}

function renderResult(step: ToolStep): ReactNode {
  switch (step.tool) {
    case "mantua_simulate_trade": {
      const c = simulationCard(step.data as SimulationResult);
      return (
        <div className="flex flex-col gap-2">
          <Heading>Preview · {c.title}</Heading>
          <DetailRows rows={c.rows} />
          {c.blockers.length > 0 && (
            <Banner tone="error" icon="⊘" title="Not executable">
              {c.blockers.join(" ")}
            </Banner>
          )}
          {c.canConfirm && <ConfirmRow label="Confirm trade" />}
        </div>
      );
    }
    case "mantua_preview_action": {
      const d = step.data as { tool: string; summary: string };
      return (
        <div className="flex flex-col gap-2">
          <Heading>Preview · {d.tool.replace(/_/g, " ")}</Heading>
          <div className="text-[13px] text-text-dim">{d.summary}</div>
          <ConfirmRow label="Confirm" />
        </div>
      );
    }
    case "mantua_execute_trade":
    case "mantua_sell_position": {
      const d = step.data as {
        txHash: string;
        explorer: string;
        received: string;
        marketId: string;
      };
      return (
        <Success
          title={
            step.tool === "mantua_execute_trade" ? `Bought ${d.received}` : `Sold for ${d.received}`
          }
          detail="Executed through your agent wallet after your confirm."
          txHash={d.txHash}
          explorerUrl={d.explorer}
        />
      );
    }
    case "mantua_analyze_market": {
      const raw = step.data as { status?: string } & AnalysisResult;
      if (raw.status !== "ok") return null;
      const c = analysisCard(raw);
      return (
        <div className="flex flex-col gap-2">
          <Heading>{c.title}</Heading>
          <div className="text-[13px] text-text-dim">{c.headline}</div>
          <DetailRows rows={c.evidence} />
          {c.risks.length > 0 && (
            <div className="text-[11px] text-text-mute">Risks: {c.risks.join(" · ")}</div>
          )}
          <div className="text-[12px] font-medium">{c.action}</div>
        </div>
      );
    }
    case "mantua_daily_brief": {
      const c = dailyBriefCard(step.data as DailyBriefResult);
      return (
        <div className="flex flex-col gap-2">
          <Heading>Daily Brief</Heading>
          <DetailRows rows={c.rows} />
          {c.markets.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-wide text-text-mute">
                Markets worth a look
              </div>
              <DetailRows rows={c.markets} />
            </>
          )}
        </div>
      );
    }
    case "mantua_get_performance": {
      const d = step.data as {
        totals: {
          realizedPnlUsd: number;
          winRate: number | null;
          wins: number;
          losses: number;
          voided: number;
          openMarkets: number;
          openCostUsd: number;
        };
      };
      const t = d.totals;
      return (
        <div className="flex flex-col gap-2">
          <Heading>Track record</Heading>
          <DetailRows
            rows={[
              {
                label: "Realized P&L",
                value: `${t.realizedPnlUsd >= 0 ? "+" : ""}$${t.realizedPnlUsd.toFixed(2)}`,
              },
              {
                label: "Win rate",
                value:
                  t.winRate === null
                    ? "no resolved markets yet"
                    : `${(t.winRate * 100).toFixed(0)}% (${String(t.wins)}-${String(t.losses)}${t.voided ? `, ${String(t.voided)} void` : ""})`,
              },
              {
                label: "Open",
                value: `${String(t.openMarkets)} markets · $${t.openCostUsd.toFixed(2)} at risk`,
              },
            ]}
          />
        </div>
      );
    }
    case "mantua_get_portfolio": {
      const d = step.data as PortfolioData & {
        marketTotals: { count: number; valueUsd: number; pnlUsd: number };
      };
      return (
        <div className="flex flex-col gap-2">
          <Heading>Agent portfolio</Heading>
          <DetailRows
            rows={[
              ...d.balances.map((b) => ({
                label: b.symbol,
                value: `${fmtNum(b.balance)}${b.usdValue ? ` · $${b.usdValue.toFixed(2)}` : ""}`,
              })),
              {
                label: "Sports positions",
                value: `${String(d.marketTotals.count)} · $${d.marketTotals.valueUsd.toFixed(2)} · P&L ${d.marketTotals.pnlUsd >= 0 ? "+" : ""}$${d.marketTotals.pnlUsd.toFixed(2)}`,
              },
            ]}
          />
        </div>
      );
    }
    case "mantua_search_markets": {
      const d = step.data as {
        rows: {
          matchup: string;
          status: string;
          homeWinProbabilityBps: number | null;
          liveOdds: boolean;
        }[];
      };
      if (d.rows.length === 0) return null;
      return (
        <div className="flex flex-col gap-2">
          <Heading>Markets</Heading>
          <DetailRows
            rows={d.rows.slice(0, 8).map((r) => ({
              label: r.status.toUpperCase(),
              value: `${r.matchup} · home ${r.homeWinProbabilityBps === null ? "—" : `${(r.homeWinProbabilityBps / 100).toFixed(1)}%`}${r.liveOdds ? " (pool)" : ""}`,
            }))}
          />
        </div>
      );
    }
    case "swap": {
      const d = step.data as SwapData;
      return (
        <Success
          title={`Swapped ${fmtNum(d.amountIn)} ${d.tokenIn} → ${fmtNum(d.amountOut)} ${d.tokenOut}`}
          txHash={d.txHash}
          explorerUrl={d.explorerUrl}
        />
      );
    }
    case "send": {
      const d = step.data as SendData;
      return (
        <Success
          title={`Sent ${fmtNum(d.amount)} ${d.symbol}`}
          detail={`To ${shortAddr(d.to)}`}
          txHash={d.txHash}
          explorerUrl={d.explorerUrl}
        />
      );
    }
    case "get_portfolio": {
      const d = step.data as PortfolioData;
      return (
        <div className="flex flex-col gap-2">
          <Heading>Agent wallet balances</Heading>
          <DetailRows
            rows={d.balances.map((b) => ({
              label: b.symbol,
              value: `${fmtNum(b.balance)}${b.usdValue ? ` · $${b.usdValue.toFixed(2)}` : ""}`,
            }))}
          />
        </div>
      );
    }
    case "get_swap_quote": {
      const d = step.data as QuoteData;
      return (
        <div className="flex flex-col gap-2">
          <Heading>Quote</Heading>
          <DetailRows
            rows={[
              { label: "Pay", value: `${fmtNum(d.amountIn)} ${d.tokenIn}` },
              { label: "Receive", value: `${fmtNum(d.amountOut)} ${d.tokenOut}` },
            ]}
          />
        </div>
      );
    }
    case "manage_wallet": {
      const d = step.data as WalletData;
      return (
        <div className="flex flex-col gap-2">
          <Heading>Agent wallet</Heading>
          <DetailRows
            rows={[
              { label: "Address", value: shortAddr(d.address) },
              { label: "Daily cap", value: `$${String(d.dailyCapUsd)}` },
              { label: "Status", value: d.status },
            ]}
          />
        </div>
      );
    }
    case "get_market_data": {
      const d = step.data as AnalyzeData;
      return <AnalyzeView data={d} />;
    }
    case "get_user_wallet": {
      const d = step.data as {
        connected: boolean;
        address?: string;
        balances?: { symbol: string; balance: string; usdValue: number }[];
      };
      if (!d.connected) {
        return <span className="text-[12px] text-text-dim">No wallet connected.</span>;
      }
      return (
        <div className="flex flex-col gap-2">
          <Heading>Your wallet balances</Heading>
          <DetailRows
            rows={(d.balances ?? []).map((b) => ({
              label: b.symbol,
              value: `${fmtNum(b.balance)}${b.usdValue ? ` · $${b.usdValue.toFixed(2)}` : ""}`,
            }))}
          />
        </div>
      );
    }
    case "bridge": {
      const d = step.data as {
        amount: string;
        destinationChain: string;
        recipient: string;
        burnTxHash?: string;
        mintTxHash?: string;
      };
      const label = d.destinationChain.replace(/_/g, " ");
      return (
        <div className="flex flex-col gap-2.5">
          <Banner
            tone="success"
            icon={<Check className="h-3.5 w-3.5" aria-hidden />}
            title={`Bridged ${fmtNum(d.amount)} USDC → ${label}`}
          >
            Recipient {shortAddr(d.recipient)} on {label}. Circle&apos;s forwarding fee is deducted
            from the minted amount.
          </Banner>
          {d.burnTxHash && (
            <TxRow
              hash={d.burnTxHash}
              explorerUrl={getExplorerTxUrl(BASE_CHAIN_ID, d.burnTxHash)}
            />
          )}
        </div>
      );
    }
    case "create_pool": {
      const d = step.data as {
        alreadyExists: boolean;
        tokenA: string;
        tokenB: string;
        fee: number;
        txHash?: string;
        explorerUrl?: string;
      };
      if (d.alreadyExists) {
        return (
          <span className="text-[12px] text-text-dim">
            {d.tokenA}/{d.tokenB} pool already exists — adding liquidity instead.
          </span>
        );
      }
      return d.txHash && d.explorerUrl ? (
        <Success
          title={`Created ${d.tokenA}/${d.tokenB} pool (${(d.fee / 10000).toFixed(2)}%)`}
          txHash={d.txHash}
          explorerUrl={d.explorerUrl}
        />
      ) : (
        <span className="text-[12px] text-text-dim">Pool created.</span>
      );
    }
    case "get_positions": {
      const d = step.data as {
        positions: { id: string; pair: string; fee: number; liquidity: string }[];
      };
      if (d.positions.length === 0) {
        return <span className="text-[12px] text-text-dim">No open positions.</span>;
      }
      return (
        <div className="flex flex-col gap-2">
          <Heading>Agent LP positions</Heading>
          <DetailRows
            rows={d.positions.map((p) => ({
              label: p.pair,
              value: `${(p.fee / 10000).toFixed(2)}% · L ${fmtNum(p.liquidity)}`,
            }))}
          />
        </div>
      );
    }
    case "add_liquidity":
    case "remove_liquidity": {
      const d = step.data as { txHash?: string; explorerUrl?: string };
      return d.txHash && d.explorerUrl ? (
        <Success
          title={step.tool === "add_liquidity" ? "Liquidity added" : "Liquidity removed"}
          txHash={d.txHash}
          explorerUrl={d.explorerUrl}
        />
      ) : null;
    }
    case "market_research": {
      const d = step.data as {
        trending?: { symbol: string; priceChange24hPct: number | null }[];
        narratives?: { narrative: string; avgChange24hPct: number }[];
        tvlMovers?: { name: string; change1dPct: number }[];
      };
      const pct = (v: number | null | undefined) =>
        typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—";
      return (
        <div className="flex flex-col gap-2">
          {(d.trending?.length ?? 0) > 0 && (
            <>
              <Heading>Trending</Heading>
              <DetailRows
                rows={(d.trending ?? []).slice(0, 5).map((t) => ({
                  label: t.symbol,
                  value: pct(t.priceChange24hPct),
                }))}
              />
            </>
          )}
          {(d.narratives?.length ?? 0) > 0 && (
            <>
              <Heading>Narratives (24h)</Heading>
              <DetailRows
                rows={(d.narratives ?? []).map((n) => ({
                  label: n.narrative,
                  value: pct(n.avgChange24hPct),
                }))}
              />
            </>
          )}
          {(d.tvlMovers?.length ?? 0) > 0 && (
            <>
              <Heading>TVL movers (1d)</Heading>
              <DetailRows
                rows={(d.tvlMovers ?? []).slice(0, 5).map((m) => ({
                  label: m.name,
                  value: pct(m.change1dPct),
                }))}
              />
            </>
          )}
        </div>
      );
    }
    case "inspect_address": {
      const d = step.data as {
        found: boolean;
        address?: string;
        nativeBalance?: string;
        isContract?: boolean;
        label?: string | null;
        tokenTransfers?: { token: string; direction: string; amount: string }[];
        signals?: { notes: string[] };
      };
      if (!d.found) {
        return <span className="text-[12px] text-text-dim">No explorer data.</span>;
      }
      const activity = (d.tokenTransfers ?? []).slice(0, 5);
      return (
        <div className="flex flex-col gap-2">
          <Heading>
            {d.label ?? shortAddr(d.address ?? "")} {d.isContract ? "· contract" : "· wallet"}
          </Heading>
          <DetailRows
            rows={[
              { label: "Native (ETH)", value: fmtNum(d.nativeBalance ?? "0") },
              ...activity.map((t) => ({
                label: `${t.direction === "in" ? "→ in" : "← out"} ${t.token}`,
                value: fmtNum(t.amount),
              })),
            ]}
          />
          {(d.signals?.notes.length ?? 0) > 0 && (
            <span className="text-[12px] text-text-dim">{d.signals?.notes.join(" ")}</span>
          )}
        </div>
      );
    }
    case "inspect_token": {
      const d = step.data as {
        found: boolean;
        name?: string;
        symbol?: string;
        totalSupply?: string;
        holdersCount?: number;
        top10Pct?: number;
        flags?: string[];
      };
      if (!d.found) {
        return <span className="text-[12px] text-text-dim">No token data.</span>;
      }
      return (
        <div className="flex flex-col gap-2">
          <Heading>
            {d.name} ({d.symbol})
          </Heading>
          <DetailRows
            rows={[
              { label: "Total supply", value: fmtNum(d.totalSupply ?? "0") },
              { label: "Holders", value: (d.holdersCount ?? 0).toLocaleString() },
              { label: "Top 10 hold", value: `${(d.top10Pct ?? 0).toFixed(1)}%` },
            ]}
          />
          {(d.flags?.length ?? 0) > 0 && (
            <Banner tone="error" icon="⚠" title="Red flags">
              {d.flags?.join(" ")}
            </Banner>
          )}
        </div>
      );
    }
    case "inspect_transaction": {
      const d = step.data as {
        found: boolean;
        hash?: string;
        status?: string;
        method?: string | null;
        tokenMovements?: { token: string; amount: string }[];
        explorerUrl?: string;
      };
      if (!d.found) {
        return <span className="text-[12px] text-text-dim">No tx data.</span>;
      }
      return (
        <div className="flex flex-col gap-2">
          <Heading>
            Tx {d.status}
            {d.method ? ` · ${d.method}` : ""}
          </Heading>
          {(d.tokenMovements?.length ?? 0) > 0 && (
            <DetailRows
              rows={(d.tokenMovements ?? []).map((m, idx) => ({
                label: `#${String(idx + 1)} ${m.token}`,
                value: fmtNum(m.amount),
              }))}
            />
          )}
          {d.hash && d.explorerUrl && <TxRow hash={d.hash} explorerUrl={d.explorerUrl} />}
        </div>
      );
    }
    case "inspect_hook_contract": {
      const d = step.data as {
        pegReference?: number;
        deviationBps?: number | null;
        zone?: string;
        circuitBreakerBlocksSwaps?: boolean;
        owner?: string;
      };
      return (
        <div className="flex flex-col gap-2">
          <Heading>Stable Protection guard · via Circle Contracts</Heading>
          <DetailRows
            rows={[
              { label: "Peg reference (EUR/USD)", value: (d.pegReference ?? 0).toFixed(5) },
              {
                label: "Deviation",
                value: d.deviationBps === null ? "—" : `${String(d.deviationBps ?? 0)} bps`,
              },
              { label: "Zone", value: d.zone ?? "?" },
              { label: "Breaker", value: d.circuitBreakerBlocksSwaps ? "BLOCKING" : "open" },
              { label: "Owner", value: shortAddr(d.owner ?? "") },
            ]}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-semibold">{children}</div>;
}

function Success({
  title,
  detail,
  txHash,
  explorerUrl,
}: {
  title: string;
  detail?: string;
  txHash: string;
  explorerUrl: string;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <Banner tone="success" icon={<Check className="h-3.5 w-3.5" aria-hidden />} title={title}>
        {detail ?? "Executed through your agent wallet."}
      </Banner>
      <TxRow hash={txHash} explorerUrl={explorerUrl} />
    </div>
  );
}

function AnalyzeView({ data }: { data: AnalyzeData }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold">{data.title}</div>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-text-dim">{data.summary}</p>
      </div>
      {data.metrics && data.metrics.length > 0 && (
        <DetailRows rows={data.metrics.map((m) => ({ label: m.label, value: m.value }))} />
      )}
      {data.bullets && data.bullets.length > 0 && (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-[1.6] text-text">
          {data.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
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
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-text-dim"
                >
                  {s.name} <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                </a>
              ) : (
                s.name
              )}
              {i < arr.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (s: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-[13px] leading-[1.6] text-text-dim">
        Hi, I'm your Mantua sport agent (Circle Wallet). Tell me what to do in plain language and
        I'll handle it: check your agent wallet and balances, evaluate today's NFL matchups, place
        or exit a bet, or review your positions and P&amp;L. Reads happen as we go; anything that
        moves money is previewed first and runs only after you reply &quot;confirm&quot;, within
        your daily spending cap.
      </div>
      <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={disabled}
            onClick={() => {
              onPick(s.message);
            }}
            className="min-h-11 flex-shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-border-soft bg-chip px-4 py-1.5 text-[13px] text-text-dim disabled:cursor-default disabled:opacity-50 md:min-h-0 md:px-3 md:text-[12px]"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
