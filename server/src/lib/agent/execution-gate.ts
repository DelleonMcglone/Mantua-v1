import type { AgentMode } from "./agent-mode.ts";
import { modePolicy } from "./agent-mode.ts";
import { messageConfirmsAction } from "./confirmation-language.ts";
import {
  argsHash,
  type Confirmation,
  type ConfirmationStore,
  type Preview,
} from "./confirmation-store.ts";
import { materialDrift, type TradeSimulation } from "./trade-simulation.ts";

/**
 * Phase 8 / A-026, A-029 … A-033, A-035 — the execution gate every
 * money-moving tool passes through. The LLM proposes; this decides.
 *
 *   LLM → structured tool call → (this gate: mode, confirmation id, args
 *   match, fresh simulation) → wallet policy + daily cap (inside the tool)
 *   → transaction construction (`buildMarketTrade` etc.) → contract
 *   allowlist (`registerDynamicTargets`) → chain.
 *
 * The turn context is computed ONCE per user message, before the model
 * runs: if the message explicitly confirms and a preview is pending, a
 * confirmation is minted. The model learns the id from the system context
 * and must echo it; it cannot invent one that the store will honor.
 */

/**
 * Tools that move the USER's money. Everything else passes untouched —
 * including `call_paid_service`: x402 data purchases are the agent's own
 * operating spend from its buyer wallet, bounded in code by
 * X402_MAX_CALL_USD per call and X402_DAILY_CAP_USD per day, and the
 * agent has direct marketplace access by design (owner directive, D-114):
 * a "confirm" round trip per $0.01 stats lookup would defeat the point.
 */
export const MONEY_TOOLS: ReadonlySet<string> = new Set([
  "mantua_execute_trade",
  "mantua_sell_position",
  "swap",
  "send",
  "bridge",
  "add_liquidity",
  "remove_liquidity",
  "create_pool",
  "fund_job",
  "create_job",
  "settle_job",
]);

/** `gateway` is mixed: these sub-actions move money. */
const GATEWAY_MONEY_ACTIONS: ReadonlySet<string> = new Set(["deposit", "deposit_base", "spend"]);

export function isMoneyCall(tool: string, args: Record<string, unknown>): boolean {
  if (tool === "gateway") return GATEWAY_MONEY_ACTIONS.has(String(args["action"]));
  return MONEY_TOOLS.has(tool);
}

export interface TurnContext {
  mode: AgentMode;
  sessionId: string;
  /** The user's current message (attestations are checked against it). */
  message: string;
  /** Minted this turn from the user's explicit confirmation, if any. */
  confirmation: Confirmation | null;
  /** Still-pending preview (no confirmation yet), if any. */
  pendingPreview: Preview | null;
  /** The user's policy allows unprompted execution (autonomous mode only). */
  autoTradeEnabled: boolean;
  /** The message was spoken, so it can never carry a confirmation (V-009). */
  spoken: boolean;
}

/**
 * Build the turn context: mint a confirmation when, and only when, the
 * user's own message explicitly confirms a pending preview.
 *
 * Task 069 (V-009) adds one interlock: a **spoken** message never mints a
 * confirmation, whatever words it contains. Transcription can mishear, a
 * microphone can be pressed by accident, and a room can hold someone else's
 * voice — so consent to move money is a deliberate press, not a sound.
 * Speech can still ask for anything, preview anything and research
 * anything; it simply cannot be the last step before execution.
 */
export async function buildTurnContext(
  store: ConfirmationStore,
  input: {
    mode: AgentMode;
    sessionId: string;
    message: string;
    autoTradeEnabled: boolean;
    spoken?: boolean;
  },
): Promise<TurnContext> {
  const spoken = input.spoken ?? false;
  const pending = await store.pendingPreview(input.sessionId);
  let confirmation: Confirmation | null = null;
  if (pending && !spoken && messageConfirmsAction(input.message)) {
    confirmation = await store.mint(input.sessionId, pending, input.message);
  }
  return {
    mode: input.mode,
    sessionId: input.sessionId,
    message: input.message,
    confirmation,
    pendingPreview: confirmation ? null : pending,
    autoTradeEnabled: input.autoTradeEnabled,
    spoken,
  };
}

/** The per-turn system block the model reads. */
export function turnContextPrompt(ctx: TurnContext): string {
  const policy = modePolicy(ctx.mode);
  const lines = [`Agent mode: ${ctx.mode.toUpperCase()}. ${policy.summary}`];
  if (ctx.confirmation) {
    const p = ctx.confirmation.preview;
    lines.push(
      `The user has EXPLICITLY CONFIRMED the pending ${p.kind === "market_trade" ? "trade" : "action"} (${p.summary}). Confirmation id: ${ctx.confirmation.confirmationId}. Execute it now by calling ${p.tool} with confirmationId set to exactly that id and the same parameters as the preview. Do not re-ask.`,
    );
  } else if (ctx.pendingPreview) {
    lines.push(
      `A preview is pending (${ctx.pendingPreview.summary}) and the user has NOT confirmed it in this message. Do not execute. If they want it, ask them to reply with "confirm".`,
    );
  } else {
    lines.push(
      'No confirmation is present in this turn. Money-moving tools will be refused; to act, first preview (mantua_simulate_trade or mantua_preview_action), show the user the numbers, and ask them to reply with "confirm".',
    );
  }
  if (ctx.spoken) {
    lines.push(
      "This message was SPOKEN. A spoken message can never confirm a money-moving action, whatever it says. Answer it, and preview anything it asks for, but if it needs confirming tell the user to press Confirm rather than to say it.",
    );
  }
  return lines.join("\n");
}

export class ExecutionRefusedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ExecutionRefusedError";
    this.code = code;
  }
}

/**
 * Authorize one money-moving call. Returns the confirmation it consumed
 * (null in autonomous mode). Throws `ExecutionRefusedError` otherwise.
 *
 * `freshSimulation` is only for market trades: it re-runs the simulation
 * immediately before execution (A-030) and rejects on material drift.
 */
export async function authorizeExecution(
  store: ConfirmationStore,
  ctx: TurnContext,
  call: { tool: string; args: Record<string, unknown> },
  freshSimulation?: () => Promise<TradeSimulation>,
): Promise<Confirmation | null> {
  const policy = modePolicy(ctx.mode);
  if (!isMoneyCall(call.tool, call.args)) return null;
  if (!policy.writesAllowed) {
    throw new ExecutionRefusedError(
      "SIMULATION_MODE",
      `${call.tool} was not executed: the agent is in ${ctx.mode} mode. The preview stands; nothing moved.`,
    );
  }
  // Task 069 (V-009): a spoken turn is never autonomous either. Autonomy
  // is a standing arrangement the user set up by hand; letting a
  // transcription trigger it would make speech a stronger path than
  // typing rather than an equal one.
  const autonomous = !policy.confirmationRequired && ctx.autoTradeEnabled && !ctx.spoken;
  if (!autonomous) {
    const presented = call.args["confirmationId"];
    if (typeof presented !== "string" || presented.length === 0) {
      throw new ExecutionRefusedError(
        "CONFIRMATION_REQUIRED",
        `${call.tool} requires the user's explicit confirmation. Preview first, then ask the user to reply "confirm"; the server issues the confirmation id.`,
      );
    }
    if (!ctx.confirmation || ctx.confirmation.confirmationId !== presented) {
      throw new ExecutionRefusedError(
        "CONFIRMATION_INVALID",
        "The confirmation id is not one the server issued for this turn. Nothing was executed.",
      );
    }
    const c = await store.take(presented);
    if (!c) {
      throw new ExecutionRefusedError(
        "CONFIRMATION_EXPIRED",
        "The confirmation has expired or was already used. Preview again and ask the user to confirm again.",
      );
    }
    if (c.preview.tool !== call.tool) {
      throw new ExecutionRefusedError(
        "CONFIRMATION_MISMATCH",
        `The user confirmed ${c.preview.tool}, not ${call.tool}. Nothing was executed.`,
      );
    }
    if (c.preview.kind === "action" && c.preview.argsHash !== argsHash(call.tool, call.args)) {
      throw new ExecutionRefusedError(
        "CONFIRMATION_MISMATCH",
        "The call's parameters differ from the preview the user confirmed. Nothing was executed; preview again.",
      );
    }
    if (c.preview.kind === "market_trade") {
      if (!c.preview.simulation || !freshSimulation) {
        throw new ExecutionRefusedError(
          "CONFIRMATION_MISMATCH",
          "The confirmation does not carry a trade simulation. Nothing was executed.",
        );
      }
      const fresh = await freshSimulation();
      const drift = materialDrift(c.preview.simulation, fresh);
      if (drift.length > 0) {
        throw new ExecutionRefusedError(
          "SIMULATION_DRIFT",
          `The market moved since the user confirmed — not executing: ${drift.join("; ")}. Show the user the new numbers and ask again.`,
        );
      }
    }
    return c;
  }
  // Autonomous: no confirmation, but a fresh, executable simulation is still
  // the entry ticket for market trades.
  if (freshSimulation) {
    const fresh = await freshSimulation();
    if (!fresh.executable) {
      throw new ExecutionRefusedError(
        "NOT_EXECUTABLE",
        `Not executable: ${fresh.blockers.join("; ")}`,
      );
    }
  }
  return null;
}

/** Add the optional `confirmationId` property to a money tool's schema. */
export function withConfirmationId<T extends { input_schema: { properties?: unknown } }>(
  tool: T,
): T {
  const existing =
    tool.input_schema.properties && typeof tool.input_schema.properties === "object"
      ? (tool.input_schema.properties as Record<string, unknown>)
      : {};
  const input_schema = {
    ...tool.input_schema,
    properties: {
      ...existing,
      confirmationId: {
        type: "string",
        description:
          "The confirmation id the server issued after the user explicitly confirmed the preview (read it from this turn's context). Required to execute; never invent one.",
      },
    },
  };
  return { ...tool, input_schema };
}
