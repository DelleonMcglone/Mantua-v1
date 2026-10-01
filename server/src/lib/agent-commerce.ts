import { encodeFunctionData, formatUnits, parseUnits } from "viem";
import { env } from "../env.ts";
import { explorerTxUrl } from "./agent-send.ts";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import { logAudit } from "./audit.ts";
import { executeAgentAbiCall, executeAgentCalldata } from "./circle/execute.ts";
import { getRpcClient } from "./rpc-client.ts";
import { ARC_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { checkSpendingCap, recordSpending } from "./spending-cap.ts";
import { getToken } from "./tokens.ts";

/**
 * ERC-8183 agent-to-agent commerce from the agent's Circle wallet on Arc.
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

// The ERC-8183 ABI slice the server drives, matching the vendored reference
// implementation the deploy script ships (contracts/lib/base-contracts at
// commit 142e669 — see contracts/script/DeployAgenticCommerce.s.sol). The
// parity test pins it against the compiled artifact.
export const AGENTIC_COMMERCE_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint48" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
      { name: "providerAgentId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "expectedToken", type: "address" },
      { name: "expectedBudget", type: "uint256" },
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
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "status", type: "uint8" },
          { name: "provider", type: "address" },
          { name: "expiredAt", type: "uint48" },
          { name: "evaluator", type: "address" },
          { name: "submittedAt", type: "uint48" },
          { name: "budget", type: "uint256" },
          { name: "hook", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "providerAgentId", type: "uint256" },
          { name: "description", type: "string" },
          { name: "settledAmount", type: "uint256" },
          { name: "payoutReceiver", type: "address" },
        ],
      },
    ],
  },
] as const;

/** ERC-8183 `JobStatus`, in enum order. */
export const JOB_STATUS = [
  "open",
  "funded",
  "submitted",
  "completed",
  "rejected",
  "expired",
] as const;
export type JobStatusName = (typeof JOB_STATUS)[number];

/** The AgenticCommerce contract, or a clean error while the Arc Mainnet
 *  deployment is pending (docs/tasks/v2-roadmap.md). */
function commerceAddress(_chainId: SupportedChainId = ARC_CHAIN_ID): `0x${string}` {
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
  const chainId = args.chainId ?? ARC_CHAIN_ID;
  const contract = commerceAddress(chainId);
  const client = getRpcClient(chainId);
  const wallet = await requireWallet(args.privyUserId, chainId);
  const expiredAt =
    Math.floor(Date.now() / 1000) + (args.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS);
  const callData = encodeFunctionData({
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "createJob",
    // providerAgentId is the optional ERC-8004 identity; Mantua does not
    // register agents there, so 0.
    args: [
      args.provider,
      args.evaluator,
      expiredAt,
      args.description,
      args.hook ?? ZERO_ADDRESS,
      0n,
    ],
  });
  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: contract,
    callData,
  });
  // ERC-8183 assigns `++jobCounter`, so the new job's id IS the counter
  // after this tx. Wait for the receipt first so the read reflects it.
  await client.waitForTransactionReceipt({ hash: txHash });
  const jobId = await client.readContract({
    address: contract,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "jobCounter",
  });
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
    expiresAt: new Date(expiredAt * 1000).toISOString(),
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
  const chainId = args.chainId ?? ARC_CHAIN_ID;
  const contract = commerceAddress(chainId);
  const wallet = await requireWallet(args.privyUserId, chainId);
  const usdc = getToken("USDC", chainId);
  const units = parseUnits(args.amountUsdc, usdc.decimals);
  if (units <= 0n) throw new Error("amountUsdc must be positive");
  // `fund` echoes the stored token and budget back to the contract, which
  // rejects any mismatch (front-running guard). Read them first so the
  // amount the user confirmed is exactly what gets escrowed — no more.
  const job = await getRpcClient(chainId).readContract({
    address: contract,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "getJob",
    args: [BigInt(args.jobId)],
  });
  if (job.paymentToken.toLowerCase() !== usdc.address.toLowerCase()) {
    throw new Error(
      "This job's budget is not denominated in USDC — the provider must set it in USDC.",
    );
  }
  if (job.budget !== units) {
    throw new Error(
      `amountUsdc must equal the budget the provider set (${formatUnits(job.budget, usdc.decimals)} USDC).`,
    );
  }

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
    args: [BigInt(args.jobId), usdc.address, units, EMPTY_BYTES],
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
  const chainId = args.chainId ?? ARC_CHAIN_ID;
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
  /** ERC-8183 lifecycle state, when the job exists. */
  status?: JobStatusName;
  /** The budget the provider set, in USDC units (6dp), when set. */
  budgetUsdc?: string;
  contract: string;
}

/** Read-only: whether the job exists and has its budget set (funding precondition). */
export async function getJobStatus(
  jobId: string,
  chainId: SupportedChainId = ARC_CHAIN_ID,
): Promise<JobStatusResult> {
  const id = BigInt(jobId);
  const contract = commerceAddress(chainId);
  const client = getRpcClient(chainId);
  const count = await client.readContract({
    address: contract,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "jobCounter",
  });
  // Ids are 1-based (`++jobCounter`): job 0 never exists.
  const exists = id >= 1n && id <= count;
  if (!exists) return { jobId, exists, budgetSet: false, contract };
  const job = await client.readContract({
    address: contract,
    abi: AGENTIC_COMMERCE_ABI,
    functionName: "getJob",
    args: [id],
  });
  const budgetSet = job.budget > 0n;
  const usdc = getToken("USDC", chainId);
  return {
    jobId,
    exists,
    budgetSet,
    status: JOB_STATUS[job.status] ?? "open",
    ...(budgetSet ? { budgetUsdc: formatUnits(job.budget, usdc.decimals) } : {}),
    contract,
  };
}
