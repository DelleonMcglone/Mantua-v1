import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * C-007 / D-106 — tests for the shipped x402 BUYER surface. D-106 locked the
 * scope ("the shipped buyer+seller surfaces ARE the integrated scope") and
 * flagged that those surfaces had no tests; this file closes that gap for the
 * buyer's money rails:
 *
 *  - per-call ceiling (X402_MAX_CALL_USD) rejects before anything is signed;
 *  - daily cap (X402_DAILY_CAP_USD) is summed from `agent_x402` audit rows
 *    and rejects at the limit;
 *  - disabled / keyless mode degrades to "not enabled" without any network
 *    traffic (the chat layer then falls back to free data);
 *  - exactly one audit row is written per payment (success AND
 *    failure-after-payment).
 *
 * Style: no module mocks — the repo's seam-free approach. `fetch` is swapped
 * on globalThis (both the buyer's pre-flight and viem's RPC transport go
 * through it), the parsed `env` object is mutated per test, and the drizzle
 * `db` facade's `select`/`insert` entry points are stubbed with fakes that
 * record what the code under test asked for.
 */

// Stub the boot-required env BEFORE the app modules load (env.ts parses at
// import and exits the process on a missing DATABASE_URL). Values only need
// to satisfy the schema — nothing here ever connects.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { callPaidService, getTodayX402Spend, getBuyerAddress, isX402Available, X402Error } =
  await import("./x402-buyer.ts");
const { env } = await import("../env.ts");
const { db } = await import("../db/client.ts");

/** Well-known test vector: private key 0x...01. */
const TEST_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const TEST_ADDR = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

const SERVICE_URL = "https://api.example.test/brief";
const BASE_NETWORK = "eip155:8453";

// The x402 knobs live on the already-parsed env object; mutate + restore.
interface X402Env {
  X402_ENABLED: boolean;
  X402_BUYER_PRIVATE_KEY: string | undefined;
  MANTUA_ADMIN_PRIVATE_KEY: string | undefined;
  X402_MAX_CALL_USD: number;
  X402_DAILY_CAP_USD: number;
}
const e = env as unknown as X402Env;
const savedEnv: X402Env = {
  X402_ENABLED: e.X402_ENABLED,
  X402_BUYER_PRIVATE_KEY: e.X402_BUYER_PRIVATE_KEY,
  MANTUA_ADMIN_PRIVATE_KEY: e.MANTUA_ADMIN_PRIVATE_KEY,
  X402_MAX_CALL_USD: e.X402_MAX_CALL_USD,
  X402_DAILY_CAP_USD: e.X402_DAILY_CAP_USD,
};

// ---- fakes -----------------------------------------------------------------

const realFetch = globalThis.fetch;

interface SeenRequest {
  url: string;
  method: string;
  paidHeader: boolean;
}

/** Encode a 402 PAYMENT-REQUIRED header the way the x402 spec does. */
function paymentRequiredHeader(amountAtomic: string): string {
  const body = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: BASE_NETWORK,
        amount: amountAtomic,
        payTo: "0x000000000000000000000000000000000000dEaD",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    ],
  };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

function paywallResponse(amountAtomic: string): Response {
  return new Response(JSON.stringify({}), {
    status: 402,
    headers: { "PAYMENT-REQUIRED": paymentRequiredHeader(amountAtomic) },
  });
}

/**
 * Install a fake global fetch. Requests to the service URL are answered by
 * `service` (called with 1-based call ordinal); everything else is treated as
 * a viem JSON-RPC call and answered from `rpc`.
 */
function installFetch(opts: {
  service: (call: number, req: SeenRequest) => Response;
  /** USDC balanceOf result in atomic units; "error" makes the RPC read fail. */
  rpcBalance?: bigint | "error";
}): { seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  let serviceCalls = 0;
  globalThis.fetch = async (input, init): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = req?.method ?? init?.method ?? "GET";
    const headers = new Headers(req ? req.headers : init?.headers);
    const paidHeader = headers.has("payment-signature") || headers.has("x-payment");
    const record: SeenRequest = { url, method, paidHeader };
    seen.push(record);

    if (url.startsWith(SERVICE_URL)) {
      serviceCalls += 1;
      return opts.service(serviceCalls, record);
    }

    // Anything else is viem's RPC transport asking for the buyer's USDC balance.
    const bodyText = req ? await req.text() : typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(bodyText) as { id?: number } | { id?: number }[];
    const id = (Array.isArray(parsed) ? parsed[0]?.id : parsed.id) ?? 1;
    if (opts.rpcBalance === "error" || opts.rpcBalance === undefined) {
      return Response.json({ jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted" } });
    }
    const result = `0x${opts.rpcBalance.toString(16).padStart(64, "0")}`;
    return Response.json({ jsonrpc: "2.0", id, result });
  };
  return { seen };
}

/** Rows returned by the stubbed daily-spend query (shape of the real select). */
type AuditParamsRow = { params: unknown };

interface DbStub {
  /** What getTodayX402Spend's select will resolve with. */
  spendRows: AuditParamsRow[];
  /** Every row logAudit tried to insert. */
  inserted: Record<string, unknown>[];
  selectCalls: number;
}

/** Stub the drizzle facade's select/insert entry points (restored per test). */
function installDb(spendRows: AuditParamsRow[] = []): DbStub {
  const stub: DbStub = { spendRows, inserted: [], selectCalls: 0 };
  const target = db as unknown as Record<string, unknown>;
  target["select"] = () => {
    stub.selectCalls += 1;
    return { from: () => ({ where: () => Promise.resolve(stub.spendRows) }) };
  };
  target["insert"] = () => ({
    values: (row: Record<string, unknown>) => {
      stub.inserted.push(row);
      return Promise.resolve();
    },
  });
  return stub;
}

const dbProto = Object.getPrototypeOf(db) as object;

beforeEach(() => {
  e.X402_ENABLED = true;
  e.X402_BUYER_PRIVATE_KEY = TEST_KEY;
  e.MANTUA_ADMIN_PRIVATE_KEY = undefined;
  e.X402_MAX_CALL_USD = 0.1;
  e.X402_DAILY_CAP_USD = 1;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  // Drop the per-test own-property stubs so the prototype methods return.
  const target = db as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(target, "select")) delete target["select"];
  if (Object.prototype.hasOwnProperty.call(target, "insert")) delete target["insert"];
  assert.equal(Object.getPrototypeOf(db), dbProto);
  Object.assign(e, savedEnv);
});

// ---- availability + degrade-to-free ---------------------------------------

void describe("x402 buyer — disabled/keyless mode degrades to free data", () => {
  void it("is available only when enabled AND a key exists", async () => {
    assert.equal(await isX402Available(), true);
    assert.equal(getBuyerAddress(), TEST_ADDR);

    e.X402_ENABLED = false;
    assert.equal(await isX402Available(), false, "flag off → unavailable");

    e.X402_ENABLED = true;
    e.X402_BUYER_PRIVATE_KEY = undefined;
    assert.equal(await isX402Available(), false, "no key → unavailable");
    assert.equal(getBuyerAddress(), null);
  });

  void it("falls back to the admin key when no dedicated buyer key is set", () => {
    e.X402_BUYER_PRIVATE_KEY = undefined;
    e.MANTUA_ADMIN_PRIVATE_KEY = TEST_KEY;
    assert.equal(getBuyerAddress(), TEST_ADDR);
  });

  void it("refuses a paid call while disabled — and never touches the network", async () => {
    e.X402_ENABLED = false;
    const { seen } = installFetch({ service: () => paywallResponse("10000") });
    installDb();
    await assert.rejects(
      callPaidService({ url: SERVICE_URL }),
      (err: unknown) =>
        err instanceof X402Error && !err.mayHaveCharged && /not enabled/.test(err.message),
    );
    assert.equal(seen.length, 0, "no request may leave the process while disabled");
  });

  void it("refuses a paid call with no key configured (keyless mode)", async () => {
    e.X402_BUYER_PRIVATE_KEY = undefined;
    e.MANTUA_ADMIN_PRIVATE_KEY = undefined;
    const { seen } = installFetch({ service: () => paywallResponse("10000") });
    installDb();
    await assert.rejects(callPaidService({ url: SERVICE_URL }), /not enabled/);
    assert.equal(seen.length, 0);
  });

  void it("returns a free response as-is when the endpoint has no paywall", async () => {
    const { seen } = installFetch({
      service: () => Response.json({ hello: "free" }),
    });
    const dbStub = installDb();
    const result = await callPaidService({ url: SERVICE_URL });
    assert.deepEqual(result, {
      service: SERVICE_URL,
      chain: "none",
      usdCost: 0,
      response: { hello: "free" },
    });
    assert.equal(seen.length, 1, "one bare request, no payment retry");
    assert.equal(dbStub.inserted.length, 0, "free data writes no audit row");
  });
});

// ---- input validation ------------------------------------------------------

void describe("x402 buyer — input validation happens before any traffic", () => {
  void it("rejects a malformed url", async () => {
    const { seen } = installFetch({ service: () => paywallResponse("10000") });
    await assert.rejects(callPaidService({ url: "not a url" }), /not a valid URL/);
    await assert.rejects(callPaidService({ url: "ftp://example.test/x" }), /must be http/);
    await assert.rejects(callPaidService({ url: 42 }), /must be a string/);
    assert.equal(seen.length, 0);
  });

  void it("rejects methods other than GET/POST", async () => {
    const { seen } = installFetch({ service: () => paywallResponse("10000") });
    await assert.rejects(
      callPaidService({ url: SERVICE_URL, method: "DELETE" }),
      /must be GET or POST/,
    );
    assert.equal(seen.length, 0);
  });
});

// ---- per-call ceiling ------------------------------------------------------

void describe("x402 buyer — per-call ceiling (X402_MAX_CALL_USD)", () => {
  void it("rejects a price above the ceiling before consulting the daily budget", async () => {
    const { seen } = installFetch({ service: () => paywallResponse("250000") }); // $0.25
    const dbStub = installDb();
    await assert.rejects(
      callPaidService({ url: SERVICE_URL }),
      (err: unknown) =>
        err instanceof X402Error &&
        !err.mayHaveCharged &&
        /costs \$0\.25, over the per-call cap of \$0\.1/.test(err.message),
    );
    assert.equal(seen.length, 1, "only the price pre-flight fired");
    assert.equal(dbStub.selectCalls, 0, "the ceiling rejects before the daily-cap query");
    assert.equal(dbStub.inserted.length, 0, "nothing signed, nothing audited");
  });

  void it("a price exactly at the ceiling is allowed through to the daily-cap check", async () => {
    e.X402_MAX_CALL_USD = 0.25;
    const { seen } = installFetch({ service: () => paywallResponse("250000") }); // $0.25 == cap
    // Make the daily cap the one that stops it, proving the per-call gate passed.
    const dbStub = installDb([{ params: { usdCost: 1 } }]);
    await assert.rejects(callPaidService({ url: SERVICE_URL }), /Daily x402 cap/);
    assert.equal(dbStub.selectCalls, 1);
    assert.equal(seen.length, 1, "still no payment attempt");
  });
});

// ---- daily cap -------------------------------------------------------------

void describe("x402 buyer — daily cap summed from agent_x402 audit rows", () => {
  void it("getTodayX402Spend sums usdCost and ignores malformed rows", async () => {
    installFetch({ service: () => paywallResponse("10000") });
    installDb([
      { params: { usdCost: 0.5 } },
      { params: { usdCost: 0.25 } },
      { params: { usdCost: "0.99" } }, // wrong type — ignored
      { params: { other: 1 } },
      { params: null },
    ]);
    assert.equal(await getTodayX402Spend(), 0.75);
  });

  void it("rejects when today's spend plus the price crosses the cap", async () => {
    const { seen } = installFetch({ service: () => paywallResponse("50000") }); // $0.05
    const dbStub = installDb([{ params: { usdCost: 0.5 } }, { params: { usdCost: 0.5 } }]); // $1 spent
    await assert.rejects(
      callPaidService({ url: SERVICE_URL }),
      (err: unknown) =>
        err instanceof X402Error &&
        !err.mayHaveCharged &&
        /Daily x402 cap \$1 would be exceeded \(\$1 spent today\)/.test(err.message),
    );
    assert.equal(seen.length, 1, "no payment attempt once the cap blocks");
    assert.equal(dbStub.inserted.length, 0, "a blocked call writes no audit row");
  });

  void it("allows a call that lands exactly on the cap", async () => {
    const { seen } = installFetch({
      service: (call) =>
        call === 1 ? paywallResponse("250000") : Response.json({ data: "paid" }), // $0.25
      rpcBalance: 5_000_000n, // $5 on Base — plenty
    });
    e.X402_MAX_CALL_USD = 0.25;
    const dbStub = installDb([{ params: { usdCost: 0.5 } }, { params: { usdCost: 0.25 } }]); // $0.75
    const result = await callPaidService({ url: SERVICE_URL }); // 0.75 + 0.25 == 1 → allowed
    assert.equal(result.usdCost, 0.25);
    assert.equal(dbStub.inserted.length, 1, "the settled call is audited");
    assert.ok(seen.length >= 2, "pre-flight plus the paid request");
  });
});

// ---- audit trail -----------------------------------------------------------

void describe("x402 buyer — one audit row per payment", () => {
  void it("writes a success row with url/method/chain/usdCost after a paid call", async () => {
    installFetch({
      service: (call) =>
        call === 1 ? paywallResponse("50000") : Response.json({ data: "paid" }), // $0.05
      rpcBalance: 1_000_000n, // $1
    });
    const dbStub = installDb([]);
    const result = await callPaidService({ url: SERVICE_URL });

    assert.equal(result.usdCost, 0.05);
    assert.equal(result.chain, BASE_NETWORK);
    assert.deepEqual(result.response, { data: "paid" });

    assert.equal(dbStub.inserted.length, 1, "exactly one audit row per payment");
    const row = dbStub.inserted[0];
    assert.ok(row);
    assert.equal(row["action"], "agent_x402");
    assert.equal(row["outcome"], "success");
    assert.equal(row["walletAddress"], TEST_ADDR.toLowerCase());
    assert.deepEqual(row["params"], {
      url: SERVICE_URL,
      method: "GET",
      chain: BASE_NETWORK,
      usdCost: 0.05,
    });
  });

  void it("writes a failure row and flags mayHaveCharged when the service 500s after payment", async () => {
    installFetch({
      service: (call) =>
        call === 1
          ? paywallResponse("50000")
          : new Response("boom", { status: 500 }),
      rpcBalance: 1_000_000n,
    });
    const dbStub = installDb([]);
    await assert.rejects(
      callPaidService({ url: SERVICE_URL }),
      (err: unknown) =>
        err instanceof X402Error && err.mayHaveCharged && /HTTP 500/.test(err.message),
    );
    assert.equal(dbStub.inserted.length, 1);
    const row = dbStub.inserted[0];
    assert.ok(row);
    assert.equal(row["outcome"], "failure");
    assert.deepEqual(row["params"], {
      url: SERVICE_URL,
      method: "GET",
      reason: "http_500_after_payment",
    });
  });
});

// ---- balance pre-flight ----------------------------------------------------

void describe("x402 buyer — balance pre-flight on the settlement rail", () => {
  void it("turns a doomed payment into a clear error before signing", async () => {
    const { seen } = installFetch({
      service: () => paywallResponse("50000"), // $0.05
      rpcBalance: 10_000n, // $0.01 — underfunded
    });
    const dbStub = installDb([]);
    await assert.rejects(
      callPaidService({ url: SERVICE_URL }),
      (err: unknown) =>
        err instanceof X402Error &&
        !err.mayHaveCharged &&
        /holds only \$0\.01 USDC on Base mainnet/.test(err.message) &&
        /Nothing was charged/.test(err.message),
    );
    assert.equal(seen.filter((s) => s.url.startsWith(SERVICE_URL)).length, 1);
    assert.equal(dbStub.inserted.length, 0);
  });

  void it("fails open when the balance read errors (facilitator stays the source of truth)", async () => {
    installFetch({
      service: (call) =>
        call === 1 ? paywallResponse("50000") : Response.json({ data: "paid" }),
      rpcBalance: "error",
    });
    const dbStub = installDb([]);
    const result = await callPaidService({ url: SERVICE_URL });
    assert.equal(result.usdCost, 0.05);
    assert.equal(dbStub.inserted.length, 1, "the call proceeds and is audited");
  });
});
