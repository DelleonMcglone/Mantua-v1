import { getCircleClient } from "./client.ts";
import { assertAllowedTarget } from "./allowed-targets.ts";

/**
 * Circle Developer-Controlled Wallets execution layer for Base.
 *
 * Every agent write op (send / swap / add-liquidity / ERC-8004 / ERC-8183)
 * funnels through here: build the call, submit it from the agent's Circle
 * wallet, and poll until the transaction has an on-chain hash. Gas is
 * sponsored by Circle Gas Station, so no native-token funding
 * dance is needed.
 */

export interface CircleExecResult {
  /** Circle transaction id (for status/audit). */
  id: string;
  txHash: `0x${string}`;
}

/** Terminal failure states from the Circle transaction state machine. */
const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

/**
 * Poll a Circle transaction until it has an on-chain hash, or throw on a
 * terminal failure / timeout. txHash appears once the tx is broadcast
 * (SENT), well before COMPLETE — return as soon as it's available.
 */
async function pollForTxHash(id: string): Promise<`0x${string}`> {
  const client = await getCircleClient();
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const { data } = await client.getTransaction({ id });
    const tx = data?.transaction;
    const state = tx?.state;
    if (state && FAILED_STATES.has(state)) {
      throw new Error(
        `Circle transaction ${id} ${state}${tx.errorReason ? `: ${tx.errorReason}` : ""}`,
      );
    }
    if (tx?.txHash) return tx.txHash as `0x${string}`;
  }
  throw new Error(`Circle transaction ${id} timed out waiting for a tx hash`);
}

/**
 * Execute a contract call from the agent's Circle wallet using raw calldata
 * (the path for our viem-built v4 swap / add-liquidity calldata). `value` is
 * the native amount in human units (e.g. "0.01"); omit for non-payable calls.
 */
export async function executeAgentCalldata(args: {
  walletId: string;
  to: `0x${string}`;
  callData: `0x${string}`;
  value?: string;
}): Promise<CircleExecResult> {
  // B8-006 — single choke point: the agent's wallet only calls contracts
  // the server explicitly trusts, no matter what upstream produced `to`.
  assertAllowedTarget(args.to);
  const created = await (
    await getCircleClient()
  ).createContractExecutionTransaction({
    walletId: args.walletId,
    contractAddress: args.to,
    callData: args.callData,
    ...(args.value ? { amount: args.value } : {}),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const id = created.data?.id;
  if (!id) throw new Error("Circle createContractExecutionTransaction returned no id");
  return { id, txHash: await pollForTxHash(id) };
}

/**
 * Execute a contract call by ABI signature + params (the path for simple calls
 * like ERC-20 transfer / approve, ERC-8004 register, etc.). Circle encodes the
 * calldata server-side.
 */
export async function executeAgentAbiCall(args: {
  walletId: string;
  to: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: (string | number | boolean | string[])[];
}): Promise<CircleExecResult> {
  // B8-006 — same gate as the calldata path.
  assertAllowedTarget(args.to);
  const created = await (
    await getCircleClient()
  ).createContractExecutionTransaction({
    walletId: args.walletId,
    contractAddress: args.to,
    abiFunctionSignature: args.abiFunctionSignature,
    abiParameters: args.abiParameters,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const id = created.data?.id;
  if (!id) throw new Error("Circle createContractExecutionTransaction returned no id");
  return { id, txHash: await pollForTxHash(id) };
}
