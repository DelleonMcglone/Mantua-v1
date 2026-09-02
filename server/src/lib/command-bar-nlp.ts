import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../env.ts";
import { TOKEN_SYMBOLS } from "./tokens.ts";

/**
 * PN-001 / PN-002 / PN-003 — Phase N command-bar NLP parser.
 *
 * Distinct from `agent-nlp.ts` (P6-010), which is the Agent-mode
 * parser scoped to wallet-level operations. This parser is the
 * Mantua-wide command-bar surface (Swap, Liquidity, Agent pages
 * per PN-006); the intent shapes diverge intentionally — the
 * roadmap spec at PN-002 Details (`docs/tasks/v2-roadmap.md`
 * around line 656) uses `token0/token1/feeTier` naming, where
 * the agent path uses `tokenA/tokenB/fee`.
 *
 * Confidence model (D-014): the LLM picks which tool maps to the
 * user's intent; confidence is derived from tool selection rather
 * than asked of the model directly (a number Claude has no way to
 * calibrate). Action tools → 0.95 (well above the 0.85 execute
 * threshold); `clarification_needed` → 0.75 (mid-band); the route
 * layer maps tool absence → 0.40 (below the 0.65 reject threshold).
 *
 * OpenAI fallback (PN-001 second half) is deferred to a follow-up;
 * see TD-006 in `docs/tech-debt.md`. Anthropic-only for now.
 */

let cached: Anthropic | null = null;

export class AnthropicUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY not configured. Command-bar NLP is unavailable.");
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

/* ───────────────────────── PN-002: Zod intent schema ───────────────────────── */

const FEE_TIER = z.union([z.literal(100), z.literal(500), z.literal(3000), z.literal(10_000)]);

/**
 * Hook types the parser can recognize. MVP scope: Stable Protection
 * (USDC/EURC only) + Dynamic Fee (any pair) + the no-hook option.
 * The parser itself doesn't validate against deployed addresses or
 * pair compatibility — that's the executor's job.
 */
const HOOK_TYPE = z.enum(["stable_protection", "dynamic_fee", "none"]);

const swapIntent = z.object({
  action: z.literal("swap"),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  confidence: z.number().min(0).max(1),
});

const addLiquidityIntent = z.object({
  action: z.literal("add_liquidity"),
  token0: z.string(),
  token1: z.string(),
  amount0: z.string().optional(),
  amount1: z.string().optional(),
  feeTier: FEE_TIER.optional(),
  hook: HOOK_TYPE.optional(),
  confidence: z.number().min(0).max(1),
});

const removeLiquidityIntent = z.object({
  action: z.literal("remove_liquidity"),
  poolId: z.string(),
  percentage: z.number().int().min(1).max(100),
  confidence: z.number().min(0).max(1),
});

const createPoolIntent = z.object({
  action: z.literal("create_pool"),
  token0: z.string(),
  token1: z.string(),
  feeTier: FEE_TIER,
  hook: HOOK_TYPE.optional(),
  confidence: z.number().min(0).max(1),
});

const sendTokensIntent = z.object({
  action: z.literal("send_tokens"),
  token: z.string(),
  amount: z.string(),
  recipient: z.string(),
  confidence: z.number().min(0).max(1),
});

const queryAnalyticsIntent = z.object({
  action: z.literal("query_analytics"),
  question: z.string(),
  confidence: z.number().min(0).max(1),
});

const portfolioSummaryIntent = z.object({
  action: z.literal("portfolio_summary"),
  confidence: z.number().min(0).max(1),
});

const clarificationNeededIntent = z.object({
  action: z.literal("clarification_needed"),
  message: z.string(),
  /** Optional partial intent the LLM was leaning toward — useful for the UI's preview card. */
  suggestedAction: z
    .enum([
      "swap",
      "add_liquidity",
      "remove_liquidity",
      "create_pool",
      "send_tokens",
      "query_analytics",
      "portfolio_summary",
    ])
    .optional(),
  confidence: z.number().min(0).max(1),
});

const rejectIntent = z.object({
  action: z.literal("reject"),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export const intentSchema = z.discriminatedUnion("action", [
  swapIntent,
  addLiquidityIntent,
  removeLiquidityIntent,
  createPoolIntent,
  sendTokensIntent,
  queryAnalyticsIntent,
  portfolioSummaryIntent,
  clarificationNeededIntent,
  rejectIntent,
]);

export type Intent = z.infer<typeof intentSchema>;

/* ───────────────────────── Page context (PN-007) ───────────────────────── */

export const pageContextSchema = z
  .object({
    page: z.enum(["swap", "liquidity", "agent", "portfolio", "analytics", "other"]).optional(),
    poolId: z.string().optional(),
    tokenInFocus: z.string().optional(),
    note: z.string().max(500).optional(),
  })
  .optional();

export type PageContext = z.infer<typeof pageContextSchema>;

export interface ParseCommandResult {
  intent: Intent;
  raw: string;
  context: PageContext;
  /** Model used for the parse. */
  model: string;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/* ───────────────────────── Tool definitions ───────────────────────── */

const SYSTEM_PROMPT = `You are the parser behind Mantua's natural-language command bar. Translate a user's request into one of seven structured action intents — or pick \`clarification_needed\` if a parameter is missing or ambiguous, or \`reject\` if the request is off-scope.

You are NOT executing the action. The caller will execute after the user confirms via a preview card and a confirmation modal. Your job is to surface what the user meant; the user catches misparses at the preview stage.

Confidence model (D-014): when you pick an action tool you're committing the parser to "above the 0.85 execute threshold." When you pick \`clarification_needed\` you're committing to "0.65–0.85, ask before executing." When you pick \`reject\` you're committing to "below 0.65, off-scope." You don't output a numeric score — the caller derives it from your tool choice.

Supported tokens (case-sensitive symbols): ${TOKEN_SYMBOLS.join(", ")}.

Notes:
- Amounts are decimal strings in human-readable units (e.g. "1.5" for 1.5 ETH; never atomic / wei).
- Fee tiers are 100 / 500 / 3000 / 10000 (basis points × 100). When the user names a percentage like "0.30%", convert it (3000).
- Hooks: stable_protection (USDC/EURC pair only), dynamic_fee (any pair), or none. Only set when the user explicitly names a hook.
- Recipients can be 0x-prefixed 40-hex addresses or .eth ENS names. Pass through as-is; the executor resolves ENS.
- For \`remove_liquidity\`, \`poolId\` is whatever the user references (a pair name like "USDC/EURC", a tokenId, or "the pool I just opened") — the caller resolves it. Don't fabricate UUIDs.
- For \`add_liquidity\`, both \`amount0\` and \`amount1\` are optional. The user may name only one ("add 100 USDC liquidity to USDC/EURC") and the caller derives the other from the pool's current price.
- For \`query_analytics\`, capture the user's question verbatim — Phase 7's analytics layer interprets it.
- For \`portfolio_summary\`, no parameters needed.

When page context is provided in the user message (e.g. "[on Liquidity page]"), use it to bias your interpretation:
- "remove 50%" + on Liquidity page with a poolId in focus → remove_liquidity with that poolId
- "swap 10" + on Swap page → likely swap; ask for tokenOut if not given
- "create pool" + on Liquidity page → create_pool

But page context never overrides explicit user input. If the user says "swap" on the Liquidity page, parse as swap.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "swap",
    description: "Swap one token for another. Input is denominated in tokenIn.",
    input_schema: {
      type: "object",
      properties: {
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
        amountIn: { type: "string", description: "Decimal amount, human-readable units." },
      },
      required: ["tokenIn", "tokenOut", "amountIn"],
    },
  },
  {
    name: "add_liquidity",
    description: "Add liquidity to an existing Uniswap v4 pool.",
    input_schema: {
      type: "object",
      properties: {
        token0: { type: "string" },
        token1: { type: "string" },
        amount0: { type: "string", description: "Decimal amount of token0 (optional)." },
        amount1: { type: "string", description: "Decimal amount of token1 (optional)." },
        feeTier: { type: "integer", enum: [100, 500, 3000, 10_000] },
        hook: {
          type: "string",
          enum: ["stable_protection", "dynamic_fee", "none"],
        },
      },
      required: ["token0", "token1"],
    },
  },
  {
    name: "remove_liquidity",
    description: "Remove a percentage of liquidity from a position.",
    input_schema: {
      type: "object",
      properties: {
        poolId: {
          type: "string",
          description: "User reference: pair name, tokenId, or descriptive phrase.",
        },
        percentage: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["poolId", "percentage"],
    },
  },
  {
    name: "create_pool",
    description: "Initialize a new Uniswap v4 pool with the given fee tier and optional hook.",
    input_schema: {
      type: "object",
      properties: {
        token0: { type: "string" },
        token1: { type: "string" },
        feeTier: { type: "integer", enum: [100, 500, 3000, 10_000] },
        hook: {
          type: "string",
          enum: ["stable_protection", "dynamic_fee", "none"],
        },
      },
      required: ["token0", "token1", "feeTier"],
    },
  },
  {
    name: "send_tokens",
    description: "Send tokens to an arbitrary address or ENS name.",
    input_schema: {
      type: "object",
      properties: {
        token: { type: "string" },
        amount: { type: "string" },
        recipient: { type: "string", description: "0x address or .eth name." },
      },
      required: ["token", "amount", "recipient"],
    },
  },
  {
    name: "query_analytics",
    description: "Surface an analytics question to the Phase 7 analytics layer.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "portfolio_summary",
    description: "Show the user's portfolio summary (balances + history).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "clarification_needed",
    description:
      "Use when the rough intent is clear but a required parameter is missing or ambiguous (mid-band confidence).",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Specific question to ask the user." },
        suggestedAction: {
          type: "string",
          enum: [
            "swap",
            "add_liquidity",
            "remove_liquidity",
            "create_pool",
            "send_tokens",
            "query_analytics",
            "portfolio_summary",
          ],
          description: "Optional: the action this clarification is for.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "reject",
    description:
      "Use when the request is off-scope (not one of the supported actions) or uninterpretable.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
];

const MODEL = "claude-sonnet-4-6";

const ACTION_CONFIDENCE = 0.95;
const CLARIFY_CONFIDENCE = 0.75;
const REJECT_CONFIDENCE = 0.4;

interface ToolUseInput {
  [k: string]: unknown;
}

function toIntent(name: string, input: ToolUseInput): Intent {
  const conf = ACTION_CONFIDENCE;
  switch (name) {
    case "swap":
      return {
        action: "swap",
        tokenIn: String(input["tokenIn"]),
        tokenOut: String(input["tokenOut"]),
        amountIn: String(input["amountIn"]),
        confidence: conf,
      };
    case "add_liquidity":
      return {
        action: "add_liquidity",
        token0: String(input["token0"]),
        token1: String(input["token1"]),
        ...(typeof input["amount0"] === "string" ? { amount0: input["amount0"] } : {}),
        ...(typeof input["amount1"] === "string" ? { amount1: input["amount1"] } : {}),
        ...(typeof input["feeTier"] === "number"
          ? { feeTier: input["feeTier"] as 100 | 500 | 3000 | 10_000 }
          : {}),
        ...(typeof input["hook"] === "string"
          ? { hook: input["hook"] as Intent extends { hook?: infer H } ? H : never }
          : {}),
        confidence: conf,
      };
    case "remove_liquidity":
      return {
        action: "remove_liquidity",
        poolId: String(input["poolId"]),
        percentage: Number(input["percentage"]),
        confidence: conf,
      };
    case "create_pool":
      return {
        action: "create_pool",
        token0: String(input["token0"]),
        token1: String(input["token1"]),
        feeTier: input["feeTier"] as 100 | 500 | 3000 | 10_000,
        ...(typeof input["hook"] === "string"
          ? { hook: input["hook"] as Intent extends { hook?: infer H } ? H : never }
          : {}),
        confidence: conf,
      };
    case "send_tokens":
      return {
        action: "send_tokens",
        token: String(input["token"]),
        amount: String(input["amount"]),
        recipient: String(input["recipient"]),
        confidence: conf,
      };
    case "query_analytics":
      return {
        action: "query_analytics",
        question: String(input["question"]),
        confidence: conf,
      };
    case "portfolio_summary":
      return { action: "portfolio_summary", confidence: conf };
    case "clarification_needed":
      return {
        action: "clarification_needed",
        message: String(input["message"]),
        ...(typeof input["suggestedAction"] === "string"
          ? {
              suggestedAction: input["suggestedAction"] as Extract<
                Intent,
                { action: "clarification_needed" }
              >["suggestedAction"],
            }
          : {}),
        confidence: CLARIFY_CONFIDENCE,
      };
    case "reject":
      return {
        action: "reject",
        reason: String(input["reason"]),
        confidence: REJECT_CONFIDENCE,
      };
    default:
      return {
        action: "reject",
        reason: `Unknown tool selected: ${name}`,
        confidence: REJECT_CONFIDENCE,
      };
  }
}

/**
 * Render page context as a tagged prefix on the user message. The LLM
 * sees something like:
 *
 *   [Context: page=liquidity poolId=abc123 note="user just opened a USDC/EURC position"]
 *   add 100 more
 *
 * Format is short and structured so it doesn't dominate the user's
 * actual text. Empty / undefined context returns the user text
 * unchanged.
 */
function renderContext(text: string, context: PageContext): string {
  if (!context) return text;
  const parts: string[] = [];
  if (context.page) parts.push(`page=${context.page}`);
  if (context.poolId) parts.push(`poolId=${context.poolId}`);
  if (context.tokenInFocus) parts.push(`tokenInFocus=${context.tokenInFocus}`);
  if (context.note) parts.push(`note="${context.note}"`);
  if (parts.length === 0) return text;
  return `[Context: ${parts.join(" ")}]\n${text}`;
}

export async function parseCommand(
  text: string,
  context?: PageContext,
): Promise<ParseCommandResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      intent: { action: "reject", reason: "Empty command.", confidence: REJECT_CONFIDENCE },
      raw: text,
      context,
      model: MODEL,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }

  const client = getAnthropic();
  const userText = renderContext(trimmed, context);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16_000,
    tool_choice: { type: "any" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: TOOLS,
    messages: [{ role: "user", content: userText }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const intent: Intent = toolUse
    ? toIntent(toolUse.name, toolUse.input as ToolUseInput)
    : {
        action: "reject",
        reason: "Model did not select a tool. Treating as off-scope.",
        confidence: REJECT_CONFIDENCE,
      };

  return {
    intent,
    raw: text,
    context,
    model: MODEL,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}
