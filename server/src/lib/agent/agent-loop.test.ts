import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.AGENT_MODE = "user_testing";

const { runAgentChat } = await import("../agent-chat.ts");
const { ConfirmationStore, argsHash } = await import("./confirmation-store.ts");
const { DEFAULT_POLICY } = await import("./policy.ts");
type AgentLoopDeps = import("../agent-chat.ts").AgentLoopDeps;
type AgentChatEvent = import("../agent-chat.ts").AgentChatEvent;

/**
 * Phase 8 / A-017 — the agent loop test. The REAL `runAgentChat` runs with
 * a scripted model at the Anthropic seam and the production `executeTool`
 * for the refusal cases (the gate refuses before any wallet or chain I/O),
 * so what is proven is the loop itself: the per-turn system context the
 * model reads, the tool dispatch, the refusal surfaced as a tool error and
 * fed back, the second round, and the confirmation plumbing from the
 * user's message to the executing tool's turn context.
 */

interface Round {
  /** Decide the round's content from the request the loop sent. */
  reply: (req: Record<string, unknown>) => {
    tool?: { name: string; input: Record<string, unknown> };
    text?: string;
  };
}

/** A fake `messages.stream()`: async-iterable text deltas + finalMessage(). */
function scriptedModel(rounds: Round[]): {
  client: () => Pick<Anthropic, "messages">;
  requests: Record<string, unknown>[];
} {
  const requests: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    messages: {
      stream: (req: Record<string, unknown>) => {
        // Snapshot: the loop mutates its `messages` array after the call.
        requests.push({ ...req, messages: [...(req["messages"] as unknown[])] });
        const round = rounds[Math.min(i, rounds.length - 1)];
        i += 1;
        const out = round.reply(req);
        const content: unknown[] = [];
        if (out.text !== undefined) content.push({ type: "text", text: out.text });
        if (out.tool) {
          content.push({
            type: "tool_use",
            id: `tu_${String(i)}`,
            name: out.tool.name,
            input: out.tool.input,
          });
        }
        const events = out.text
          ? [{ type: "content_block_delta", delta: { type: "text_delta", text: out.text } }]
          : [];
        return {
          [Symbol.asyncIterator]: async function* () {
            await Promise.resolve();
            for (const ev of events) yield ev;
          },
          finalMessage: () =>
            Promise.resolve({ content, stop_reason: out.tool ? "tool_use" : "end_turn" }),
        };
      },
    },
  };
  return { client: () => client as unknown as Pick<Anthropic, "messages">, requests };
}

function systemText(req: Record<string, unknown>): string {
  const sys = req["system"] as { text: string }[];
  return sys.map((b) => b.text).join("\n");
}

function baseDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps & { persisted: unknown[] } {
  const persisted: unknown[] = [];
  return {
    ensureWallet: () =>
      Promise.resolve({
        address: "0xAbCd000000000000000000000000000000000001",
        circleWalletId: "cw_1",
      } as unknown as Awaited<ReturnType<NonNullable<AgentLoopDeps["ensureWallet"]>>>),
    resolveUser: () => Promise.resolve("usr_1"),
    ensureSession: () => Promise.resolve("sess_1"),
    loadHistory: () => Promise.resolve([]),
    persist: (row) => {
      persisted.push(row);
      return Promise.resolve();
    },
    readPolicy: () => Promise.resolve(DEFAULT_POLICY),
    audit: () => Promise.resolve(),
    store: new ConfirmationStore({ client: null }),
    persisted,
    ...over,
  };
}

type ToolResultEvent = Extract<AgentChatEvent, { type: "tool_result" }>;
const isToolResult = (e: AgentChatEvent): e is ToolResultEvent => e.type === "tool_result";

async function collect(gen: AsyncGenerator<AgentChatEvent>): Promise<AgentChatEvent[]> {
  const out: AgentChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

void describe("A-017 — the agent loop with the execution gate", () => {
  void it("a money tool without the user's confirm is refused inside the loop, fed back, and the model gets a second round", async () => {
    const model = scriptedModel([
      {
        reply: () => ({
          tool: {
            name: "mantua_execute_trade",
            input: { providerEventId: "401", outcomeIndex: 0, amount: "10" },
          },
        }),
      },
      { reply: () => ({ text: "I need your explicit confirm before placing that." }) },
    ]);
    const deps = baseDeps({ client: model.client });
    const events = await collect(
      runAgentChat({ privyUserId: "did:privy:u1", message: "buy 10 USDC of the Falcons" }, deps),
    );
    // Turn context told the model no confirmation is present.
    assert.equal(model.requests.length, 2);
    assert.match(systemText(model.requests[0]), /Agent mode: USER_TESTING/);
    assert.match(systemText(model.requests[0]), /No confirmation is present/);
    // The loop dispatched, the gate refused (no I/O), the error streamed and was fed back.
    const start = events.find((e) => e.type === "tool_start");
    assert.equal(start?.type === "tool_start" && start.tool, "mantua_execute_trade");
    const result = events.find(isToolResult);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /requires the user's explicit confirmation/);
    const fedBack = (model.requests[1]["messages"] as { role: string; content: unknown }[]).at(-1);
    assert.equal(fedBack?.role, "user");
    assert.match(JSON.stringify(fedBack?.content), /is_error/);
    // Second round's text streamed and both turns persisted, steps included.
    assert.ok(events.some((e) => e.type === "text" && /explicit confirm/.test(e.delta)));
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(deps.persisted.length, 2);
    const assistant = deps.persisted[1] as {
      role: string;
      parsedIntent: { steps: { ok: boolean }[] };
    };
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.parsedIntent.steps[0].ok, false);
  });

  void it("a fabricated confirmation id is refused as invalid", async () => {
    const model = scriptedModel([
      {
        reply: () => ({
          tool: {
            name: "mantua_execute_trade",
            input: {
              providerEventId: "401",
              outcomeIndex: 0,
              amount: "10",
              confirmationId: "made-up",
            },
          },
        }),
      },
      { reply: () => ({ text: "That id was not issued by the server." }) },
    ]);
    const events = await collect(
      runAgentChat(
        { privyUserId: "did:privy:u1", message: "just do it" },
        baseDeps({ client: model.client }),
      ),
    );
    const result = events.find(isToolResult);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not one the server issued/);
  });

  void it("the user's own 'confirm' mints an id the model reads from the context and the executing tool receives in its turn", async () => {
    const store = new ConfirmationStore({ client: null });
    const args = { to: "0x4444444444444444444444444444444444444444", token: "USDC", amount: "5" };
    await store.savePreview({
      sessionId: "sess_1",
      kind: "action",
      tool: "send",
      argsHash: argsHash("send", args),
      simulation: null,
      summary: "send 5 USDC",
    });
    const model = scriptedModel([
      {
        reply: (req) => {
          const id = /Confirmation id: (\S+)\./.exec(systemText(req))?.[1];
          assert.ok(id, "the model reads the id from the system context");
          return { tool: { name: "send", input: { ...args, confirmationId: id } } };
        },
      },
      { reply: () => ({ text: "Sent." }) },
    ]);
    const received: {
      name: string;
      args: Record<string, unknown>;
      confirmationId: string | null;
    }[] = [];
    const events = await collect(
      runAgentChat(
        { privyUserId: "did:privy:u1", message: "confirm" },
        baseDeps({
          client: model.client,
          store,
          execute: (_u, _w, name, input, _m, _c, turn) => {
            received.push({
              name,
              args: input,
              confirmationId: turn?.confirmation?.confirmationId ?? null,
            });
            return Promise.resolve({ ok: true });
          },
        }),
      ),
    );
    assert.match(systemText(model.requests[0]), /EXPLICITLY CONFIRMED/);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.name, "send");
    assert.equal(received[0]?.args["confirmationId"], received[0]?.confirmationId);
    assert.ok(
      typeof received[0]?.confirmationId === "string" && received[0].confirmationId.length > 0,
    );
    const result = events.find(isToolResult);
    assert.ok(result?.ok);
    // The preview was spent: a second 'confirm' turn mints nothing.
    assert.equal(await store.pendingPreview("sess_1"), null);
  });
});
