import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, type AgentChatEvent } from "../agent-chat.ts";
import { logger } from "../logger.ts";
import {
  accountReader,
  executeSupportTool,
  productionSupportIo,
  type SupportAuth,
  type SupportIo,
  type SupportTurnParams,
} from "./support-exec.ts";
import { SUPPORT_SYSTEM_PROMPT, SUPPORT_TOOLS } from "./support-tools.ts";

/**
 * Task 070 / AE-007 … AE-010 — the support agent: a read-only Claude loop
 * with a knowledge base, the caller's own account, the platform status,
 * deterministic troubleshooting and a human escalation. Channel-agnostic:
 * the web route streams its events, the JSON route collects them. It has
 * no money-moving tool and cannot be given one from a message.
 */

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 5;

export type { SupportAuth };
export type SupportChatParams = SupportTurnParams;

export interface SupportDeps extends Partial<SupportIo> {
  client?: () => Pick<Anthropic, "messages">;
}

/** One support turn, streamed as `AgentChatEvent`s. */
export async function* runSupportChat(
  params: SupportChatParams,
  overrides: SupportDeps = {},
): AsyncGenerator<AgentChatEvent> {
  const { client: clientFactory, ...ioOverrides } = overrides;
  const io: SupportIo = { ...productionSupportIo, ...ioOverrides };
  const client = (clientFactory ?? getAnthropic)();
  const account = accountReader(params, io);
  // The API needs a user turn first; a channel that replays its own greeting
  // as the opening assistant turn is common, so leading assistant turns drop.
  const history = params.history ?? [];
  const firstUser = history.findIndex((t) => t.role === "user");
  const messages: Anthropic.MessageParam[] = [
    ...(firstUser === -1 ? [] : history.slice(firstUser)).map(
      (t): Anthropic.MessageParam => ({ role: t.role, content: t.text }),
    ),
    { role: "user", content: params.message },
  ];
  const context = `The user is ${params.auth ? "signed in" : "NOT signed in"}; channel: ${params.channel}.`;

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SUPPORT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: context },
  ];
  // One extra round with no tools: when the tool budget runs out the turn
  // still ends in words, never in a silent `done`.
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const closing = round === MAX_TOOL_ROUNDS;
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system,
      ...(closing ? {} : { tools: SUPPORT_TOOLS }),
      messages,
    });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield { type: "text", delta: ev.delta.text };
      }
    }
    const final = await stream.finalMessage();
    messages.push({ role: "assistant", content: final.content });
    if (final.stop_reason !== "tool_use" || closing) break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    )) {
      const args = (tu.input ?? {}) as Record<string, unknown>;
      yield { type: "tool_start", id: tu.id, tool: tu.name, args };
      try {
        const data = await executeSupportTool(tu.name, args, params, io, account);
        yield { type: "tool_result", id: tu.id, tool: tu.name, ok: true, data };
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(data) });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        yield { type: "tool_result", id: tu.id, tool: tu.name, ok: false, error };
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error }),
          is_error: true,
        });
        logger.warn({ err, tool: tu.name }, "support tool failed");
      }
    }
    messages.push({ role: "user", content: results });
  }
  yield { type: "done" };
}

/** The same turn collected into one reply, for channels that cannot stream. */
export async function collectSupportReply(
  params: SupportChatParams,
  overrides: SupportDeps = {},
): Promise<{ text: string; ticketId: string | null }> {
  let text = "";
  let ticketId: string | null = null;
  for await (const ev of runSupportChat(params, overrides)) {
    if (ev.type === "text") text += ev.delta;
    if (ev.type === "tool_result" && ev.tool === "escalate_to_human" && ev.ok) {
      ticketId = (ev.data as { ticketId: string }).ticketId;
    }
  }
  return { text, ticketId };
}
