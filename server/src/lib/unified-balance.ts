import { createRequire } from "node:module";
import { privateKeyToAccount } from "viem/accounts";
import type * as UBK from "@circle-fin/unified-balance-kit";
import type * as CWA from "@circle-fin/adapter-circle-wallets";
import type * as AVW from "@circle-fin/adapter-viem-v2";
import { env } from "../env.ts";
import { logger } from "./logger.ts";
import { CircleUnavailableError } from "./circle/client.ts";
import { getAgentWallet, getOrCreateAgentWallet } from "./agent-wallet.ts";
import { checkSpendingCap, guardSpend, type SpendGuardIo } from "./spending-cap.ts";

/**
 * Circle Gateway unified balance for the agent wallet ("treasury management" —
 * consolidate USDC across chains into one balance, accessible anywhere). Built
 * on Unified Balance Kit + the Circle Wallets adapter, reusing the same
 * CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET as the agent wallet. The SDK abstracts
 * all Gateway internals (deposit → unified balance; getBalances aggregates).
 *
 * Server-side only (the SDK is); the depositor is the agent wallet's address.
 * Scope: view + deposit + spend. The agent wallet is an SCA, which can't
 * produce the ECDSA signature Gateway burn intents need — so spend runs
 * through a DELEGATE: the admin EOA (MANTUA_ADMIN_PRIVATE_KEY, the same
 * keeper that signs peg-reference updates) is authorized once via
 * addDelegate (signed by the SCA owner) and thereafter signs burn intents
 * with `sourceAccount` set to the agent wallet, so funds still move from the
 * AGENT's unified balance — the EOA only signs.
 */

const HOME_CHAIN = "Base";

/**
 * Gateway mainnet destinations the spend endpoint accepts. Deposits (and thus
 * the burn allocation) live on Base — the home chain — so Base itself isn't a
 * destination; CCTP `bridge` covers point-to-point transfers to the wider
 * chain list.
 */
export const GATEWAY_SPEND_CHAINS = [
  "Ethereum",
  "Avalanche",
  "Optimism",
  "Arbitrum",
  "Polygon",
] as const;
export type GatewaySpendChain = (typeof GATEWAY_SPEND_CHAINS)[number];

export function isGatewaySpendChain(v: unknown): v is GatewaySpendChain {
  return typeof v === "string" && (GATEWAY_SPEND_CHAINS as readonly string[]).includes(v);
}

/**
 * Resolve a user-typed chain name/alias ("ethereum", "OP Mainnet", "op") to a
 * Gateway spend destination, or null when it isn't one. Mirrors the fuzzy
 * matching the CCTP bridge tool does so typed commands "just work".
 */
export function resolveGatewaySpendChain(input: string): GatewaySpendChain | null {
  const norm = input
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/(mainnet|one)+$/g, "");
  const aliases: Record<string, GatewaySpendChain> = {
    ethereum: "Ethereum",
    eth: "Ethereum",
    avalanche: "Avalanche",
    avax: "Avalanche",
    optimism: "Optimism",
    op: "Optimism",
    arbitrum: "Arbitrum",
    arb: "Arbitrum",
    polygon: "Polygon",
    matic: "Polygon",
  };
  if (isGatewaySpendChain(input)) return input;
  return aliases[norm] ?? null;
}

// Lazy-load the SDKs INSIDE the call paths (not at module top level), behind
// try/catch, so a load failure contains itself to these endpoints (503) and
// never crashes server boot.
//
// Loader shape, per environment:
//  - Vercel bundle: esbuild rewrites the literal import()/require() specifiers
//    to the pre-bundled api/_ubk.mjs (see scripts/build-server.mjs), which
//    resolved the adapter's CJS `Blockchain` named import at build time. The
//    import succeeds; the fallback is dead code.
//  - Dev (tsx / plain Node ESM): the adapter's ESM build does
//    `import { Blockchain } from "@circle-fin/developer-controlled-wallets"`,
//    which Node's ESM loader can't see in the CJS DCW package — the import
//    throws. The catch falls back to requiring the package's CJS build, whose
//    require() interop resolves the export fine.
// Specifiers must stay LITERAL in both branches so esbuild can rewrite them.
const nodeRequire = createRequire(import.meta.url);

let ubkModule: Promise<typeof UBK> | null = null;
function loadUbk(): Promise<typeof UBK> {
  ubkModule ??= import("@circle-fin/unified-balance-kit").catch(
    () => nodeRequire("@circle-fin/unified-balance-kit") as typeof UBK,
  );
  return ubkModule;
}
let cwaModule: Promise<typeof CWA> | null = null;
function loadCwa(): Promise<typeof CWA> {
  cwaModule ??= import("@circle-fin/adapter-circle-wallets").catch(
    () => nodeRequire("@circle-fin/adapter-circle-wallets") as typeof CWA,
  );
  return cwaModule;
}
let avwModule: Promise<typeof AVW> | null = null;
function loadAvw(): Promise<typeof AVW> {
  avwModule ??= import("@circle-fin/adapter-viem-v2").catch(
    () => nodeRequire("@circle-fin/adapter-viem-v2") as typeof AVW,
  );
  return avwModule;
}

/** Unified balance is unavailable when creds are missing OR an SDK fails to load. */
export class UnifiedBalanceUnavailableError extends Error {
  constructor(message = "Unified balance is unavailable.") {
    super(message);
    this.name = "UnifiedBalanceUnavailableError";
  }
}

function requireCreds(): { apiKey: string; entitySecret: string } {
  const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET } = env;
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) throw new CircleUnavailableError();
  return { apiKey: CIRCLE_API_KEY, entitySecret: CIRCLE_ENTITY_SECRET };
}

export interface UnifiedBalanceView {
  provisioned: boolean;
  address?: string;
  /** Total confirmed USDC across all chains (human decimal string). */
  totalUsdc?: string;
  /** Per-chain confirmed balances. */
  breakdown?: { chain: string; amount: string }[];
}

export interface UnifiedDepositResult {
  txHash: string;
  explorerUrl?: string;
  amount: string;
}

// Loose views of the SDK result shapes (avoid `any`; we only read a few fields).
interface ChainBalance {
  chain: string;
  confirmedBalance: string;
}
interface AccountBreakdown {
  breakdown?: ChainBalance[];
}
interface DepositResultLike {
  txHash: string;
  explorerUrl?: string;
}

/**
 * Read the agent wallet's unified (cross-chain) USDC balance. Returns
 * `{ provisioned: false }` when the user has no agent wallet yet.
 */
export async function getUnifiedBalances(privyUserId: string): Promise<UnifiedBalanceView> {
  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) return { provisioned: false };
  requireCreds(); // 503 if Circle creds are missing
  let UnifiedBalanceKit: typeof UBK.UnifiedBalanceKit;
  try {
    ({ UnifiedBalanceKit } = await loadUbk());
  } catch (err) {
    logger.error({ err }, "unified-balance SDK failed to load");
    throw new UnifiedBalanceUnavailableError();
  }
  const kit = new UnifiedBalanceKit();
  const res = await kit.getBalances({
    token: "USDC",
    sources: { address: wallet.address },
    networkType: "mainnet",
  });

  const breakdown: { chain: string; amount: string }[] = [];
  for (const acct of res.breakdown as unknown as AccountBreakdown[]) {
    for (const c of acct.breakdown ?? []) {
      breakdown.push({ chain: c.chain, amount: c.confirmedBalance });
    }
  }
  return {
    provisioned: true,
    address: wallet.address,
    totalUsdc: res.totalConfirmedBalance,
    breakdown,
  };
}

/**
 * Deposit USDC from the agent wallet (on Base) into its unified balance. Funds
 * stay owned by the agent wallet — they're just held in Gateway and become
 * spendable across chains — so no spending-cap check applies. Provisions the
 * agent wallet on demand.
 */
export async function depositToUnifiedBalance(
  privyUserId: string,
  walletAddress: string | undefined,
  amount: string,
): Promise<UnifiedDepositResult> {
  const wallet = await getOrCreateAgentWallet(privyUserId, walletAddress);
  const { apiKey, entitySecret } = requireCreds();
  let UnifiedBalanceKit: typeof UBK.UnifiedBalanceKit;
  let createCircleWalletsAdapter: typeof CWA.createCircleWalletsAdapter;
  try {
    ({ UnifiedBalanceKit } = await loadUbk());
    ({ createCircleWalletsAdapter } = await loadCwa());
  } catch (err) {
    logger.error({ err }, "unified-balance SDK failed to load");
    throw new UnifiedBalanceUnavailableError();
  }
  const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });
  const kit = new UnifiedBalanceKit();
  const res = (await kit.deposit({
    from: { adapter, chain: HOME_CHAIN, address: wallet.address },
    amount,
  })) as unknown as DepositResultLike;
  return {
    txHash: res.txHash,
    ...(res.explorerUrl ? { explorerUrl: res.explorerUrl } : {}),
    amount,
  };
}

// ---------------------------------------------------------------------------
// Deposit via the ops/buyer EOA
// ---------------------------------------------------------------------------

/** Where top-ups land: users send Base USDC to this ops wallet, and
 *  `depositToUnifiedBalanceFromBase` moves it into the AGENT's unified
 *  balance. Same key the x402 buyer signs with. */
function requireOpsKey(): `0x${string}` {
  const key = env.X402_BUYER_PRIVATE_KEY ?? env.MANTUA_ADMIN_PRIVATE_KEY;
  if (!key) {
    throw new UnifiedBalanceUnavailableError(
      "Base-side deposits are unavailable: no ops wallet key configured.",
    );
  }
  return key as `0x${string}`;
}

/** Per-call ceiling so an agent call can't drain the shared ops wallet
 *  (which also funds x402 payments). */
const DEPOSIT_BASE_MAX_USDC = 100;

/**
 * Deposit USDC held by the ops wallet on Base into the agent's unified
 * balance (`depositFor` — the deposit is credited to the AGENT, the ops
 * wallet only signs and pays gas). This is the "top-up via ops wallet"
 * path: the user sends USDC to the ops wallet address on Base, then the
 * agent moves it into Gateway.
 */
export async function depositToUnifiedBalanceFromBase(
  privyUserId: string,
  amount: string,
): Promise<UnifiedDepositResult & { source: string; sourceChain: string }> {
  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) throw new UnifiedBalanceUnavailableError("No agent wallet provisioned.");
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error("amount must be a positive decimal string");
  if (amt > DEPOSIT_BASE_MAX_USDC) {
    throw new Error(
      `Base-side deposits are capped at ${String(DEPOSIT_BASE_MAX_USDC)} USDC per call.`,
    );
  }
  const key = requireOpsKey();
  const { ubk, avw } = await loadKitAndAdapters();
  const adapter = avw.createViemAdapterFromPrivateKey({ privateKey: key });
  const kit = new ubk.UnifiedBalanceKit();
  // Cast bridges the nominal Blockchain-enum mismatch between the viem
  // adapter's and the kit's bundled types (same as `spend` below).
  const from = { adapter, chain: HOME_CHAIN } as unknown as Parameters<
    typeof kit.depositFor
  >[0]["from"];
  const res = (await kit.depositFor({
    from,
    depositAccount: wallet.address,
    amount,
  })) as unknown as DepositResultLike & { depositedBy?: string };
  logger.info(
    { amount, agent: wallet.address, txHash: res.txHash },
    "gateway deposit via ops wallet on Base",
  );
  return {
    txHash: res.txHash,
    ...(res.explorerUrl ? { explorerUrl: res.explorerUrl } : {}),
    amount,
    source: privateKeyToAccount(key).address,
    sourceChain: HOME_CHAIN,
  };
}

// ---------------------------------------------------------------------------
// Spend (via the admin-EOA delegate)
// ---------------------------------------------------------------------------

export type GatewayDelegateStatus = "none" | "pending" | "ready";

export interface UnifiedSpendResult {
  status: "spent" | "delegate_pending";
  /** Present when status = "spent". */
  txHash?: string;
  explorerUrl?: string;
  transferId?: string;
  destinationChain: GatewaySpendChain;
  recipientAddress: string;
  amount: string;
  /** Human explanation when status = "delegate_pending". */
  note?: string;
}

interface SpendResultLike {
  txHash?: string;
  explorerUrl?: string;
  transferId?: string;
}

function requireDelegateKey(): `0x${string}` {
  const key = env.MANTUA_ADMIN_PRIVATE_KEY;
  if (!key) {
    throw new UnifiedBalanceUnavailableError(
      "Gateway spend is unavailable: no delegate key configured (MANTUA_ADMIN_PRIVATE_KEY).",
    );
  }
  return key as `0x${string}`;
}

async function loadKitAndAdapters(): Promise<{
  ubk: typeof UBK;
  cwa: typeof CWA;
  avw: typeof AVW;
}> {
  try {
    const [ubk, cwa, avw] = await Promise.all([loadUbk(), loadCwa(), loadAvw()]);
    return { ubk, cwa, avw };
  } catch (err) {
    logger.error({ err }, "unified-balance SDK failed to load");
    throw new UnifiedBalanceUnavailableError();
  }
}

/**
 * Is the admin EOA authorized as a Gateway delegate for the agent wallet?
 * Read goes through the owner (SCA) adapter context on Base.
 */
export async function getGatewayDelegateStatus(
  privyUserId: string,
): Promise<{ delegateAddress: string; status: GatewayDelegateStatus }> {
  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) throw new UnifiedBalanceUnavailableError("No agent wallet provisioned.");
  const { apiKey, entitySecret } = requireCreds();
  const delegateAddress = privateKeyToAccount(requireDelegateKey()).address;
  const { ubk, cwa } = await loadKitAndAdapters();
  const adapter = cwa.createCircleWalletsAdapter({ apiKey, entitySecret });
  const kit = new ubk.UnifiedBalanceKit();
  const status = await kit.getDelegateStatus({
    from: { adapter, chain: HOME_CHAIN, address: wallet.address },
    delegateAddress,
    token: "USDC",
  });
  return { delegateAddress, status };
}

/**
 * Authorize the admin EOA as a Gateway delegate for the agent wallet (no-op
 * when already ready/pending). The addDelegate tx is signed by the SCA owner
 * through the Circle Wallets adapter — it's an on-chain call, which the SCA
 * CAN make (only offline ECDSA burn-intent signing is out of its reach).
 */
export async function ensureGatewayDelegate(
  privyUserId: string,
): Promise<{ delegateAddress: string; status: GatewayDelegateStatus }> {
  const current = await getGatewayDelegateStatus(privyUserId);
  if (current.status !== "none") return current;

  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) throw new UnifiedBalanceUnavailableError("No agent wallet provisioned.");
  const { apiKey, entitySecret } = requireCreds();
  const { ubk, cwa } = await loadKitAndAdapters();
  const adapter = cwa.createCircleWalletsAdapter({ apiKey, entitySecret });
  const kit = new ubk.UnifiedBalanceKit();
  await kit.addDelegate({
    from: { adapter, chain: HOME_CHAIN, address: wallet.address },
    delegateAddress: current.delegateAddress,
    token: "USDC",
  });
  const after = await getGatewayDelegateStatus(privyUserId);
  logger.info(
    { delegate: after.delegateAddress, status: after.status },
    "gateway delegate registered",
  );
  return after;
}

/**
 * C-010 — USD value of a Gateway spend amount (USDC ≈ USD). Fails CLOSED on
 * unparseable or negative input: a spend the cap machinery can't price is a
 * spend that doesn't happen.
 */
function gatewaySpendUsd(amount: string): number {
  const usd = Number(amount);
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`Invalid Gateway spend amount: ${JSON.stringify(amount)}`);
  }
  return usd;
}

/**
 * C-010 — run a Gateway spend through the same check → issue → record
 * sequence every other money path uses (`guardSpend`, C-019). Previously
 * this path only CHECKED the cap and never recorded the spend, so N
 * sequential Gateway spends each passed a cap none of them consumed.
 *
 * Settling to the agent's OWN address is a treasury move (funds stay
 * agent-owned — same rationale as deposit) and bypasses the cap entirely;
 * paying a third party is a spend and both counts against and CONSUMES the
 * daily cap. Exported with an injectable `io` seam for unit tests.
 */
export async function guardGatewaySpend<T>(
  walletAddress: string,
  recipientAddress: string,
  amount: string,
  issue: () => Promise<T>,
  io?: SpendGuardIo,
): Promise<T> {
  if (recipientAddress.toLowerCase() === walletAddress.toLowerCase()) return issue();
  const resolveUsd = () => Promise.resolve(gatewaySpendUsd(amount));
  return io
    ? guardSpend(resolveUsd, walletAddress, issue, io)
    : guardSpend(resolveUsd, walletAddress, issue);
}

/**
 * Spend USDC from the agent wallet's unified balance to `destinationChain`
 * (burn on Base, mint on the destination) — Base as the settlement hub. The
 * admin-EOA delegate signs the burn intent; `sourceAccount` keeps the funds
 * drawn from the AGENT's balance. Auto-registers the delegate on first use;
 * if that registration is still finalizing, returns `delegate_pending`
 * instead of throwing so callers can relay "retry shortly".
 */
export async function spendUnifiedBalance(
  privyUserId: string,
  args: {
    amount: string;
    destinationChain: GatewaySpendChain;
    recipientAddress?: string | undefined;
  },
): Promise<UnifiedSpendResult> {
  const { amount, destinationChain } = args;
  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) throw new UnifiedBalanceUnavailableError("No agent wallet provisioned.");
  requireCreds();
  const recipientAddress = args.recipientAddress ?? wallet.address;

  // Settling to the agent's OWN address on another chain is a treasury move
  // (funds stay agent-owned — same rationale as deposit); paying a third
  // party is a spend and counts against the daily cap (USDC ≈ USD).
  // This early read-only check fails fast BEFORE any delegate-registration
  // work; the authoritative sequence (check → issue → record) runs in
  // `guardGatewaySpend` around the burn below (C-010).
  if (recipientAddress.toLowerCase() !== wallet.address.toLowerCase()) {
    await checkSpendingCap(wallet.address, gatewaySpendUsd(amount));
  }

  const delegate = await ensureGatewayDelegate(privyUserId);
  if (delegate.status !== "ready") {
    return {
      status: "delegate_pending",
      destinationChain,
      recipientAddress,
      amount,
      note: "The spend delegate was just registered with Gateway and is still finalizing — retry in a minute.",
    };
  }

  const { ubk, avw } = await loadKitAndAdapters();
  const adapter = avw.createViemAdapterFromPrivateKey({ privateKey: requireDelegateKey() });
  const kit = new ubk.UnifiedBalanceKit();
  // `useForwarder` — Circle's Forwarding Service submits the destination mint,
  // so no wallet/adapter is needed on the destination chain (its fee comes out
  // of the minted amount). The `from` cast bridges a nominal enum mismatch
  // between the viem adapter's and the kit's bundled `Blockchain` types (the
  // runtime chain names are identical).
  const from = {
    adapter,
    sourceAccount: wallet.address,
    allocations: { amount, chain: HOME_CHAIN },
  } as unknown as UBK.SpendSource;
  const issueSpend = async () =>
    (await kit.spend({
      from,
      to: { chain: destinationChain, recipientAddress, useForwarder: true },
      amount,
    })) as unknown as SpendResultLike;
  // C-010 — third-party spends run check → issue → record (guardSpend): the
  // daily ledger is inked once the burn is submitted, so the NEXT spend sees
  // this one's headroom reduction. Self-recipient treasury moves bypass the
  // cap, as before (guardGatewaySpend handles both branches).
  const res = await guardGatewaySpend(wallet.address, recipientAddress, amount, issueSpend);

  return {
    status: "spent",
    ...(res.txHash ? { txHash: res.txHash } : {}),
    ...(res.explorerUrl ? { explorerUrl: res.explorerUrl } : {}),
    ...(res.transferId ? { transferId: res.transferId } : {}),
    destinationChain,
    recipientAddress,
    amount,
  };
}
