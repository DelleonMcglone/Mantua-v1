import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { opsAuthGuard } from "./ops-auth-core.ts";

/**
 * Task 073 — the operator guard for `/api/ops/*` (institution onboarding
 * and limits), bound to `MANTUA_OPS_KEY`. The logic lives in
 * `ops-auth-core.ts` so it is tested without the environment.
 */
export const requireOpsAuth = opsAuthGuard(
  () => env.MANTUA_OPS_KEY,
  () => {
    logger.warn("ops auth rejected");
  },
);
