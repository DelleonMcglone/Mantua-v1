import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.ts";
import { TOKEN_SYMBOLS } from "./tokens.ts";

/**
 * P6-010 — natural-language → structured-intent parser.
 *
 * Uses Claude (Opus 4.7) with adaptive thinking and tool use for
 * structured output. Prompt caching keeps the static parts (system
 * prompt + tool defs) cached so per-instruction cost stays low.
 *
 * Confidence thresholds (D-014: ≥0.85 execute / 0.65–0.85 clarify /
 * <0.65 reject) are encoded by tool selection rather than a numeric
 * score — the model picks `clarify` or `reject` when it isn't
 * confident in any action tool. This is sturdier than asking for a
 * float Claude has no real way to calibrate.
 *
 * Ships as parser-only — the intent + params are returned to the
 * caller. Auto-execution wiring is the autonomous-mode UI (P6-009),
 * which is deferred to TD-004.
 */

let cached: Anthropic | null = null;

export class AnthropicUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY not configured. NLP parser is unavailable.");
    this.name = "AnthropicUnavailableError";
  }
}

function getAnthropic(): Anthropic {
  if (cached) return cached;
  if (!env.ANTHROPIC_API_KEY) throw new AnthropicUnavailableError();
  cached = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cached;
}

/** Test-only escape hatch. */
export function setAnthropicForTesting(client: Anthropic | null): void {
  cached = client;
}

export type AgentIntent =
  | {
      kind: "swap";
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      slippageTolerance?: number;
    }
  | {
      kind: "send";
      to: string;
      token: string;
      amount: string;
    }
  | {
      kind: "add_liquidity";
      tokenA: string;
      tokenB: string;
      fee: number;
      amountA: string;
      amountB: string;
    }
  | {
      kind: "remove_liquidity";
      positionId: string;
      percentage: number;
    }
  | {
      kind: "query";
      type: "pools" | "pool" | "chart";
      poolId?: string;
      days?: number;
    }
  | {
      kind: "wallet";
      action: "create" | "info" | "set_cap";
      dailyCapUsd?: number;
    }
  | {
      kind: "clarify";
      question: string;
    }
  | {
      kind: "reject";
      reason: string;
    };

export interface ParseResult {
  intent: AgentIntent;
  raw: string;
  /** Model used for the parse. */
  model: string;
  /** Cache hit metrics for observability. */
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

const SYSTEM_PROMPT = `You translate a Mantua user's natural-language instruction into one of seven structured agent actions, or clarify / reject when the instruction is unclear.

You are NOT executing the action — you are picking which tool maps to the user's intent and extracting its parameters. The caller will execute. Pick the tool that best matches; pick \`clarify\` when you understand the rough intent but a parameter is missing or ambiguous; pick \`reject\` when the request is off-scope (not one of the supported actions) or genuinely uninterpretable.

Confidence model (D-014): ≥0.85 confident → pick the action tool; 0.65–0.85 → \`clarify\`; <0.65 → \`reject\`. Don't output a numeric score; just pick the right tool.

Supported tokens (case-sensitive symbols): ${TOKEN_SYMBOLS.join(", ")}.

Notes:
- Amounts are decimal strings in human-readable units (e.g. "1.5" for 1.5 ETH; never atomic / wei).
- Addresses must be 0x-prefixed 40-hex EVM addresses.
- Fee tiers are 100 / 500 / 3000 / 10000 (basis points × 100; pick a sensible default like 3000 if the user doesn't specify).
- Slippage is optional fractional percent (0.5 = 0.5%).
- Query "type" is one of pools | pool | chart. The chart variant requires a poolId; pool requires a poolId; pools is unparameterized.
- Wallet "action" is one of create | info | set_cap. set_cap requires dailyCapUsd (USD, ≥ 0, ≤ 50000).`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "swap",
    description:
      "Swap one token for another from the agent wallet via Uniswap. Input is denominated in tokenIn.",
    input_schema: {
      type: "object",
      properties: {
        tokenIn: { type: "string", description: "Symbol of the token to swap from." },
        tokenOut: { type: "string", description: "Symbol of the token to swap into." },
        amountIn: { type: "string", description: "Decimal amount of tokenIn to swap." },
        slippageTolerance: {
          type: "number",
          description:
            "Optional slippage tolerance as fractional percent (0.5 = 0.5%). Leave unset for API auto-slippage.",
        },
      },
      required: ["tokenIn", "tokenOut", "amountIn"],
    },
  },
  {
    name: "send",
    description: "Send tokens from the agent wallet to an arbitrary address.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient address (0x...)." },
        token: { type: "string", description: "Token symbol." },
        amount: { type: "string", description: "Decimal amount in human-readable units." },
      },
      required: ["to", "token", "amount"],
    },
  },
  {
    name: "add_liquidity",
    description: "Add liquidity to a Uniswap v4 pool from the agent wallet.",
    input_schema: {
      type: "object",
      properties: {
        tokenA: { type: "string" },
        tokenB: { type: "string" },
        fee: {
          type: "integer",
          enum: [100, 500, 3000, 10_000],
          description: "Pool fee tier in 1e-6 units (100 = 0.01%, 3000 = 0.3%, etc.).",
        },
        amountA: { type: "string", description: "Decimal amount of tokenA." },
        amountB: { type: "string", description: "Decimal amount of tokenB." },
      },
      required: ["tokenA", "tokenB", "fee", "amountA", "amountB"],
    },
  },
  {
    name: "remove_liquidity",
    description: "Remove a percentage of an existing position's liquidity.",
    input_schema: {
      type: "object",
      properties: {
        positionId: {
          type: "string",
          description:
            "Internal position UUID (the user references it by symbolic name; ask if missing).",
        },
        percentage: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["positionId", "percentage"],
    },
  },
  {
    name: "query",
    description:
      "Query on-chain / market data via DefiLlama (pools, single pool, or historical chart).",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["pools", "pool", "chart"] },
        poolId: { type: "string", description: "Required for type=pool or type=chart." },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "Optional, only for type=chart.",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "wallet",
    description: "Agent wallet operations: create, view info, or set the daily USD cap.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "info", "set_cap"] },
        dailyCapUsd: {
          type: "number",
          minimum: 0,
          maximum: 50_000,
          description: "Required when action=set_cap.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "clarify",
    description:
      "Use when the user's intent is roughly clear but a required parameter is missing or ambiguous (confidence 0.65–0.85).",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "A specific follow-up question the user can answer.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "reject",
    description:
      "Use when the request is off-scope or uninterpretable (confidence <0.65). Provide a short reason.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
];

const MODEL = "claude-opus-4-7";

interface ToolUseInput {
  [k: string]: unknown;
}

function toIntent(name: string, input: ToolUseInput): AgentIntent {
  switch (name) {
    case "swap":
      return {
        kind: "swap",
        tokenIn: String(input["tokenIn"]),
        tokenOut: String(input["tokenOut"]),
        amountIn: String(input["amountIn"]),
        ...(typeof input["slippageTolerance"] === "number"
          ? { slippageTolerance: input["slippageTolerance"] }
          : {}),
      };
    case "send":
      return {
        kind: "send",
        to: String(input["to"]),
        token: String(input["token"]),
        amount: String(input["amount"]),
      };
    case "add_liquidity":
      return {
        kind: "add_liquidity",
        tokenA: String(input["tokenA"]),
        tokenB: String(input["tokenB"]),
        fee: Number(input["fee"]),
        amountA: String(input["amountA"]),
        amountB: String(input["amountB"]),
      };
    case "remove_liquidity":
      return {
        kind: "remove_liquidity",
        positionId: String(input["positionId"]),
        percentage: Number(input["percentage"]),
      };
    case "query":
      return {
        kind: "query",
        type: input["type"] as "pools" | "pool" | "chart",
        ...(typeof input["poolId"] === "string" ? { poolId: input["poolId"] } : {}),
        ...(typeof input["days"] === "number" ? { days: input["days"] } : {}),
      };
    case "wallet":
      return {
        kind: "wallet",
        action: input["action"] as "create" | "info" | "set_cap",
        ...(typeof input["dailyCapUsd"] === "number" ? { dailyCapUsd: input["dailyCapUsd"] } : {}),
      };
    case "clarify":
      return { kind: "clarify", question: String(input["question"]) };
    case "reject":
      return { kind: "reject", reason: String(input["reason"]) };
    default:
      return { kind: "reject", reason: `Unknown tool: ${name}` };
  }
}

/**
 * Parse a natural-language instruction into an AgentIntent.
 *
 * Prompt caching: system prompt + tool defs are >1024 tokens once
 * concatenated, so cache_control on the system text caches the entire
 * static prefix (tools + system). Per-instruction cost is then ~10% of
 * uncached.
 */
export async function parseInstruction(text: string): Promise<ParseResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      intent: { kind: "reject", reason: "Empty instruction." },
      raw: text,
      model: MODEL,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }

  const client = getAnthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    tool_choice: { type: "any" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: TOOLS,
    messages: [{ role: "user", content: trimmed }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const intent: AgentIntent = toolUse
    ? toIntent(toolUse.name, toolUse.input as ToolUseInput)
    : {
        kind: "reject",
        reason: "Model did not select a tool. Treating as off-scope.",
      };

  return {
    intent,
    raw: text,
    model: MODEL,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}
