import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  ProcessorTokenCreateRequestProcessorEnum,
  AccountType,
  type AccountBase,
} from "plaid";
import { env } from "../env.ts";

/**
 * F-002 — server-side Plaid integration for bank linking (D-101).
 *
 * THE INTEGRATION BOUNDARY, verbatim from docs/architecture.md D-101:
 * "Mantua obtains a Plaid Link token server-side and receives only the
 * short-lived public token callback. It exchanges that token server-side
 * and creates a Zero Hash processor token/external account. Raw
 * account/routing numbers and Plaid access tokens must never reach the
 * browser, app database, logs, analytics, or LLM context."
 *
 * Concretely, in this module:
 *  - the Plaid ACCESS TOKEN exists only as a local variable inside
 *    `exchangePublicToken` — it is used to mint the processor token and
 *    then dropped. It is never returned, persisted, or logged.
 *  - the PROCESSOR TOKEN is handed straight to Zero Hash (external account
 *    creation) and likewise never persisted.
 *  - what the app keeps: the Plaid ITEM ID (opaque reference), the
 *    institution name, and the last-4 mask — display-safe only.
 */

export class PlaidNotConfiguredError extends Error {
  constructor() {
    super("Plaid credentials are not configured.");
  }
}

export function plaidConfigured(): boolean {
  return Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET);
}

let cachedClient: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
  if (!plaidConfigured()) throw new PlaidNotConfiguredError();
  if (cachedClient) return cachedClient;
  cachedClient = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.PLAID_ENV],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
          "PLAID-SECRET": env.PLAID_SECRET,
        },
      },
    }),
  );
  return cachedClient;
}

/** Test seam — never used in production code paths. */
export function _setPlaidClientForTests(client: PlaidApi | null): void {
  cachedClient = client;
}

/**
 * Create a Link token for the authed user. `clientUserId` is our internal
 * user id (a UUID) — an opaque value, per Plaid's guidance never an email
 * or name. Products: `auth` is what the Zero Hash processor flow requires;
 * Balance/Identity/Identity Match are enabled dashboard-side before
 * production (D-101).
 */
export async function createPlaidLinkToken(clientUserId: string): Promise<string> {
  const client = plaidClient();
  const response = await client.linkTokenCreate({
    user: { client_user_id: clientUserId },
    client_name: "Mantua",
    products: [Products.Auth],
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return response.data.link_token;
}

export interface PlaidExchangeResult {
  /** The Zero Hash processor token — forward to Zero Hash, do not store. */
  processorToken: string;
  /** Opaque Plaid item reference — safe to store. */
  plaidItemId: string;
  /** Display-safe metadata. */
  institutionName: string | null;
  accountMask: string | null;
}

/**
 * Exchange the short-lived public token from the Link `onSuccess` callback,
 * then immediately mint the Zero Hash processor token.
 *
 * D-101 boundary: `accessToken` below is the only place the Plaid access
 * token exists. It is used for exactly two server-to-Plaid calls
 * (accountsGet, processorTokenCreate) and then goes out of scope. DO NOT
 * add persistence or logging of it — see the module comment.
 */
export async function exchangePublicToken(publicToken: string): Promise<PlaidExchangeResult> {
  const client = plaidClient();

  const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchange.data.access_token; // transient — never leaves this function
  const plaidItemId = exchange.data.item_id;

  // Pick the depository account the user selected in Link. Auth-product
  // links surface checking/savings accounts only.
  const accounts = await client.accountsGet({ access_token: accessToken });
  const accountList: AccountBase[] = accounts.data.accounts;
  const account = accountList.find((a) => a.type === AccountType.Depository) ?? accountList.at(0);
  if (!account) throw new Error("Plaid item has no linkable bank account.");

  // ZERO_HASH_PLAID_PROCESSOR_ID: the processor identifier Plaid assigns
  // Zero Hash integrations. The SDK ships it as the `zero_hash` enum value;
  // the env var exists as an override in case commercial onboarding issues
  // a platform-specific processor id.
  const processor = (env.ZERO_HASH_PLAID_PROCESSOR_ID ??
    ProcessorTokenCreateRequestProcessorEnum.ZeroHash) as ProcessorTokenCreateRequestProcessorEnum;
  const processorRes = await client.processorTokenCreate({
    access_token: accessToken,
    account_id: account.account_id,
    processor,
  });

  return {
    processorToken: processorRes.data.processor_token,
    plaidItemId,
    institutionName: accounts.data.item.institution_name ?? null,
    accountMask: account.mask ?? null,
  };
}
