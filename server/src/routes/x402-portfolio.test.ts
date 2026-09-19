import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createX402PortfolioRouter, type X402PortfolioDeps } from "./x402-portfolio.ts";
import type { OnchainPosition } from "../lib/v4-onchain-positions.ts";
import type { EnrichedPosition } from "../lib/external-positions.ts";

/**
 * Phase 17 (MP-009) — tests for the PAID portfolio-exposure service on
 * /api/x402/v1/portfolio/exposure (`server/src/routes/x402-portfolio.ts`), on
 * the house ephemeral-app + factory-overrides pattern (x402-trading.test.ts).
 * The paywall is real; the facilitator behind it is a spy.
 *
 * Covered: unpaid → 402 with BOTH rails; paid → 200 with both position
 * readers' results and totals; a malformed address → 400; an on-chain read
 * failure → 503 (the caller paid for an answer); absent
 * X402_SELLER_SERVICES → 503 dark. The position readers themselves have
 * their own tests — fixtures here are minimal shapes behind the seams.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const express = (await import("express")).default;

const SELLER = "0x00000000000000000000000000000000DeaDBeef";
const PAYER = "0x1111111111111111111111111111111111111111";
const PATH = "/api/x402/v1/portfolio/exposure";
const ADDRESS = "0xAbCdEf0000000000000000000000000000001234";

// The paywall syncs supported payment kinds from the facilitator on first
// use; answer that handshake locally (any non-local URL) and pass the
// ephemeral test server through to the real fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    return Promise.resolve(
      Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
        extensions: [],
        signers: {},
      }),
    );
  }
  return realFetch(input, init);
};

const servers: Server[] = [];
after(() => {
  globalThis.fetch = realFetch;
  for (const s of servers) s.close();
});

interface Harness {
  mantuaCalls: string[];
  externalCalls: string[];
  paid(query: string, payer?: string): Promise<Response>;
}

async function boot(
  over: Partial<X402PortfolioDeps> & {
    enabledServiceIds?: string[];
    mantuaReject?: boolean;
  } = {},
): Promise<Harness> {
  const mantuaCalls: string[] = [];
  const externalCalls: string[] = [];
  const verifyCalls = { count: 0 };
  const settleCalls = { count: 0 };
  const facilitator = {
    calls: {
      get verify() {
        return verifyCalls.count;
      },
      get settle() {
        return settleCalls.count;
      },
    },
    verify: () => {
      verifyCalls.count++;
      return Promise.resolve({ isValid: true, payer: PAYER });
    },
    settle: () => {
      settleCalls.count++;
      return Promise.resolve({
        success: true,
        transaction: "0xtxhash",
        network: "eip155:8453" as const,
        payer: PAYER,
      });
    },
    getSupported: () =>
      Promise.resolve({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" as const }],
        extensions: [],
        signers: {},
      }),
  };
  const deps: X402PortfolioDeps = {
    mantuaPositions: (owner) => {
      mantuaCalls.push(owner);
      if (over.mantuaReject) return Promise.reject(new Error("rpc down"));
      return Promise.resolve([
        {
          chainId: 8453,
          tokenId: "777",
          positionManager: "0xpm",
          tokenA: "USDC",
          tokenB: "YES",
          fee: 100,
        } as unknown as OnchainPosition,
      ]);
    },
    externalPositions: (walletAddress) => {
      externalCalls.push(walletAddress);
      return Promise.resolve([
        {
          id: "ext-1",
          tokenId: "888",
          tickLower: -60,
          tickUpper: 60,
          liquidity: "1000",
          status: "open",
          openedTx: null,
          closedTx: null,
          createdAt: "2026-09-01T00:00:00Z",
          poolKeyHash: "0xpk",
        } as unknown as EnrichedPosition,
      ]);
    },
    paywall: {
      sellerAddress: SELLER,
      enabledServiceIds: over.enabledServiceIds ?? ["portfolio-exposure"],
      auditSale: async () => {}, // hermetic — no DB in unit tests
      vanillaFacilitator: facilitator,
    },
    ...over,
  };
  const app = express();
  app.use(express.json());
  app.use(createX402PortfolioRouter(deps));
  await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(server);
    });
  });
  const addr = (servers[servers.length - 1].address() as { port: number }).port;
  const origin = `http://127.0.0.1:${String(addr)}`;

  async function paid(query: string, payer = PAYER): Promise<Response> {
    // The 402 dance: an unpaid request captures the PAYMENT-REQUIRED accepts
    // row; the follow-up presents a crafted payment header for `payer`.
    const unpaid = await realFetch(`${origin}${PATH}${query}`);
    assert.equal(unpaid.status, 402, `prelude: ${PATH} must 402 an unpaid request`);
    const required = JSON.parse(
      Buffer.from(unpaid.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: unknown[]; resource?: unknown };
    const accepted = required.accepts?.[0];
    assert.ok(accepted, "prelude: 402 must advertise an accepts row");
    const payment = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted,
        resource: required.resource,
        authorization: { from: payer },
        signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 },
      }),
    ).toString("base64");
    return realFetch(`${origin}${PATH}${query}`, {
      headers: { "payment-signature": payment },
    });
  }

  return { mantuaCalls, externalCalls, paid };
}

void describe("paid portfolio-exposure service (MP-009)", () => {
  void it("402s an unpaid request with BOTH rails in accepts", async () => {
    await boot();
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?address=${ADDRESS}`);
    assert.equal(res.status, 402, "payment IS the auth — unpaid requests get 402");
    const required = JSON.parse(
      Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8"),
    ) as { accepts?: { extra?: { name?: string } }[] };
    assert.equal(required.accepts?.length, 2, "one 402, two rails");
    assert.deepEqual(required.accepts[0].extra, { name: "USD Coin", version: "2" });
    assert.equal(required.accepts[1].extra?.name, "GatewayWalletBatched");
  });

  void it("200s a paid request with both position sets and totals", async () => {
    const h = await boot();
    const res = await h.paid(`?address=${ADDRESS}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      address: string;
      network: string;
      positions: { mantua: unknown[]; external: unknown[] };
      totals: { mantua: number; external: number };
    };
    assert.equal(body.address, ADDRESS.toLowerCase(), "the address is normalized");
    assert.equal(body.network, "eip155:8453");
    assert.equal(body.positions.mantua.length, 1);
    assert.equal(body.positions.external.length, 1);
    assert.deepEqual(body.totals, { mantua: 1, external: 1 });
    assert.deepEqual(h.mantuaCalls, [ADDRESS.toLowerCase()]);
    assert.deepEqual(h.externalCalls, [ADDRESS.toLowerCase()]);
  });

  void it("400s a malformed address before any read", async () => {
    const h = await boot();
    const res = await h.paid("?address=0x1234");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "BAD_ADDRESS");
    assert.equal(h.mantuaCalls.length, 0);
    assert.equal(h.externalCalls.length, 0);
  });

  void it("503s when the on-chain read fails — the caller paid for an answer", async () => {
    const h = await boot({ mantuaReject: true });
    const res = await h.paid(`?address=${ADDRESS}`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "UNAVAILABLE");
  });

  void it("503s dark when the service is absent from X402_SELLER_SERVICES", async () => {
    const h = await boot({ enabledServiceIds: ["trading-quote"] });
    const origin = `http://127.0.0.1:${String(
      (servers[servers.length - 1].address() as { port: number }).port,
    )}`;
    const res = await realFetch(`${origin}${PATH}?address=${ADDRESS}`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "X402_SERVICE_DISABLED");
    assert.equal(h.mantuaCalls.length, 0);
  });
});
