/**
 * Task 067 (G-001) — a scripted JSON-RPC node for the browser suite. The
 * client's read transport points at `/__e2e/rpc` (VITE_BASE_RPC_URL) and
 * Playwright answers it here: gas, nonce, estimates, a broadcast that
 * returns one hash, and a receipt that says the trade mined. Batches are
 * answered element-wise, as viem sends them.
 */
export const E2E_TX_HASH = `0x${"ab".repeat(32)}`;
const ZERO_WORD = `0x${"0".repeat(64)}`;

interface RpcRequest {
  id: number | string;
  method: string;
  params?: unknown[];
}

/** The hash a lookup asks for, or the one broadcast when the call is malformed. */
function requestedHash(req: RpcRequest): string {
  const first = req.params?.[0];
  return typeof first === "string" ? first : E2E_TX_HASH;
}

function receipt(hash: string) {
  return {
    status: "0x1",
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: `0x${"cd".repeat(32)}`,
    blockNumber: "0x101",
    from: "0x00000000000000000000000000000000000000aa",
    to: "0x00000000000000000000000000000000000000ee",
    contractAddress: null,
    gasUsed: "0x5208",
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x3b9aca00",
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    type: "0x2",
  };
}

function block() {
  return {
    number: "0x101",
    hash: `0x${"cd".repeat(32)}`,
    parentHash: `0x${"ef".repeat(32)}`,
    timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
    baseFeePerGas: "0x3b9aca00",
    gasLimit: "0x1c9c380",
    gasUsed: "0x5208",
    miner: "0x0000000000000000000000000000000000000000",
    nonce: "0x0000000000000000",
    transactions: [],
  };
}

export function answer(req: RpcRequest): {
  id: number | string;
  jsonrpc: "2.0";
  result?: unknown;
  error?: unknown;
} {
  const ok = (result: unknown) => ({ id: req.id, jsonrpc: "2.0" as const, result });
  switch (req.method) {
    case "eth_chainId":
      return ok("0x2105");
    case "eth_blockNumber":
      return ok("0x101");
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas":
      return ok("0x3b9aca00");
    case "eth_estimateGas":
      return ok("0x30d40");
    case "eth_getTransactionCount":
      return ok("0x1");
    case "eth_call":
    case "eth_getBalance":
      return ok(ZERO_WORD);
    case "eth_getCode":
      return ok("0x");
    case "eth_sendRawTransaction":
      return ok(E2E_TX_HASH);
    case "eth_getTransactionReceipt":
      return ok(receipt(requestedHash(req)));
    case "eth_getTransactionByHash":
      return ok({
        hash: requestedHash(req),
        blockNumber: "0x101",
        blockHash: `0x${"cd".repeat(32)}`,
      });
    case "eth_getBlockByNumber":
    case "eth_getBlockByHash":
      return ok(block());
    case "eth_feeHistory":
      return ok({
        baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
        gasUsedRatio: [0.5],
        oldestBlock: "0x100",
        reward: [["0x1"]],
      });
    default:
      return {
        id: req.id,
        jsonrpc: "2.0",
        error: { code: -32601, message: `e2e rpc: ${req.method} not scripted` },
      };
  }
}

/** Body of a JSON-RPC POST (single or batch) → the response body. */
export function respond(body: string): string {
  const parsed = JSON.parse(body) as RpcRequest | RpcRequest[];
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed));
}
