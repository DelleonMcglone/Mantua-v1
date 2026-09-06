import { createHmac } from "node:crypto";
import { env } from "../env.ts";

/**
 * F-003 — typed Zero Hash REST client (sandbox/cert + production).
 *
 * Zero Hash is the regulated counterparty of record for USD ↔ USDC
 * conversion, ACH/RTP money movement, and customer KYC/AML (D-101,
 * docs/architecture.md). This module owns request signing and the small
 * set of endpoints the fiat rails orchestrate. It holds NO bank account
 * numbers — external accounts are created from Plaid processor tokens,
 * so the raw numbers flow Plaid → Zero Hash directly.
 *
 * Authentication (implemented from Zero Hash's public docs —
 * https://docs.zerohash.com/docs/authentication and the code recipe at
 * https://docs.zerohash.com/recipes/rest-api-authentication-1, fetched
 * 2026-09-05):
 *
 *   headers:  X-SCX-API-KEY, X-SCX-SIGNED, X-SCX-TIMESTAMP, X-SCX-PASSPHRASE
 *   message:  `${timestamp}${METHOD}${path}${body}` (UTF-8)
 *             — body is compact JSON (`JSON.stringify`, no spaces);
 *             — for GET requests the body string is the literal `{}`.
 *   signature: Base64( HMAC-SHA256( Base64-decode(apiSecret), message ) )
 *   hosts:    cert (sandbox)  https://api.cert.zerohash.com
 *             production      https://api.zerohash.com
 */

export const ZERO_HASH_HOSTS = {
  sandbox: "https://api.cert.zerohash.com",
  production: "https://api.zerohash.com",
} as const;

export class ZeroHashError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class ZeroHashNotConfiguredError extends Error {
  constructor() {
    super("Zero Hash credentials are not configured.");
  }
}

export interface ZeroHashCredentials {
  apiKey: string;
  apiSecret: string; // base64-encoded HMAC secret, as issued by Zero Hash
  passphrase: string;
  platformCode?: string | undefined;
  host: string;
}

export function zeroHashConfigured(): boolean {
  return Boolean(env.ZERO_HASH_API_KEY && env.ZERO_HASH_SECRET && env.ZERO_HASH_PASSPHRASE);
}

export function zeroHashCredentials(): ZeroHashCredentials {
  if (!zeroHashConfigured()) throw new ZeroHashNotConfiguredError();
  return {
    apiKey: env.ZERO_HASH_API_KEY as string,
    apiSecret: env.ZERO_HASH_SECRET as string,
    passphrase: env.ZERO_HASH_PASSPHRASE as string,
    platformCode: env.ZERO_HASH_PLATFORM_CODE,
    host: ZERO_HASH_HOSTS[env.ZERO_HASH_ENV],
  };
}

/**
 * Pure signing primitive — exported for tests. `body` must be the exact
 * string sent on the wire (compact JSON), or `"{}"` for GET requests.
 */
export function signZeroHashRequest(params: {
  apiSecret: string;
  timestamp: number;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body: string;
}): string {
  const message = `${String(params.timestamp)}${params.method}${params.path}${params.body}`;
  return createHmac("sha256", Buffer.from(params.apiSecret, "base64"))
    .update(message, "utf8")
    .digest("base64");
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ZeroHashRequestOptions {
  credentials?: ZeroHashCredentials;
  fetchImpl?: FetchLike;
  /** Injectable clock for tests. Unix SECONDS. */
  now?: () => number;
}

/**
 * Signed request against the Zero Hash REST API. Never logs headers or
 * bodies — request bodies can reference customer PII held at Zero Hash.
 */
export async function zeroHashRequest<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  options: ZeroHashRequestOptions = {},
): Promise<T> {
  const credentials = options.credentials ?? zeroHashCredentials();
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const timestamp = options.now ? options.now() : Math.floor(Date.now() / 1000);
  const bodyString = method === "GET" ? "{}" : JSON.stringify(body ?? {});
  const signature = signZeroHashRequest({
    apiSecret: credentials.apiSecret,
    timestamp,
    method,
    path,
    body: bodyString,
  });
  const response = await fetchImpl(`${credentials.host}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-SCX-API-KEY": credentials.apiKey,
      "X-SCX-SIGNED": signature,
      "X-SCX-TIMESTAMP": String(timestamp),
      "X-SCX-PASSPHRASE": credentials.passphrase,
    },
    ...(method === "GET" ? {} : { body: bodyString }),
  });
  if (!response.ok) {
    // Error bodies are provider diagnostics; surface status + a short text
    // slice only (no request echo, which could contain PII references).
    const text = await response.text().catch(() => "");
    throw new ZeroHashError(
      `Zero Hash ${method} ${path} failed (${String(response.status)}): ${text.slice(0, 300)}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

// ── Typed operations ──────────────────────────────────────────────────────
// Endpoint shapes follow the public reference pages (fetched 2026-09-05):
//   participants:      https://docs.zerohash.com/reference/post_participants-customers-new
//   external accounts: https://docs.zerohash.com/reference/post_payments-external-accounts
//   payments:          https://docs.zerohash.com/reference/post_payments
//   on-ramp guide:     https://docs.zerohash.com/docs/on-ramp-integration-guide
// Exact field lists are confirmed against the versioned reference once the
// platform agreement grants API access — responses are typed loosely
// (`message` envelopes) for that reason.

/** Zero Hash wraps most responses in a `message` envelope. */
interface ZhEnvelope<T> {
  message: T;
}

export interface ZhParticipant {
  participant_code: string;
  email?: string;
}

/**
 * Create (or return) the Zero Hash participant for a user. KYC/AML is Zero
 * Hash's decision — Mantua submits identity attributes and never overrides
 * an eligibility outcome (D-101).
 */
export async function ensureZhParticipant(
  params: { email: string; clientRef: string },
  options: ZeroHashRequestOptions = {},
): Promise<ZhParticipant> {
  const res = await zeroHashRequest<ZhEnvelope<ZhParticipant>>(
    "POST",
    "/participants/customers/new",
    {
      email: params.email,
      // Idempotency: Zero Hash dedupes customer creation on the platform's
      // client-supplied reference; retries reuse the same value.
      client_participant_id: params.clientRef,
    },
    options,
  );
  return res.message;
}

export interface ZhExternalAccount {
  external_account_id: string;
  participant_code?: string;
}

/**
 * Create a Zero Hash external (bank) account from a Plaid processor token.
 * The processor token is the ONLY bank reference that crosses this wire —
 * account/routing numbers stay between Plaid and Zero Hash (D-101).
 */
export async function createZhExternalAccount(
  params: {
    participantCode: string;
    plaidProcessorToken: string;
    accountNickname: string;
    clientRef: string;
  },
  options: ZeroHashRequestOptions = {},
): Promise<ZhExternalAccount> {
  const res = await zeroHashRequest<ZhEnvelope<ZhExternalAccount>>(
    "POST",
    "/payments/external_accounts",
    {
      participant_code: params.participantCode,
      plaid_processor_token: params.plaidProcessorToken,
      account_nickname: params.accountNickname,
      client_external_account_id: params.clientRef,
    },
    options,
  );
  return res.message;
}

export interface ZhPayment {
  payment_id: string;
  status?: string;
}

/**
 * Initiate an ACH/RTP payment. `direction: "debit"` pulls USD from the
 * linked bank (deposit leg); `"credit"` pushes USD to it (withdrawal leg).
 * Idempotency-keyed via the client payment id — a retried call with the
 * same key must not double-move money.
 */
export async function createZhPayment(
  params: {
    participantCode: string;
    externalAccountId: string;
    amountUsd: string;
    direction: "debit" | "credit";
    idempotencyKey: string;
  },
  options: ZeroHashRequestOptions = {},
): Promise<ZhPayment> {
  const res = await zeroHashRequest<ZhEnvelope<ZhPayment>>(
    "POST",
    "/payments",
    {
      participant_code: params.participantCode,
      external_account_id: params.externalAccountId,
      amount: params.amountUsd,
      currency: "USD",
      direction: params.direction,
      client_payment_id: params.idempotencyKey,
    },
    options,
  );
  return res.message;
}

export async function getZhPayment(
  paymentId: string,
  options: ZeroHashRequestOptions = {},
): Promise<ZhPayment> {
  const res = await zeroHashRequest<ZhEnvelope<ZhPayment>>(
    "GET",
    `/payments/${encodeURIComponent(paymentId)}`,
    undefined,
    options,
  );
  return res.message;
}

/**
 * D-112 — the USDC destination network is CONFIG, not code. Zero Hash asset
 * codes take the form `USDC.<NETWORK>`; `FIAT_USDC_NETWORK` names the
 * network (default `BASE`). Whether Zero Hash supports Arc delivery is an
 * OPEN question tracked in D-112 — if the launch chain moves, this env var
 * (and Zero Hash's asset support) is the entire switch.
 */
export function usdcAssetCode(): string {
  return `USDC.${env.FIAT_USDC_NETWORK.toUpperCase()}`;
}

export interface ZhQuote {
  request_id: string;
  quote_id?: string;
  price?: string;
}

/**
 * Request + execute an RFQ converting between USD and USDC (on-ramp guide:
 * https://docs.zerohash.com/docs/on-ramp-integration-guide,
 * https://docs.zerohash.com/reference/post_fund-rfq). `side: "buy"` buys
 * USDC with USD (deposit); `"sell"` sells USDC for USD (withdrawal).
 */
export async function executeZhConversion(
  params: {
    participantCode: string;
    amountUsd: string;
    side: "buy" | "sell";
    idempotencyKey: string;
  },
  options: ZeroHashRequestOptions = {},
): Promise<ZhQuote> {
  const res = await zeroHashRequest<ZhEnvelope<ZhQuote>>(
    "POST",
    "/fund/rfq",
    {
      participant_code: params.participantCode,
      underlying: usdcAssetCode(),
      quoted_currency: "USD",
      side: params.side,
      quantity: params.amountUsd,
      client_quote_id: params.idempotencyKey,
    },
    options,
  );
  return res.message;
}

export interface ZhWithdrawalRequest {
  id: string;
  status?: string;
}

/**
 * Deliver USDC to the user's own wallet address after a deposit conversion.
 * Destination address comes from the user's connected wallet; the network
 * comes from `FIAT_USDC_NETWORK` (chain-agnostic per D-112).
 */
export async function requestZhUsdcDelivery(
  params: {
    participantCode: string;
    destinationAddress: string;
    amountUsdc: string;
    idempotencyKey: string;
  },
  options: ZeroHashRequestOptions = {},
): Promise<ZhWithdrawalRequest> {
  const res = await zeroHashRequest<ZhEnvelope<ZhWithdrawalRequest>>(
    "POST",
    "/withdrawals/requests",
    {
      participant_code: params.participantCode,
      asset: usdcAssetCode(),
      destination_address: params.destinationAddress,
      amount: params.amountUsdc,
      client_withdrawal_request_id: params.idempotencyKey,
    },
    options,
  );
  return res.message;
}
