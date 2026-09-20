import { z } from "zod";

/** Task 073 — request shapes shared by the operator's institution routes. */

export const CUSTODIANS = [
  "anchorage",
  "bitgo",
  "coinbase_prime",
  "fireblocks",
  "copper",
  "other",
] as const;

const usdSchema = z.number().min(0).max(10_000_000);
const limitsSchema = {
  dailyCapUsd: usdSchema.optional(),
  perTradeCapUsd: usdSchema.optional(),
  approvalThresholdUsd: usdSchema.optional(),
};

export const createInstitutionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,46}$/),
  name: z.string().min(2).max(120),
  custodian: z.enum(CUSTODIANS),
  custodianLabel: z.string().max(120).optional(),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ...limitsSchema,
});

export const patchInstitutionSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    status: z.enum(["pending", "active", "suspended"]).optional(),
    ...limitsSchema,
  })
  .strict();

/** numeric(20,2) columns take decimal strings; undefined leaves the column alone. */
export const money = (n: number | undefined): string | undefined =>
  n === undefined ? undefined : n.toFixed(2);
