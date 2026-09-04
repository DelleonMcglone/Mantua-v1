import { useEffect, useRef, useState } from "react";
import { Command } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { api, ApiError } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";
import { IntentCard } from "@/features/agent/IntentCard.tsx";

/**
 * Mantua Prototype — `<CommandBar />` (F8 from `Mantua Agent Flows.html`
 * via `~/Downloads/mantua-ai/project/src/agent_flows.jsx`).
 *
 * NOT MOUNTED — kept as a reusable primitive only.
 *
 * The design source defines this component in `agent_flows.jsx:23`
 * and exports it on `window` (`agent_flows.jsx:253`), but `app.jsx`
 * does **not** render it. Per chat2 of the design handoff
 * (`mantua-ai/chats/chat2.md`), the user explicitly directed:
 *
 *   "remove the chatbot at the top, the only chatbot is the one
 *    at the bottom right"
 *
 * The bottom-right `<InputBar />` is the only natural-language
 * surface in the prototype. PR #63 erroneously mounted this
 * component at the top of the right column; the follow-up revert PR
 * removed that mount. The component file is preserved here because
 * the design pattern keeps unused primitives available for future
 * reuse, and the wiring to the real `POST /api/command/parse`
 * endpoint (PN-003 / PR #61) is already complete — if a future
 * surface needs an inline command bar, just import and render.
 *
 * - ⌘K / Ctrl-K to focus the input from anywhere on the page.
 * - Esc to dismiss the parsed preview / clear input.
 * - Enter parses the command. The Phase N server returns a
 *   discriminated `intent` (one of 9 actions). On confirm, the parent
 *   `onIntent` callback drives navigation / execution.
 */

/* ───────────────────────── Phase N intent shape (mirror) ───────────── */

type FeeTier = 100 | 500 | 3000 | 10_000;
type HookType = "stable_protection" | "dynamic_fee" | "none";

export type CommandIntent =
  | { action: "swap"; tokenIn: string; tokenOut: string; amountIn: string; confidence: number }
  | {
      action: "add_liquidity";
      token0: string;
      token1: string;
      amount0?: string;
      amount1?: string;
      feeTier?: FeeTier;
      hook?: HookType;
      confidence: number;
    }
  | { action: "remove_liquidity"; poolId: string; percentage: number; confidence: number }
  | {
      action: "create_pool";
      token0: string;
      token1: string;
      feeTier: FeeTier;
      hook?: HookType;
      confidence: number;
    }
  | { action: "send_tokens"; token: string; amount: string; recipient: string; confidence: number }
  | { action: "query_analytics"; question: string; confidence: number }
  | { action: "portfolio_summary"; confidence: number }
  | {
      action: "clarification_needed";
      message: string;
      suggestedAction?: string;
      confidence: number;
    }
  | { action: "reject"; reason: string; confidence: number };

interface ParseResult {
  intent: CommandIntent;
  raw: string;
  model: string;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export type CommandBarPage = "swap" | "liquidity" | "agent" | "portfolio" | "analytics" | "other";

interface CommandBarProps {
  /** Page the user is on — sent as context to bias the parser (PN-007). */
  page: CommandBarPage;
  /** Optional pool id (when on a pool detail / add-liquidity surface). */
  poolId?: string;
  /** Called when the user confirms a parsed action intent. The caller
   *  drives navigation / execution. Not called for clarify / reject. */
  onIntent: (intent: CommandIntent) => void;
}

type State =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "parsed"; result: ParseResult }
  | { status: "error"; message: string };

const SUGGESTIONS = [
  "Swap 10 USDC for ETH",
  "Add liquidity to USDC/EURC",
  "TVL of Uniswap today",
];

const PLACEHOLDER = 'Type a command… (e.g., "swap 10 USDC for ETH")';

/* ───────────────────────── Intent → preview labels ─────────────────── */

function summarizeIntent(intent: CommandIntent): string {
  switch (intent.action) {
    case "swap":
      return `Swap ${intent.amountIn} ${intent.tokenIn} → ${intent.tokenOut}`;
    case "add_liquidity": {
      const amt =
        intent.amount0 && intent.amount1
          ? `${intent.amount0} ${intent.token0} + ${intent.amount1} ${intent.token1}`
          : "deposit amounts to be confirmed";
      const fee = intent.feeTier ? ` · ${(intent.feeTier / 10_000).toString()}%` : "";
      return `Add liquidity to ${intent.token0}/${intent.token1}${fee} · ${amt}`;
    }
    case "remove_liquidity":
      return `Remove ${String(intent.percentage)}% from ${intent.poolId}`;
    case "create_pool":
      return `Create ${intent.token0}/${intent.token1} pool · ${(intent.feeTier / 10_000).toString()}%`;
    case "send_tokens":
      return `Send ${intent.amount} ${intent.token} to ${intent.recipient}`;
    case "query_analytics":
      return `Query: ${intent.question}`;
    case "portfolio_summary":
      return "Show portfolio summary";
    case "clarification_needed":
      return intent.message;
    case "reject":
      return intent.reason;
  }
}

function confidenceTone(intent: CommandIntent): "high" | "low" | "failed" {
  if (intent.action === "reject") return "failed";
  if (intent.action === "clarification_needed") return "low";
  return "high";
}

function confidenceLabel(c: number): string {
  if (c >= 0.85) return "high";
  if (c >= 0.65) return "medium";
  return "low";
}

/* ───────────────────────── Component ──────────────────────────────── */

export function CommandBar({ page, poolId, onIntent }: CommandBarProps) {
  const [val, setVal] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl-K to focus, Esc to dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setState({ status: "idle" });
        setVal("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const parse = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState({ status: "parsing" });
    try {
      const context: { page: CommandBarPage; poolId?: string } = { page };
      if (poolId) context.poolId = poolId;
      const result = await api.post<ParseResult>("/api/command/parse", {
        text: trimmed,
        context,
      });
      setState({ status: "parsed", result });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to parse command";
      setState({ status: "error", message });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void parse(val);
    }
  };

  const dismiss = () => {
    setState({ status: "idle" });
    setVal("");
  };

  const confirm = () => {
    if (state.status !== "parsed") return;
    const intent = state.result.intent;
    if (intent.action === "reject" || intent.action === "clarification_needed") {
      dismiss();
      return;
    }
    onIntent(intent);
    dismiss();
  };

  return (
    <div className="sticky top-0 z-50 border-b border-border-soft bg-bg px-8 py-2.5">
      <div className="mx-auto max-w-[980px]">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-md border bg-bg-elev px-3.5 py-2.5 transition-all",
            focused ? "border-accent ring-[3px] ring-accent/10" : "border-border-soft",
          )}
        >
          <Command
            className={cn("h-3.5 w-3.5", focused ? "text-accent" : "text-text-mute")}
            aria-hidden
          />
          <input
            ref={inputRef}
            value={val}
            onChange={(e) => {
              setVal(e.target.value);
              if (state.status === "parsed" || state.status === "error") {
                setState({ status: "idle" });
              }
            }}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
            }}
            onKeyDown={onKeyDown}
            placeholder={PLACEHOLDER}
            className="flex-1 border-none bg-transparent text-[13px] text-text outline-none"
          />
          {state.status === "parsing" && (
            <span className="text-[11px] text-text-mute">parsing…</span>
          )}
          {state.status !== "parsing" && !val && (
            <span className="mono inline-flex items-center gap-0.5 rounded-[6px] border border-border-soft bg-chip px-1.5 py-0.5 text-[10px] text-text-mute">
              <Command className="h-2.5 w-2.5" aria-hidden />K
            </span>
          )}
          {val && state.status === "idle" && (
            <span className="mono text-[10px] text-text-mute">↵ to parse</span>
          )}
        </div>

        {state.status === "parsed" && (
          <IntentCard
            confidence={confidenceTone(state.result.intent)}
            headlineRight={
              <span>
                confidence: {confidenceLabel(state.result.intent.confidence)} · {page} page
              </span>
            }
            what={summarizeIntent(state.result.intent)}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 border-border-soft text-[12px]"
                  onClick={dismiss}
                >
                  Cancel
                </Button>
                {state.result.intent.action !== "reject" &&
                  state.result.intent.action !== "clarification_needed" && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-[2] text-[12px]"
                      onClick={confirm}
                    >
                      Confirm &amp; open
                    </Button>
                  )}
              </>
            }
          />
        )}

        {state.status === "parsed" && state.result.intent.action === "reject" && (
          <div className="mt-2 px-3.5 py-2.5 text-[11px] text-text-mute">
            <div className="mb-1.5">Try one of these:</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setVal(s);
                    void parse(s);
                  }}
                  className="cursor-pointer rounded-full border border-border-soft bg-chip px-2.5 py-1 text-[11px] text-text-dim"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="mt-2 rounded-md border border-red/30 bg-red/10 px-3.5 py-2.5 text-[11px] text-red">
            {state.message}
          </div>
        )}
      </div>
    </div>
  );
}
