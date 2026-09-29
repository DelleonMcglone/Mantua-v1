import type { Request, RequestHandler, Response } from "express";
import {
  HTTPFacilitatorClient,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
} from "@x402/core/types";
import {
  BatchFacilitatorClient,
  GatewayEvmScheme,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
  isBatchPayment,
} from "@circle-fin/x402-batching/server";
import { CIRCLE_BATCHING_NAME, CIRCLE_BATCHING_VERSION } from "@circle-fin/x402-batching";
import { logAudit } from "../lib/audit.ts";
import { X402_NETWORK, x402PriceString, type X402ServiceDef } from "../lib/x402/catalog.ts";
import { logger } from "../lib/logger.ts";
import { createGuardedPaywall } from "../lib/x402/guarded-paywall.ts";

/**
 * Phase 17 (MP-004) — the dual-rail x402 paywall factory.
 *
 * One 402 PAYMENT-REQUIRED header offers BOTH payment rails in a single
 * `accepts` array (Circle become-a-seller pattern):
 *
 *  1. vanilla rail — classic EIP-3009 `exact` payments verified/settled by
 *     the X402_FACILITATOR_URL facilitator (default x402.org, which serves
 *     testnets only), like the legacy analyst brief;
 *  2. Gateway rail — Circle Gateway batched payments (`extra.name =
 *     "GatewayWalletBatched"`), verified/settled by the Gateway facilitator.
 *
 * Both rails are scheme "exact" on eip155:8453, so a single x402ResourceServer
 * carries `GatewayEvmScheme` on the "eip155:*" pattern (it parses USDC prices
 * and merges the Gateway `verifyingContract` into requirement extras). Two
 * mechanics make the rails coexist — both verified against the installed
 * @x402/core source:
 *
 *  - Core matches a client's `accepted` row against server requirements by
 *    deep-equaling the CORE fields (scheme/network/asset/amount/payTo/
 *    maxTimeoutSeconds), treating `extra` as an additive subset. Two rows
 *    identical on every core field would be ambiguous — so the vanilla row
 *    carries maxTimeoutSeconds = GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS + 1
 *    (the GatewayEvmScheme enhancement bumps the Gateway row up to the
 *    window; the vanilla row is configured one second higher and survives).
 *    Vanilla clients sign `validBefore = now + maxTimeoutSeconds`, so this
 *    window is the price of offering both rails in one 402.
 *  - A facilitator map is keyed (version, network, scheme) with first-entry
 *    precedence, so a plain array cannot route two same-key rails. The
 *    DualRailFacilitator below routes by `isBatchPayment(requirements)` —
 *    the matched requirements' `extra.name` says which rail the client
 *    accepted — and merges both facilitators' supported kinds (Gateway
 *    first, so the Gateway `verifyingContract` lands in the stored kind).
 *
 * Gates (all fail-closed, graceful-dark style):
 *  - X402_SELLER_ADDRESS — master switch; unset → 503 dark.
 *  - X402_SELLER_SERVICES — enabled service ids; a service not listed → 503
 *    dark. Absent list is handled by the caller (env helper): dark.
 *  - "allowlist+payment" services additionally 403 un-allowlisted payers
 *    BEFORE the paywall runs — a refused payer is never charged, not even a
 *    facilitator verify call. An allowlist with no entries keeps the service
 *    dark (a gate nobody can pass is just a closed door).
 *
 * Every settled payment writes exactly one `agent_x402_sale` audit row
 * (payer, service, price, network) — the seller-side mirror of the buyer's
 * `agent_x402` discipline. Settlement happens after the handler (the @x402/
 * express middleware buffers the response), so the audit middleware reads
 * the PAYMENT-RESPONSE header on `finish`.
 */

/** Payer addresses (lowercase) that may pass an "allowlist+payment" gate. */
function isAllowlisted(list: string[] | undefined, payer: string): boolean {
  if (!list || list.length === 0) return false;
  const lower = payer.toLowerCase();
  return list.some((a) => a.toLowerCase() === lower);
}

/**
 * The payer address carried by the request's PAYMENT-SIGNATURE header —
 * `authorization.from` for the vanilla EIP-3009 payload (the client signs
 * the authorization, so verification ties the payer to this address).
 * Null when the header is absent or does not carry a parseable payer —
 * callers decide whether that means "unpaid" or "unprovable".
 */
export function payerFromPaymentHeader(req: Request): string | null {
  const raw = req.get("payment-signature");
  if (!raw) return null;
  try {
    const payload = decodePaymentSignatureHeader(raw) as {
      authorization?: { from?: unknown };
      payer?: unknown;
    };
    const from = payload.authorization?.from ?? payload.payer;
    return typeof from === "string" && from.startsWith("0x") ? from : null;
  } catch (err) {
    logger.warn({ err }, "x402 paywall: unparseable payment-signature header");
    return null;
  }
}

/** The decoded PAYMENT-RESPONSE header the paywall sets after settlement. */
interface SettleHeader {
  success?: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  errorReason?: string;
}

/** The sale facts the audit middleware logs per settled payment. */
export interface SaleAuditEntry {
  walletAddress?: string | undefined;
  params: Record<string, unknown>;
  txHash?: string | undefined;
}

export type SaleAuditFn = (entry: SaleAuditEntry) => Promise<void>;

function defaultAuditSale(entry: SaleAuditEntry): Promise<void> {
  return logAudit({
    walletAddress: entry.walletAddress,
    action: "agent_x402_sale",
    outcome: "success",
    params: entry.params,
    txHash: entry.txHash,
  });
}

/**
 * Paywall construction inputs. Production reads them from env via
 * `x402PaywallDepsFromEnv`; tests build them inline (hermetic — the
 * facilitator seams make the whole chain run without network).
 */
export interface X402PaywallDeps {
  /** X402_SELLER_ADDRESS — master switch. Undefined → every service dark. */
  sellerAddress?: string | undefined;
  /** X402_SELLER_SERVICES parsed; undefined means "unset" (callers treat as dark). */
  enabledServiceIds?: string[] | undefined;
  /** Payer allowlist for "allowlist+payment" services; empty/undefined → those services dark. */
  payerAllowlist?: string[] | undefined;
  /** Circle Gateway facilitator URL (testnet vs mainnet). */
  gatewayFacilitatorUrl?: string | undefined;
  /** X402_FACILITATOR_URL — vanilla-rail facilitator; unset → x402.org (testnets only). */
  vanillaFacilitatorUrl?: string | undefined;
  /** Test seam — replaces the vanilla facilitator client outright. */
  vanillaFacilitator?: FacilitatorClient | undefined;
  /** Test seam — replaces the default logAudit-backed sale audit. */
  auditSale?: SaleAuditFn | undefined;
}

/** Production deps from env. Allowlists map per allowlisted service id. */
export function x402PaywallDepsFromEnv(env: {
  X402_SELLER_ADDRESS?: string | undefined;
  X402_SELLER_SERVICES?: string[] | undefined;
  X402_SPORTS_INTEL_ALLOWLIST?: string[] | undefined;
  X402_GATEWAY_FACILITATOR_URL?: string | undefined;
  X402_FACILITATOR_URL?: string | undefined;
}): X402PaywallDeps {
  return {
    sellerAddress: env.X402_SELLER_ADDRESS,
    enabledServiceIds: env.X402_SELLER_SERVICES,
    payerAllowlist: env.X402_SPORTS_INTEL_ALLOWLIST,
    gatewayFacilitatorUrl: env.X402_GATEWAY_FACILITATOR_URL,
    vanillaFacilitatorUrl: env.X402_FACILITATOR_URL,
  };
}

/**
 * Routes verify/settle by the matched requirements' rail metadata: Gateway
 * payments to the Gateway facilitator, everything else to the vanilla one.
 * `getSupported` merges both — Gateway kinds first, so the supported-kind
 * stored for (v2, eip155:8453, exact) is the Gateway one and its
 * `verifyingContract` enriches the Gateway requirements (the vanilla row's
 * EIP-3009 domain comes from its own extra; the extra `verifyingContract`
 * is inert for vanilla clients, which key the domain off `asset`).
 */
class DualRailFacilitator implements FacilitatorClient {
  private readonly vanilla: FacilitatorClient;
  private readonly gateway: BatchFacilitatorClient;

  constructor(vanilla: FacilitatorClient, gateway: BatchFacilitatorClient) {
    this.vanilla = vanilla;
    this.gateway = gateway;
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    if (isBatchPayment(requirements)) {
      // The batching package declares its own payload types (drifting from
      // @x402/core's) — normalize at this boundary, not in the middleware.
      return this.gateway.verify(payload as never, requirements);
    }
    return this.vanilla.verify(payload, requirements);
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    if (isBatchPayment(requirements)) {
      // The batching settle response types `network` as a plain string where
      // core uses the CAIP-2 template — narrowed at this boundary.
      return this.gateway.settle(payload as never, requirements) as Promise<SettleResponse>;
    }
    return this.vanilla.settle(payload, requirements);
  }

  async getSupported(): Promise<SupportedResponse> {
    const [gateway, vanilla] = await Promise.all([
      this.gateway.getSupported(),
      this.vanilla.getSupported(),
    ]);
    // The batching package's kind declarations drift from @x402/core's
    // SupportedKind — the JSON shapes are compatible; normalize here so the
    // Gateway kinds (first) win the stored (version, network, scheme) slot
    // and carry the `verifyingContract` extra into requirement enrichment.
    const kinds: SupportedKind[] = [
      ...(gateway.kinds as unknown as SupportedKind[]),
      ...vanilla.kinds,
    ];
    return {
      kinds,
      extensions: [...new Set([...vanilla.extensions, ...gateway.extensions])],
      signers: { ...vanilla.signers },
    };
  }
}

/** The vanilla row's EIP-3009 signing domain — native USDC on Base. */
const VANILLA_USDC_DOMAIN = { name: "USD Coin", version: "2" };

/**
 * The vanilla row must out-timeout the Gateway row or the two accepts entries
 * would share identical core fields (see module doc). One second above the
 * Gateway window is enough to disambiguate matching; the GatewayEvmScheme
 * enhancement raises the Gateway row to exactly the window.
 */
const VANILLA_MAX_TIMEOUT_SECONDS = GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS + 1;

function darkResponse(res: Response): void {
  res.status(503).json({
    error: "Service not configured (X402_SELLER_ADDRESS / X402_SELLER_SERVICES).",
    code: "X402_SERVICE_DISABLED",
  });
}

function notAuthorizedResponse(res: Response): void {
  res.status(403).json({
    error: "Payer is not authorized for this service.",
    code: "x402_payer_not_authorized",
  });
}

/** Pre-settlement allowlist gate for "allowlist+payment" services. */
function allowlistGate(deps: X402PaywallDeps, def: X402ServiceDef): RequestHandler {
  return (req, res, next) => {
    if (!req.get("payment-signature")) {
      // Nothing presented yet — the paywall will answer with the normal 402.
      next();
      return;
    }
    const payer = payerFromPaymentHeader(req);
    if (!payer || !isAllowlisted(deps.payerAllowlist, payer)) {
      // Fail-closed: a payload that cannot prove membership is refused before
      // any verify/settle — an un-allowlisted payer is never charged.
      logger.info({ serviceId: def.id }, "x402 paywall: payer refused by allowlist");
      notAuthorizedResponse(res);
      return;
    }
    next();
  };
}

/** Exactly one agent_x402_sale audit row per settled payment. */
function auditSaleMiddleware(deps: X402PaywallDeps, def: X402ServiceDef): RequestHandler {
  const audit = deps.auditSale ?? defaultAuditSale;
  return (req, res, next) => {
    res.on("finish", () => {
      try {
        const raw = res.getHeader("payment-response");
        if (typeof raw !== "string" || raw.length === 0) return; // unpaid/dark — not a sale
        const settle = decodePaymentResponseHeader(raw) as SettleHeader;
        if (!settle.success) return; // a failed settlement is not a sale
        void audit({
          walletAddress: settle.payer ?? payerFromPaymentHeader(req) ?? undefined,
          params: {
            serviceId: def.id,
            priceUsd: def.priceUsd,
            network: settle.network ?? X402_NETWORK,
          },
          txHash: settle.transaction,
        });
      } catch (err) {
        // A missed audit row must never fail a paid response — but it must be visible.
        logger.error({ err, serviceId: def.id }, "agent_x402_sale audit failed");
      }
    });
    next();
  };
}

/** True when the service must NOT serve at all under the current config. */
export function isX402ServiceDark(def: X402ServiceDef, deps: X402PaywallDeps): boolean {
  if (!deps.sellerAddress) return true;
  if (deps.enabledServiceIds === undefined) return true; // absent X402_SELLER_SERVICES = all dark
  if (!deps.enabledServiceIds.includes(def.id)) return true;
  if (
    def.auth === "allowlist+payment" &&
    (!deps.payerAllowlist || deps.payerAllowlist.length === 0)
  ) {
    return true;
  }
  return false;
}

/**
 * Build the middleware chain for one catalog service: [allowlist gate] →
 * [dual-rail paywall] → [sale audit]. The route mounts it ahead of its
 * handler. Dark services get a single 503-sending gate.
 */
export function x402ServiceChain(def: X402ServiceDef, deps: X402PaywallDeps): RequestHandler[] {
  if (isX402ServiceDark(def, deps)) {
    return [
      (_req: Request, res: Response) => {
        darkResponse(res);
      },
    ];
  }

  const seller = deps.sellerAddress as string;
  const vanilla =
    deps.vanillaFacilitator ??
    new HTTPFacilitatorClient(
      deps.vanillaFacilitatorUrl ? { url: deps.vanillaFacilitatorUrl } : undefined,
    );
  const gateway = new BatchFacilitatorClient(
    deps.gatewayFacilitatorUrl ? { url: deps.gatewayFacilitatorUrl } : {},
  );

  let paywall: RequestHandler;
  try {
    // Guarded: the facilitator handshake starts now but can never become an
    // unhandled rejection; until it succeeds the service answers 503 dark.
    paywall = createGuardedPaywall({
      label: def.id,
      routes: {
        [def.path]: {
          accepts: [
            {
              scheme: "exact",
              payTo: seller,
              price: x402PriceString(def),
              network: X402_NETWORK,
              maxTimeoutSeconds: VANILLA_MAX_TIMEOUT_SECONDS,
              extra: { ...VANILLA_USDC_DOMAIN },
            },
            {
              scheme: "exact",
              payTo: seller,
              price: x402PriceString(def),
              network: X402_NETWORK,
              extra: { name: CIRCLE_BATCHING_NAME, version: CIRCLE_BATCHING_VERSION },
            },
          ],
          description: def.summary,
          mimeType: "application/json",
          serviceName: `Mantua ${def.id}`,
        },
      },
      facilitator: new DualRailFacilitator(vanilla, gateway),
      schemes: [{ network: "eip155:*", server: new GatewayEvmScheme() }],
      onUnavailable: (res) => {
        darkResponse(res);
      },
    }).handler;
  } catch (err) {
    // Fail-safe: a broken paywall config must 503 dark, never crash boot.
    logger.error({ err, serviceId: def.id }, "x402 paywall construction failed — service dark");
    return [
      (_req: Request, res: Response) => {
        darkResponse(res);
      },
    ];
  }

  const chain: RequestHandler[] = [];
  if (def.auth === "allowlist+payment") chain.push(allowlistGate(deps, def));
  chain.push(paywall);
  chain.push(auditSaleMiddleware(deps, def));
  return chain;
}
