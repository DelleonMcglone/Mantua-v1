import { Router, type Request, type Response } from "express";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";

export const rpcProxyRouter = Router();

/**
 * Same-origin JSON-RPC proxy for Base Mainnet — the wallet-side answer to the
 * public hosts' per-IP rate limits.
 *
 * Privy's embedded wallet fills gas itself (its "RPC 0x4cef52 Custom
 * eth_gasPrice" errors originate inside the wallet, not viem), fetching the
 * chain's FIRST rpcUrl directly — so no client-side transport wrapper can
 * shield it. Instead the client registers `<origin>/api/rpc` as the chain's
 * primary RPC: every wallet-originated call lands here, where we rotate
 * across the public hosts server-side, retry on 429s, and serve
 * eth_gasPrice / eth_chainId from a short cache. CORS is open because the
 * Privy iframe (auth.privy.io) calls cross-origin.
 *
 * Abuse surface is bounded: fixed upstreams (never user-supplied), a method
 * whitelist, and the global per-IP rate limiter still applies.
 */

const UPSTREAMS = [
  env.BASE_RPC_URL,
  ...["https://mainnet.base.org", "https://base-rpc.publicnode.com"].filter(
    (u) => u !== env.BASE_RPC_URL,
  ),
];

const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_estimateGas",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_getLogs",
  "eth_sendRawTransaction",
  "web3_clientVersion",
]);

interface RpcCall {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

/** 5s cache for hot, block-coarse values (gas price moves block-to-block at most). */
const hotCache = new Map<string, { value: unknown; expiresAt: number }>();
const HOT_METHODS: Record<string, number> = {
  eth_gasPrice: 5_000,
  eth_chainId: 300_000,
  eth_maxPriorityFeePerGas: 5_000,
  eth_blockNumber: 2_000,
};

function setCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

async function forward(body: unknown): Promise<unknown> {
  let lastErr: unknown = null;
  for (const url of UPSTREAMS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const json: unknown = await res.json().catch(() => null);
      if (json === null) {
        lastErr = new Error(`upstream ${url} returned non-JSON (${String(res.status)})`);
        continue;
      }
      // Rotate to the next host on a rate-limit response (HTTP 429 or a
      // JSON-RPC -32011 "request limit reached").
      const rpcErr = (json as { error?: { code?: number; message?: string } }).error;
      if (
        res.status === 429 ||
        rpcErr?.code === -32011 ||
        /request limit/i.test(rpcErr?.message ?? "")
      ) {
        lastErr = new Error(`upstream ${url} rate-limited`);
        continue;
      }
      return json;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all Base RPC upstreams failed");
}

rpcProxyRouter.options("/api/rpc", (_req: Request, res: Response) => {
  setCors(res);
  res.status(204).end();
});

rpcProxyRouter.post("/api/rpc", async (req: Request, res: Response) => {
  setCors(res);
  const body: unknown = req.body;
  const calls: (RpcCall | null | undefined)[] = Array.isArray(body)
    ? (body as RpcCall[])
    : [body as RpcCall | null | undefined];

  for (const c of calls) {
    if (typeof c?.method !== "string" || !ALLOWED_METHODS.has(c.method)) {
      res.status(400).json({
        jsonrpc: "2.0",
        id: c?.id ?? null,
        error: { code: -32601, message: `Method not allowed by proxy: ${String(c?.method)}` },
      });
      return;
    }
  }

  try {
    // Serve single hot calls from cache (batches and everything else forward).
    if (!Array.isArray(body)) {
      const single = body as RpcCall;
      const ttl = HOT_METHODS[single.method ?? ""];
      const hasParams = Array.isArray(single.params) && single.params.length > 0;
      if (ttl && !hasParams) {
        const hit = hotCache.get(single.method ?? "");
        if (hit && hit.expiresAt > Date.now()) {
          res.json({ jsonrpc: "2.0", id: single.id ?? null, result: hit.value });
          return;
        }
        const json = (await forward(body)) as { result?: unknown };
        if (json.result !== undefined) {
          hotCache.set(single.method ?? "", { value: json.result, expiresAt: Date.now() + ttl });
        }
        res.json(json);
        return;
      }
    }
    res.json(await forward(body));
  } catch (err) {
    logger.warn({ err }, "rpc proxy: all upstreams failed");
    res.status(502).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "All Base RPC upstreams failed. Retry shortly." },
    });
  }
});
