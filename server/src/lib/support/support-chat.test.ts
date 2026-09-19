import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Task 070 / AE-007 … AE-010 — the support loop over a scripted model:
 * knowledge answers, account context only for a signed-in user,
 * troubleshooting from the platform status, escalation with a ticket id,
 * and no path to any money-moving tool.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { collectSupportReply, runSupportChat } = await import("./support-chat.ts");
const { SUPPORT_TOOLS } = await import("./support-tools.ts");
const { MONEY_TOOLS } = await import("../agent/execution-gate.ts");
type AgentChatEvent = import("../agent-chat.ts").AgentChatEvent;
type SupportDeps = import("./support-chat.ts").SupportDeps;

interface Round {
  text?: string;
  tool?: { name: string; input: Record<string, unknown> };
}

function scriptedModel(rounds: Round[]): {
  client: () => Pick<Anthropic, "messages">;
  requests: Record<string, unknown>[];
} {
  const requests: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    messages: {
      stream: (req: Record<string, unknown>) => {
        requests.push({ ...req, messages: [...(req["messages"] as unknown[])] });
        const round = rounds[Math.min(i, rounds.length - 1)];
        i += 1;
        const content: unknown[] = [];
        if (round.text !== undefined) content.push({ type: "text", text: round.text });
        if (round.tool)
          content.push({
            type: "tool_use",
            id: `tu_${String(i)}`,
            name: round.tool.name,
            input: round.tool.input,
          });
        const events = round.text
          ? [{ type: "content_block_delta", delta: { type: "text_delta", text: round.text } }]
          : [];
        return {
          [Symbol.asyncIterator]: async function* () {
            await Promise.resolve();
            for (const ev of events) yield ev;
          },
          finalMessage: () =>
            Promise.resolve({ content, stop_reason: round.tool ? "tool_use" : "end_turn" }),
        };
      },
    },
  };
  return { client: () => client as unknown as Pick<Anthropic, "messages">, requests };
}

const liveStatus = { mode: "live", trading: "open", reads: "live", message: null };

function deps(
  model: ReturnType<typeof scriptedModel>,
  over: Partial<SupportDeps> = {},
): SupportDeps {
  return {
    client: model.client,
    readAccount: () => Promise.reject(new Error("readAccount must not be called")),
    readStatus: () => Promise.resolve(liveStatus),
    escalate: () => Promise.reject(new Error("escalate must not be called")),
    ...over,
  };
}

async function collect(gen: AsyncGenerator<AgentChatEvent>): Promise<AgentChatEvent[]> {
  const out: AgentChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

void describe("runSupportChat", () => {
  void it("answers a how-it-works question from the knowledge base and streams the text", async () => {
    const model = scriptedModel([
      { tool: { name: "search_help", input: { query: "deposit bank" } } },
      { text: "Bank deposits show pending until the partner confirms them." },
    ]);
    const events = await collect(
      runSupportChat({ message: "how do deposits work", channel: "web", auth: null }, deps(model)),
    );
    const result = events.find((e) => e.type === "tool_result");
    assert.ok(result?.ok);
    const topics = (result.data as { topics: { id: string }[] }).topics;
    assert.equal(topics[0]?.id, "deposits");
    assert.equal(
      events
        .filter((e) => e.type === "text")
        .map((e) => (e as { delta: string }).delta)
        .join(""),
      "Bank deposits show pending until the partner confirms them.",
    );
    assert.equal(events.at(-1)?.type, "done");
    const system = (model.requests[0]["system"] as { text: string }[])
      .map((b) => b.text)
      .join("\n");
    assert.match(system, /NOT signed in/);
  });

  void it("never reads an account for an anonymous user, and reads it once for a signed-in one", async () => {
    const anon = scriptedModel([
      { tool: { name: "get_account_context", input: {} } },
      { text: "Please sign in." },
    ]);
    const events = await collect(
      runSupportChat({ message: "where is my deposit", channel: "web", auth: null }, deps(anon)),
    );
    const r = events.find((e) => e.type === "tool_result");
    assert.ok(r?.ok);
    assert.equal((r.data as { signedIn: boolean }).signedIn, false);

    let reads = 0;
    const account = {
      userId: "u1",
      activity: [],
      transfers: [
        {
          kind: "deposit",
          status: "pending",
          amountUsd: 50,
          failureReason: null,
          recoveryAction: null,
          at: "2026-09-18T00:00:00.000Z",
        },
      ],
      positions: null,
      agent: { hasWallet: true, dailyCapUsd: 100, mode: "user_testing", policy: null },
      troubleshoot: {
        pendingTransfers: 1,
        failedTransfers: 0,
        pendingTrades: 0,
        hasAgentWallet: true,
        agentMode: "user_testing",
        lastFailure: null,
      },
    };
    const signed = scriptedModel([
      { tool: { name: "get_account_context", input: {} } },
      { tool: { name: "troubleshoot", input: { issue: "deposit_pending" } } },
      { text: "Your deposit of $50 is pending." },
    ]);
    const evs = await collect(
      runSupportChat(
        {
          message: "where is my deposit",
          channel: "web",
          auth: { privyUserId: "did:privy:u", walletAddress: "0xabc" },
        },
        deps(signed, {
          readAccount: () => {
            reads += 1;
            return Promise.resolve(account);
          },
        }),
      ),
    );
    assert.equal(reads, 1, "account context is cached across tools in one turn");
    const ts = evs.find(
      (e): e is Extract<AgentChatEvent, { type: "tool_result" }> =>
        e.type === "tool_result" && e.tool === "troubleshoot",
    );
    assert.ok(ts?.ok);
    assert.match((ts.data as { steps: string[] }).steps[0], /1 pending transfer/);
  });

  void it("escalates with a bounded transcript and reports the ticket id in the collected reply", async () => {
    const seen: {
      input: { userId: string | null; channel: string; transcript: unknown[] } | null;
    } = { input: null };
    const model = scriptedModel([
      {
        tool: {
          name: "escalate_to_human",
          input: { category: "trading", summary: "Trade 0xabc stuck pending for an hour." },
        },
      },
      { text: "I've opened ticket for you." },
    ]);
    const reply = await collectSupportReply(
      {
        message: "get me a human",
        history: [
          { role: "user", text: "my trade is stuck" },
          { role: "assistant", text: "let me check" },
        ],
        channel: "api",
        auth: null,
      },
      deps(model, {
        escalate: (input) => {
          seen.input = input;
          return Promise.resolve({ id: "ticket-1", notified: true });
        },
      }),
    );
    assert.equal(reply.ticketId, "ticket-1");
    assert.equal(reply.text, "I've opened ticket for you.");
    assert.ok(seen.input);
    assert.equal(seen.input.userId, null);
    assert.equal(seen.input.channel, "api");
    assert.equal(seen.input.transcript.length, 3);
  });

  void it("feeds an invalid tool call back as an error without stopping the turn", async () => {
    const model = scriptedModel([
      { tool: { name: "escalate_to_human", input: { category: "nope", summary: "x" } } },
      { text: "Sorry, let me try again." },
    ]);
    const events = await collect(
      runSupportChat({ message: "help", channel: "web", auth: null }, deps(model)),
    );
    const r = events.find((e) => e.type === "tool_result");
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /category must be one of/);
    assert.equal(events.at(-1)?.type, "done");
  });

  void it("exposes no money-moving tool", () => {
    for (const t of SUPPORT_TOOLS) assert.ok(!MONEY_TOOLS.has(t.name), t.name);
    assert.deepEqual(
      SUPPORT_TOOLS.map((t) => t.name),
      [
        "search_help",
        "get_account_context",
        "get_platform_status",
        "troubleshoot",
        "escalate_to_human",
      ],
    );
  });
});
