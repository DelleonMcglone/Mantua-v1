import { encodeFunctionData, parseUnits } from "viem";
import { env } from "../env.ts";
import { explorerTxUrl } from "./agent-send.ts";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import { logAudit } from "./audit.ts";
import { executeAgentAbiCall, executeAgentCalldata } from "./circle/execute.ts";
import { getRpcClient } from "./rpc-client.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { checkSpendingCap, recordSpending } from "./spending-cap.ts";
import { getToken } from "./tokens.ts";

/**
 * ERC-8183 agent-to-agent commerce from the agent's Circle wallet on Base.
 *
 * Ports the AgenticCommerce job/escrow actions from the standalone `agent/`
 * EOA package onto the live product's custody model: calls are viem-encoded
 * and executed via Circle Developer-Controlled Wallets (gas-sponsored), so
 * the same wallet that swaps and pays x402 fees can also hire and settle
 * other agents with USDC escrow.
 *
 * Verified contract flow (roles): client `createJob` → provider `setBudget`
 * → client `approve`+`fund` (USDC escrow) → provider `submit` → evaluator
 * `complete` (releases escrow). This module exposes the client and evaluator
 * sides; the counterparty agent drives its own provider-side steps.
 *
 * Escrow funding is real spending — it passes through the daily spending cap
 * and is recorded in the ledger like a swap or send.
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const EMPTY_BYTES = "0x" as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
/** Default job expiry: 7 days. */
const DEFAULT_EXPIRES_IN_SECONDS = 604_800;

// Local copy of the ERC-8183 ABI. Was a mirror of the standalone agent/
// workspace, which was deleted before it ever shipped (C-018).
const AGENTIC_COMMERCE_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "jobCounter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "jobHasBudget",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "hasBudget", type: "bool" }],
  },
] as const;

/** The AgenticCommerce contract, or a clean error while the Base Mainnet
 *  deployment is pending (docs/tasks/v2-roadmap.md). */
function commerceAddress(_chainId: SupportedChainId = BASE_CHAIN_ID): `0x${string}` {
  const addr = env.AGENTIC_COMMERCE_ADDRESS;
  if (!addr) {
    throw new Error(
      "Agent-to-agent commerce is unavailable: AGENTIC_COMMERCE_ADDRESS is not configured.",
    );
  }
  return addr as `0x${string}`;
}

async function requireWallet(privyUserId: string, chainId: SupportedChainId) {
  const wallet = await getAgentWallet(privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);
  return wallet;
}

export interface CreateJobResult {
  jobId: string;
  txHash: `0x${string}`;
  explorerUrl: string;
  contract: string;
  expiresAt: string;
  next: string;
}

export async function createJobFromAgentWallet(args: {
  privyUserId: string;
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  description: string;
  hook?: `0x${string}` | undefined;
  expiresInSeconds?: number | undefined;
  chainId?: SupportedChainId;
}): Promise<CreateJobResult> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const contract = commerceAddress(chainId);
  const client = getRpcClient(chainId);
  const wallet = await requireWallet(args.privyUserId, chainId);
  const expiredAt = BigInt(
    Math.floor(Date.now() / 1000) + (args.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS),
  );
  const callData = encodeFunctionData({
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "createJob",
    args: [args.provider, args.evaluator, expiredAt, args.description, args.hook ?? ZERO_ADDRESS],
  });
  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: contract,
    callData,
  });
  // jobCounter increments on create; the new job's id is counter - 1. Wait
  // for the receipt first so the read reflects this tx.
  await client.waitForTransactionReceipt({ hash: txHash });
  const count = await client.readContract({
    address: contract,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "jobCounter",
  });
  const jobId = count > 0n ? count - 1n : count;
  await logAudit({
    walletAddress: wallet.address,
    action: "agent_commerce",
    outcome: "success",
    txHash,
    params: {
      event: "create_job",
      jobId: String(jobId),
      provider: args.provider,
      evaluator: args.evaluator,
      description: args.description.slice(0, 200),
    },
  });
  return {
    jobId: String(jobId),
    txHash,
    explorerUrl: explorerTxUrl(txHash, chainId),
    contract,
    expiresAt: new Date(Number(expiredAt) * 1000).toISOString(),
    next: "The provider agent must set the job's budget; then fund the escrow with fund_job.",
  };
}

export interface FundJobResult {
  jobId: string;
  amountUsdc: string;
  approveTxHash: `0x${string}`;
  fundTxHash: `0x${string}`;
  explorerUrl: string;
}

export async function fundJobFromAgentWallet(args: {
  privyUserId: string;
  jobId: string;
  amountUsdc: string;
  chainId?: SupportedChainId;
}): Promise<FundJobResult> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const contract = commerceAddress(chainId);
  const wallet = await requireWallet(args.privyUserId, chainId);
  const usdc = getToken("USDC", chainId);
  const units = parseUnits(args.amountUsdc, usdc.decimals);
  if (units <= 0n) throw new Error("amountUsdc must be positive");

  // Escrow funding is spending: cap-checked before, ledger-recorded after.
  const usdValue = Number(args.amountUsdc);
  await checkSpendingCap(wallet.address, usdValue);

  const { txHash: approveTxHash } = await executeAgentAbiCall({
    walletId: wallet.circleWalletId,
    to: usdc.address,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [contract, units.toString()],
  });
  const callData = encodeFunctionData({
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "fund",
    args: [BigInt(args.jobId), EMPTY_BYTES],
  });
  const { txHash: fundTxHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: contract,
    callData,
  });
  await recordSpending(wallet.address, usdValue);
  await logAudit({
    walletAddress: wallet.address,
    action: "agent_commerce",
    outcome: "success",
    txHash: fundTxHash,
    params: { event: "fund_job", jobId: args.jobId, amountUsdc: args.amountUsdc, usdValue },
  });
  return {
    jobId: args.jobId,
    amountUsdc: args.amountUsdc,
    approveTxHash,
    fundTxHash,
    explorerUrl: explorerTxUrl(fundTxHash, chainId),
  };
}

export interface SettleJobResult {
  jobId: string;
  txHash: `0x${string}`;
  explorerUrl: string;
}

export async function settleJobFromAgentWallet(args: {
  privyUserId: string;
  jobId: string;
  reason?: string | undefined;
  chainId?: SupportedChainId;
}): Promise<SettleJobResult> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const contract = commerceAddress(chainId);
  const wallet = await requireWallet(args.privyUserId, chainId);
  const reason = (args.reason ?? ZERO_BYTES32) as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(reason)) {
    throw new Error("reason must be a 0x 32-byte hash.");
  }
  const callData = encodeFunctionData({
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "complete",
    args: [BigInt(args.jobId), reason, EMPTY_BYTES],
  });
  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: contract,
    callData,
  });
  await logAudit({
    walletAddress: wallet.address,
    action: "agent_commerce",
    outcome: "success",
    txHash,
    params: { event: "settle_job", jobId: args.jobId },
  });
  return { jobId: args.jobId, txHash, explorerUrl: explorerTxUrl(txHash, chainId) };
}

export interface JobStatusResult {
  jobId: string;
  exists: boolean;
  budgetSet: boolean;
  contract: string;
}

/** Read-only: whether the job exists and has its budget set (funding precondition). */
export async function getJobStatus(
  jobId: string,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<JobStatusResult> {
  const id = BigInt(jobId);
  const contract = commerceAddress(chainId);
  const client = getRpcClient(chainId);
  const count = await client.readContract({
    address: contract,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "jobCounter",
  });
  const exists = id < count;
  const budgetSet = exists
    ? await client.readContract({
        address: contract,
        abi: AGENTIC_COMMERCE_ABI,
        functionName: "jobHasBudget",
        args: [id],
      })
    : false;
  return { jobId, exists, budgetSet, contract };
}
