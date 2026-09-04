import { randomUUID } from "node:crypto";
import type {
  CreateContractExecutionTransactionInput,
  TransactionState,
} from "@circle-fin/developer-controlled-wallets";
import { getCircleClient } from "./client.ts";
import { assertAllowedTarget } from "./allowed-targets.ts";
import { assertSponsorshipConfigured, sponsorshipRefId } from "./sponsorship.ts";

export type { TransactionState };
/** The receipt states — Circle's terminal success values. */
export type ConfirmedTransactionState = Extract<TransactionState, "CONFIRMED" | "COMPLETE">;

/**
 * Circle Developer-Controlled Wallets execution layer for Base.
 *
 * Every agent write op (send / swap / add-liquidity / ERC-8004 / ERC-8183)
 * funnels through here: build the call, submit it from the agent's Circle
 * wallet, and poll until the transaction reaches a TERMINAL state. Gas is
 * sponsored by Circle Gas Station, so no native-token funding dance is
 * needed.
 *
 * C-015 — receipts, not broadcasts. Circle's state machine is
 * INITIATED → CLEARED → QUEUED → SENT → CONFIRMED → COMPLETE (plus STUCK
 * and the terminal failures FAILED / CANCELLED / DENIED). A txHash appears
 * at SENT — broadcast, not mined — so a hash alone says nothing about the
 * outcome. The helpers below resolve ONLY on CONFIRMED/COMPLETE:
 *
 *   - failed/reverted  → `CircleTransactionFailedError` (typed, carries the
 *     state and Circle's errorReason — a revert is a failure, never a win)
 *   - bounded timeout  → `CircleReceiptTimeoutError`; callers report a
 *     PENDING outcome and may never report success. The durable webhook
 *     finalizer (`routes/circle-webhook.ts`) resolves these later.
 *
 * Mutating SDK calls carry a UUID v4 idempotency key per the 018 follow-up,
 * so a transport-level retry of the create cannot mint two transactions.
 */

export interface CircleExecResult {
  /** Circle transaction id (for status/audit). */
  id: string;
  txHash: `0x${string}`;
  /** Terminal success state the receipt resolved at. */
  state: ConfirmedTransactionState;
}

/** Terminal success states (the receipt) — actual SDK `TransactionState` values. */
const SUCCESS_STATES: readonly TransactionState[] = ["CONFIRMED", "COMPLETE"];

/** Terminal failure states — includes on-chain reverts (FAILED + errorReason). */
const FAILED_STATES: readonly TransactionState[] = ["FAILED", "CANCELLED", "DENIED"];

/** Raised when a Circle transaction terminates in a failed/reverted state. */
export class CircleTransactionFailedError extends Error {
  readonly circleTxId: string;
  readonly state: TransactionState;
  readonly errorReason: string | null;

  constructor(circleTxId: string, state: TransactionState, errorReason: string | null) {
    super(`Circle transaction ${circleTxId} ${state}${errorReason ? `: ${errorReason}` : ""}`);
    this.name = "CircleTransactionFailedError";
    this.circleTxId = circleTxId;
    this.state = state;
    this.errorReason = errorReason;
  }
}

/**
 * Raised when the bounded poll ends without a terminal state. The outcome is
 * PENDING: the transaction may still confirm (or fail) after this returns —
 * callers must not report success OR a definite failure from it.
 */
export class CircleReceiptTimeoutError extends Error {
  readonly circleTxId: string;
  readonly timeoutMs: number;
  /** Broadcast hash, if the tx got as far as SENT before the poll ended. */
  readonly txHash: string | null;

  constructor(circleTxId: string, timeoutMs: number, txHash: string | null) {
    super(
      `Circle transaction ${circleTxId} did not reach a terminal state within ${String(timeoutMs)}ms — outcome pending, not success`,
    );
    this.name = "CircleReceiptTimeoutError";
    this.circleTxId = circleTxId;
    this.timeoutMs = timeoutMs;
    this.txHash = txHash;
  }
}

export interface AwaitReceiptOptions {
  /** Overall budget; default 60s (matches the Vercel lambda budget). */
  timeoutMs?: number;
  /** Poll interval; default 1.5s. */
  intervalMs?: number;
}

/** Is this a terminal success state (the receipt)? */
export function isTerminalSuccessState(
  state: TransactionState,
): state is ConfirmedTransactionState {
  return SUCCESS_STATES.includes(state);
}

/** Is this a terminal failure state (failed / reverted / denied)? */
export function isTerminalFailureState(state: TransactionState): boolean {
  return FAILED_STATES.includes(state);
}

/**
 * Poll a Circle transaction until it reaches a terminal state. Resolves with
 * the receipt on CONFIRMED/COMPLETE, throws `CircleTransactionFailedError`
 * on FAILED/CANCELLED/DENIED, and `CircleReceiptTimeoutError` on a bounded
 * timeout. STUCK is NOT terminal — Circle can still re-drive the tx, so it
 * (and every pre-SENT state) keeps polling until the budget ends.
 */
/** Minimal view of the Circle client's transaction fetch — the DI seam for tests. */
export interface TransactionFetcher {
  getTransaction: (args: { id: string }) => Promise<{
    data?: {
      transaction?: {
        state?: TransactionState;
        txHash?: string;
        errorReason?: string | null;
      };
    };
  }>;
}

export async function awaitReceipt(
  id: string,
  opts: AwaitReceiptOptions = {},
): Promise<CircleExecResult> {
  const client = await getCircleClient();
  return pollReceipt(id, client.getTransaction.bind(client), opts);
}

/**
 * The poll-to-receipt state machine, parameterized on the transaction
 * fetcher so tests can drive every Circle state without the SDK.
 */
export async function pollReceipt(
  id: string,
  getTransaction: TransactionFetcher["getTransaction"],
  opts: AwaitReceiptOptions = {},
): Promise<CircleExecResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  let lastTxHash: string | null = null;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const { data } = await getTransaction({ id });
    const tx = data?.transaction;
    const state = tx?.state;
    if (tx?.txHash) lastTxHash = tx.txHash;

    if (state && isTerminalFailureState(state)) {
      throw new CircleTransactionFailedError(id, state, tx.errorReason ?? null);
    }
    if (state && isTerminalSuccessState(state)) {
      if (!tx.txHash) {
        // A terminal success without a hash would make the receipt
        // unusable — refuse to fabricate one.
        throw new Error(`Circle transaction ${id} reached ${state} without a txHash`);
      }
      return { id, txHash: tx.txHash as `0x${string}`, state };
    }
  }
  throw new CircleReceiptTimeoutError(id, timeoutMs, lastTxHash);
}

/** Args for creating a contract-execution transaction from the agent wallet. */
interface CreateExecutionArgs {
  walletId: string;
  to: `0x${string}`;
  /** Raw calldata (mutually exclusive with the ABI form, per the Circle API). */
  callData?: `0x${string}`;
  abiFunctionSignature?: string;
  abiParameters?: (string | number | boolean | string[])[];
  /** Native amount in human units (e.g. "0.01"); omit for non-payable calls. */
  value?: string;
}

/**
 * Submit a contract-execution transaction from the agent's Circle wallet
 * WITHOUT waiting for the receipt. Returns as soon as Circle accepts the
 * create, so the caller can persist an execution-ledger row keyed on the
 * Circle transaction id before the (long) receipt wait starts.
 */
export async function createAgentContractExecution(
  args: CreateExecutionArgs,
): Promise<{ id: string }> {
  // B8-006 — single choke point: the agent's wallet only calls contracts
  // the server explicitly trusts, no matter what upstream produced `to`.
  assertAllowedTarget(args.to);
  // C-017 — sponsorship is console-side policy. Production refuses an
  // unsponsored create (the runtime backstop to boot validation), and every
  // transaction carries the operator's policy id as its Circle refId so the
  // console's per-policy sponsored-transactions table can confirm the
  // recorded id is the policy actually sponsoring the code.
  assertSponsorshipConfigured();
  const refId = sponsorshipRefId();
  // The SDK input is a discriminated union: raw callData XOR the ABI form —
  // mixing the two shapes cannot typecheck, so build exactly one arm.
  let input: CreateContractExecutionTransactionInput;
  if (args.callData) {
    input = {
      walletId: args.walletId,
      contractAddress: args.to,
      // UUID v4 idempotency key — a retried create reuses the same key instead
      // of minting a second transaction (018 follow-up).
      idempotencyKey: randomUUID(),
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      ...(refId ? { refId } : {}),
      ...(args.value ? { amount: args.value } : {}),
      callData: args.callData,
    };
  } else if (args.abiFunctionSignature) {
    input = {
      walletId: args.walletId,
      contractAddress: args.to,
      idempotencyKey: randomUUID(),
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      ...(refId ? { refId } : {}),
      ...(args.value ? { amount: args.value } : {}),
      abiFunctionSignature: args.abiFunctionSignature,
      abiParameters: args.abiParameters ?? [],
    };
  } else {
    throw new Error("createAgentContractExecution requires callData or an ABI signature");
  }
  const created = await (await getCircleClient()).createContractExecutionTransaction(input);
  const id = created.data?.id;
  if (!id) throw new Error("Circle createContractExecutionTransaction returned no id");
  return { id };
}

/**
 * Execute a contract call from the agent's Circle wallet using raw calldata
 * (the path for our viem-built v4 swap / add-liquidity calldata). Resolves
 * only on the confirmed receipt — see the module docstring.
 */
export async function executeAgentCalldata(args: {
  walletId: string;
  to: `0x${string}`;
  callData: `0x${string}`;
  value?: string;
  /** Durable-ledger hook: called with the Circle tx id after create, before
   * the receipt wait, so the pending execution is persisted even if this
   * lambda freezes. */
  onCreated?: (id: string) => Promise<void>;
}): Promise<CircleExecResult> {
  const created = await createAgentContractExecution({
    walletId: args.walletId,
    to: args.to,
    callData: args.callData,
    ...(args.value ? { value: args.value } : {}),
  });
  if (args.onCreated) await args.onCreated(created.id);
  return awaitReceipt(created.id);
}

/**
 * Execute a contract call by ABI signature + params (the path for simple calls
 * like ERC-20 transfer / approve, ERC-8004 register, etc.). Circle encodes the
 * calldata server-side. Resolves only on the confirmed receipt.
 */
export async function executeAgentAbiCall(args: {
  walletId: string;
  to: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: (string | number | boolean | string[])[];
}): Promise<CircleExecResult> {
  const created = await createAgentContractExecution({
    walletId: args.walletId,
    to: args.to,
    abiFunctionSignature: args.abiFunctionSignature,
    abiParameters: args.abiParameters,
  });
  return awaitReceipt(created.id);
}
