/**
 * ERC-8183 action provider — AgenticCommerce job contracts + USDC escrow
 * on Base. Actions: create_job, fund_job (USDC escrow), settle_job,
 * get_job_status. All USDC amounts go through the 6-decimal ERC-20
 * interface; recipients/amounts are validated before any tx.
 *
 * Role note: the verified contract flow is client `createJob` → provider
 * `setBudget` → client `approve`+`fund` → provider `submit` → evaluator
 * `complete`. So create and fund are exposed as two actions (a provider
 * must set the budget in between); settle_job maps to `complete`.
 */
import { encodeFunctionData } from "viem";
import { z } from "zod";
import { type ActionProvider, type AgentWallet, customActionProvider } from "../lib/action-kit.ts";
import { AGENTIC_COMMERCE_ABI } from "../abis/erc8183.ts";
import { ERC20_ABI } from "../abis/erc20.ts";
import { BASE_EXPLORER_URL } from "../config/base-chain.ts";
import type { Asset } from "../config/assets.ts";
import { toUsdcUnits } from "../lib/decimals.ts";
import { requireAddress, requirePositiveAmount } from "../lib/validate.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const EMPTY = "0x" as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
const txUrl = (h: string): string => `${BASE_EXPLORER_URL}/tx/${h}`;

export interface Erc8183Config {
  agenticCommerce: `0x${string}`;
  /** The USDC asset (6-dp ERC-20) used to fund escrow. */
  usdc: Asset;
}

const createJobSchema = z.object({
  provider: z.string(),
  evaluator: z.string(),
  description: z.string().min(1),
  hook: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
});
const fundJobSchema = z.object({
  jobId: z.string().regex(/^\d+$/, "jobId must be a number"),
  amountUSDC: z.string(),
});
const settleJobSchema = z.object({
  jobId: z.string().regex(/^\d+$/, "jobId must be a number"),
  reason: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});
const jobIdSchema = z.object({ jobId: z.string().regex(/^\d+$/, "jobId must be a number") });

export function createErc8183ActionProvider(cfg: Erc8183Config): ActionProvider {
  return customActionProvider([
    {
      name: "create_job",
      description:
        "Create an ERC-8183 job on Base. Specify the provider and evaluator addresses, a description, and optionally a hook address and expiry. Funding is a separate step (fund_job) after the provider sets the budget.",
      schema: createJobSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const args = createJobSchema.parse(raw);
        const provider = requireAddress(args.provider, "provider");
        const evaluator = requireAddress(args.evaluator, "evaluator");
        const hook = args.hook ? requireAddress(args.hook, "hook") : ZERO;
        const expiredAt = BigInt(
          Math.floor(Date.now() / 1000) + (args.expiresInSeconds ?? 604_800),
        );
        const data = encodeFunctionData({
          abi: AGENTIC_COMMERCE_ABI,
          functionName: "createJob",
          args: [provider, evaluator, expiredAt, args.description, hook],
        });
        const hash = await wallet.sendTransaction({ to: cfg.agenticCommerce, data });
        await wallet.waitForTransactionReceipt(hash);
        const count = await wallet.readContract({
          address: cfg.agenticCommerce,
          abi: AGENTIC_COMMERCE_ABI,
          functionName: "jobCounter",
        });
        const jobId = count > 0n ? count - 1n : count;
        return `Created job ${String(jobId)}. Tx: ${txUrl(hash)}. Next: provider sets budget, then call fund_job.`;
      },
    },
    {
      name: "fund_job",
      description:
        "Fund an ERC-8183 job's escrow with USDC (6-decimal ERC-20). Approves the AgenticCommerce contract then funds. Amount must equal the budget set by the provider.",
      schema: fundJobSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const args = fundJobSchema.parse(raw);
        requirePositiveAmount(args.amountUSDC, "amountUSDC");
        const units = toUsdcUnits(args.amountUSDC);
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [cfg.agenticCommerce, units],
        });
        const approveHash = await wallet.sendTransaction({
          to: cfg.usdc.address,
          data: approveData,
        });
        await wallet.waitForTransactionReceipt(approveHash);
        const fundData = encodeFunctionData({
          abi: AGENTIC_COMMERCE_ABI,
          functionName: "fund",
          args: [BigInt(args.jobId), EMPTY],
        });
        const fundHash = await wallet.sendTransaction({ to: cfg.agenticCommerce, data: fundData });
        await wallet.waitForTransactionReceipt(fundHash);
        return `Funded job ${args.jobId} escrow with ${args.amountUSDC} USDC. approve: ${txUrl(approveHash)} · fund: ${txUrl(fundHash)}`;
      },
    },
    {
      name: "settle_job",
      description:
        "Settle an ERC-8183 job (evaluator `complete`), releasing the USDC escrow to the provider. Optional reason is a 0x 32-byte hash.",
      schema: settleJobSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const args = settleJobSchema.parse(raw);
        const reason = (args.reason ?? ZERO_BYTES32) as `0x${string}`;
        const data = encodeFunctionData({
          abi: AGENTIC_COMMERCE_ABI,
          functionName: "complete",
          args: [BigInt(args.jobId), reason, EMPTY],
        });
        const hash = await wallet.sendTransaction({ to: cfg.agenticCommerce, data });
        await wallet.waitForTransactionReceipt(hash);
        return `Settled job ${args.jobId} — escrow released. Tx: ${txUrl(hash)}`;
      },
    },
    {
      name: "get_job_status",
      description: "Read whether an ERC-8183 job has its budget set (escrow funding precondition).",
      schema: jobIdSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const { jobId } = jobIdSchema.parse(raw);
        const hasBudget = await wallet.readContract({
          address: cfg.agenticCommerce,
          abi: AGENTIC_COMMERCE_ABI,
          functionName: "jobHasBudget",
          args: [BigInt(jobId)],
        });
        return `Job ${jobId}: budget set = ${String(hasBudget)}.`;
      },
    },
  ]);
}
