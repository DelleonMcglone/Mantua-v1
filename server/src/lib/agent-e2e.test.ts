import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * B10-005 — Agent E2E: natural language → parse → preview → confirm →
 * execute → audit entry.
 *
 * One continuous journey composing the SHIPPED links, each stage's output
 * the genuine input of the next:
 *
 *   1. PARSE — the real `parseInstruction` (agent-nlp.ts, the P6-010 layer
 *      behind POST /api/agent/instruction). The NL→intent step in this
 *      codebase IS the model choosing a tool call, so the "parse" stage is
 *      the tool-call dispatch: the Anthropic client is stubbed at the seam
 *      the module exposes (`setAnthropicForTesting`) to emit the tool call
 *      the model would, and the real `toIntent` mapping produces the typed
 *      intent.
 *   2. PREVIEW — the parse payload (amounts + pair) is exactly what the UI
 *      preview card renders; the route contract is parser-only ("the caller
 *      is responsible for executing"). The E2E asserts the invariant that
 *      matters: at preview time ZERO calls have reached the spend/execute
 *      seams — no cap check, no ledger ink, no Circle traffic.
 *   3. CONFIRM — execution is a separate write request, gated by the real
 *      kill-switch middleware (`createKillSwitchGate`). Disengaged, the
 *      confirm request passes; engaged (runtime Redis flag, parsed by the
 *      real `parseKillSwitchFlagReply` path), the SAME message is refused
 *      with 503 KILL_SWITCH_ACTIVE before any parse or spend.
 *   4. EXECUTE — the real `guardSpend` (C-019: price → check → issue →
 *      record, in that order) wraps the receipt-confirmed Circle leg: the
 *      real `pollReceipt` state machine resolves only at CONFIRMED/COMPLETE.
 *      A transaction stuck at SENT (broadcast hash and all) must NOT count
 *      as success and must leave no ledger ink.
 *   5. AUDIT — the real `auditChatToolCall` (the seam the agent chat loop
 *      defers after every mutating tool call) writes the row: action
 *      `agent_swap`, the acting wallet, the parsed args, and the tx hash
 *      that came out of the confirmed receipt.
 *
 * Stubs sit only at seams the shipped code exposes: the Anthropic client
 * (setAnthropicForTesting), the SpendGuardIo daily ledger (a real running
 * ledger fake — check enforces against what record accumulated, the
 * unified-balance.test convention), the Circle TransactionFetcher (the DI
 * seam in circle/execute.ts), and the drizzle `db.insert` entry point for
 * capturing audit rows (the agent-chat.test convention).
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { parseInstruction, setAnthropicForTesting } = await import("./agent-nlp.ts");
const { guardSpend } = await import("./spending-cap.ts");
const { SafetyError } = await import("./errors.ts");
const { pollReceipt, CircleReceiptTimeoutError } = await import("./circle/execute.ts");
const { auditChatToolCall } = await import("./agent-chat.ts");
const { createKillSwitchGate, createRuntimeKillSwitchFlag } = await import(
  "../middleware/kill-switch.ts"
);
const { db } = await import("../db/client.ts");

type SpendGuardIo = import("./spending-cap.ts").SpendGuardIo;
type TransactionFetcher = import("./circle/execute.ts").TransactionFetcher;
type TransactionState = import("./circle/execute.ts").TransactionState;
type RequestHandler = import("express").RequestHandler;

const WALLET = "0xAbCd000000000000000000000000000000000001";
const CHAIN_ID = 8453 as const;
const NL_MESSAGE = "swap 25 USDC into EURC";
const TX = `0x${"c".repeat(64)}`;

// ─── Audit capture (agent-chat.test convention: stub the db facade insert) ──

interface InsertedRow {
  walletAddress: string | null;
  action: string;
  outcome: string;
  params: Record<string, unknown>;
  txHash: string | null;
  chainId: number;
  reason: string | null;
}

const inserted: InsertedRow[] = [];
const realInsert = db.insert.bind(db);
(db as { insert: unknown }).insert = () => ({
  values: (row: InsertedRow) => {
    inserted.push(row);
    return Promise.resolve();
  },
});
after(() => {
  (db as { insert: unknown }).insert = realInsert;
  setAnthropicForTesting(null);
});

beforeEach(() => {
  inserted.length = 0;
});

// ─── Seam fakes ─────────────────────────────────────────────────────────────

/** The model seam: emits the tool call the model would, records the request. */
function stubModel(): { requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: (req: Record<string, unknown>) => {
        requests.push(req);
        return Promise.resolve({
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "swap",
              input: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "25" },
            },
          ],
          usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        });
      },
    },
  };
  setAnthropicForTesting(client as unknown as Anthropic);
  return { requests };
}

/** Real running daily ledger (unified-balance.test's SpendGuardIo fake):
 *  check enforces against what record has accumulated. */
function makeLedgerIo(capUsd: number): { io: SpendGuardIo; calls: string[]; spent: () => number } {
  const calls: string[] = [];
  let spent = 0;
  const io: SpendGuardIo = {
    check: (_address, usd) => {
      calls.push(`check:${String(usd)}`);
      if (spent + usd > capUsd) {
        return Promise.reject(
          new SafetyError(
            "spending_cap_exceeded",
            `Daily cap $${String(capUsd)} would be exceeded ($${String(spent)} already spent today, +$${String(usd)}).`,
            { cap: capUsd, spent, usdAmount: usd },
          ),
        );
      }
      return Promise.resolve();
    },
    record: (_address, usd) => {
      calls.push(`record:${String(usd)}`);
      spent += usd;
      return Promise.resolve();
    },
  };
  return { io, calls, spent: () => spent };
}

/** Scripted Circle transaction states for the REAL pollReceipt to consume. */
function scriptedCircle(states: { state: TransactionState; txHash?: string }[]): {
  fetcher: TransactionFetcher["getTransaction"];
  polls: () => number;
} {
  let polls = 0;
  const fetcher: TransactionFetcher["getTransaction"] = () => {
    const s = states[Math.min(polls, states.length - 1)];
    polls += 1;
    return Promise.resolve({ data: { transaction: { ...s } } });
  };
  return { fetcher, polls: () => polls };
}

/** Drive one request through a middleware gate the way express would. */
async function dispatch(
  gate: RequestHandler,
  method: string,
  path: string,
): Promise<{ nexted: boolean; status: number; body: unknown }> {
  const result = { nexted: false, status: 0, body: undefined as unknown };
  const res = {
    status: (code: number) => {
      result.status = code;
      return res;
    },
    json: (body: unknown) => {
      result.body = body;
    },
  };
  await gate({ method, path } as never, res as never, () => {
    result.nexted = true;
  });
  return result;
}

// ─── The journey ────────────────────────────────────────────────────────────

void describe("B10-005 agent E2E — NL → parse → preview → confirm → execute → audit", () => {
  void it("runs the whole chain: the parsed intent's amounts drive a receipt-confirmed, cap-guarded execution whose tx hash lands in the audit row", async () => {
    const model = stubModel();
    const ledger = makeLedgerIo(100);
    const circle = scriptedCircle([
      { state: "QUEUED" },
      { state: "SENT", txHash: TX }, // broadcast — a hash exists, success does not
      { state: "CONFIRMED", txHash: TX },
    ]);

    // Stage 1 — parse: NL in, typed intent out, through the real parser.
    const parsed = await parseInstruction(NL_MESSAGE);
    assert.equal(parsed.intent.kind, "swap");
    const intent = parsed.intent;
    assert.deepEqual(
      { tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, amountIn: intent.amountIn },
      { tokenIn: "USDC", tokenOut: "EURC", amountIn: "25" },
    );
    // The real parse layer drove the model seam: the NL text went in as the
    // user message, with the swap tool on offer.
    assert.equal(model.requests.length, 1);
    const req = model.requests[0] as { messages: { content: unknown }[]; tools: { name: string }[] };
    assert.equal(req.messages[0].content, NL_MESSAGE);
    assert.ok(req.tools.some((t) => t.name === "swap"));

    // Stage 2 — preview: the parse payload carries what the preview card
    // shows (pair + amount), and NOTHING has executed or spent: zero cap
    // checks, zero ledger ink, zero Circle traffic, zero audit rows.
    assert.deepEqual(ledger.calls, []);
    assert.equal(circle.polls(), 0);
    assert.equal(inserted.length, 0);

    // Stage 3 — confirm: execution is a separate write request through the
    // real kill-switch gate; disengaged, it passes.
    const gate = createKillSwitchGate({ envEngaged: false });
    const confirmed = await dispatch(gate, "POST", "/api/agent/swap");
    assert.equal(confirmed.nexted, true, "with confirm (and no kill switch) execution may proceed");

    // Stage 4 — execute: guardSpend runs price → check → issue → record,
    // and the issue leg resolves through the REAL pollReceipt — success
    // only at CONFIRMED.
    const receipt = await guardSpend(
      () => Promise.resolve(Number(intent.amountIn)), // USDC ≈ $1 — pricing is the strict feed in production
      WALLET,
      async (usd) => {
        assert.equal(usd, 25);
        ledger.calls.push("issue:create");
        return pollReceipt("ctx_1", circle.fetcher, { intervalMs: 1, timeoutMs: 2_000 });
      },
      ledger.io,
    );
    assert.equal(receipt.state, "CONFIRMED");
    assert.equal(receipt.txHash, TX);
    assert.deepEqual(
      ledger.calls,
      ["check:25", "issue:create", "record:25"],
      "C-019 ordering: check, then issue, then record — and the record only after the confirmed receipt",
    );
    assert.equal(ledger.spent(), 25, "the spend is recorded against the cap");
    assert.equal(circle.polls(), 3, "the SENT poll was not accepted as terminal");

    // Stage 5 — audit: the chat executor's real audit seam writes the row
    // with the tool args from the parsed intent and the receipt's tx hash.
    await auditChatToolCall({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      tool: "swap",
      args: { tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, amountIn: intent.amountIn },
      ok: true,
      data: { txHash: receipt.txHash },
    });
    assert.equal(inserted.length, 1);
    const row = inserted[0];
    assert.equal(row.action, "agent_swap");
    assert.equal(row.outcome, "success");
    assert.equal(row.walletAddress, WALLET.toLowerCase());
    assert.equal(row.chainId, CHAIN_ID);
    assert.equal(row.txHash, TX, "the audited hash is the confirmed receipt's hash");
    assert.deepEqual(row.params, {
      tool: "swap",
      args: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "25" },
    });
  });

  void it("kill switch on — the same NL message is refused before parse and before any spend", async () => {
    const model = stubModel();
    const ledger = makeLedgerIo(100);
    const circle = scriptedCircle([{ state: "CONFIRMED", txHash: TX }]);

    // The runtime flag path for real: the Redis client reports "1" and the
    // shipped parse/cache logic (parseKillSwitchFlagReply) engages the gate.
    const runtime = createRuntimeKillSwitchFlag({
      client: { eval: () => Promise.resolve("1") },
    });
    const gate = createKillSwitchGate({ envEngaged: false, runtime });

    // The parse endpoint is itself a POST behind the same gate — the refusal
    // lands before the model is ever consulted.
    const parseAttempt = await dispatch(gate, "POST", "/api/agent/instruction");
    assert.equal(parseAttempt.nexted, false);
    assert.equal(parseAttempt.status, 503);
    assert.equal((parseAttempt.body as { code: string }).code, "KILL_SWITCH_ACTIVE");

    const confirmAttempt = await dispatch(gate, "POST", "/api/agent/swap");
    assert.equal(confirmAttempt.nexted, false);
    assert.equal(confirmAttempt.status, 503);

    assert.equal(model.requests.length, 0, "no model call — the refusal precedes the parse");
    assert.deepEqual(ledger.calls, [], "no cap check, no ink");
    assert.equal(circle.polls(), 0, "no Circle traffic");
    assert.equal(inserted.length, 0);
  });

  void it("cap exhausted — the same parsed intent refuses at check with no ink, and the failure is audited", async () => {
    stubModel();
    const circle = scriptedCircle([{ state: "CONFIRMED", txHash: TX }]);
    const ledger = makeLedgerIo(100);
    // Earlier spending consumed the day's headroom.
    await ledger.io.record(WALLET, 90);
    ledger.calls.length = 0;

    const parsed = await parseInstruction(NL_MESSAGE);
    const intent = parsed.intent;
    if (intent.kind !== "swap") assert.fail("unreachable");

    let issued = false;
    await assert.rejects(
      guardSpend(
        () => Promise.resolve(Number(intent.amountIn)),
        WALLET,
        () => {
          issued = true;
          return pollReceipt("ctx_1", circle.fetcher, { intervalMs: 1, timeoutMs: 2_000 });
        },
        ledger.io,
      ),
      (err: unknown) => err instanceof SafetyError && err.code === "spending_cap_exceeded",
    );
    assert.equal(issued, false, "a failed check never issues");
    assert.deepEqual(ledger.calls, ["check:25"], "refused at check — no issue, no record, no ink");
    assert.equal(ledger.spent(), 90, "the ledger still shows only the earlier spend");
    assert.equal(circle.polls(), 0);

    // The chat executor records the refusal as a failure row (same seam).
    await auditChatToolCall({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      tool: "swap",
      args: { tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, amountIn: intent.amountIn },
      ok: false,
      error: "Daily cap $100 would be exceeded ($90 already spent today, +$25).",
    });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].outcome, "failure");
    assert.match(inserted[0].reason ?? "", /Daily cap/);
    assert.equal(inserted[0].txHash, null);
  });

  void it("a Circle transaction stuck at SENT is not success — the receipt times out, no spend is recorded, and the failure is audited", async () => {
    stubModel();
    const ledger = makeLedgerIo(100);
    // Broadcast forever: hash present, never mined.
    const circle = scriptedCircle([{ state: "SENT", txHash: TX }]);

    const parsed = await parseInstruction(NL_MESSAGE);
    const intent = parsed.intent;
    if (intent.kind !== "swap") assert.fail("unreachable");

    let thrown: unknown;
    try {
      await guardSpend(
        () => Promise.resolve(Number(intent.amountIn)),
        WALLET,
        (usd) => {
          ledger.calls.push(`issue:${String(usd)}`);
          return pollReceipt("ctx_1", circle.fetcher, { intervalMs: 1, timeoutMs: 40 });
        },
        ledger.io,
      );
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof CircleReceiptTimeoutError, "SENT never resolves the receipt");
    assert.equal(thrown.txHash, TX, "the timeout still reports the broadcast hash — pending, not success");
    assert.deepEqual(
      ledger.calls,
      ["check:25", "issue:25"],
      "a failed issue leaves no record ink (C-019)",
    );
    assert.equal(ledger.spent(), 0);
    assert.ok(circle.polls() > 0, "the state machine really polled and refused to call SENT terminal");

    await auditChatToolCall({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      tool: "swap",
      args: { tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, amountIn: intent.amountIn },
      ok: false,
      error: thrown.message,
    });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].outcome, "failure");
    assert.match(inserted[0].reason ?? "", /did not reach a terminal state/);
    assert.equal(inserted[0].txHash, null, "no success hash may be audited for a pending outcome");
  });
});
