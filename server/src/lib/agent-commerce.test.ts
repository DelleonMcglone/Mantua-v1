/**
 * L-018 — the server's ERC-8183 ABI slice must match the contract the deploy
 * script ships (contracts/lib/base-contracts, vendored at 142e669). A drift
 * here would encode calldata the proxy reverts on — silently, from the
 * agent's point of view. Pinned two ways: a hard-coded fingerprint of every
 * signature the server sends, and (when the Foundry artifact is present)
 * the compiled ABI itself.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toFunctionSelector, type Abi, type AbiFunction } from "viem";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { AGENTIC_COMMERCE_ABI, JOB_STATUS } = await import("./agent-commerce.ts");

/** Signatures of the reference at 142e669 (contracts/lib/base-contracts). */
const EXPECTED = {
  createJob: "createJob(address,address,uint48,string,address,uint256)",
  fund: "fund(uint256,address,uint256,bytes)",
  complete: "complete(uint256,bytes32,bytes)",
  jobCounter: "jobCounter()",
  getJob: "getJob(uint256)",
} as const;

function signature(fn: AbiFunction): string {
  const params = fn.inputs.map((i) => i.type).join(",");
  return `${fn.name}(${params})`;
}

void describe("AgenticCommerce ABI ↔ vendored ERC-8183", () => {
  void it("sends exactly the reference's signatures", () => {
    const got = Object.fromEntries(
      AGENTIC_COMMERCE_ABI.map((fn) => [fn.name, signature(fn as AbiFunction)]),
    );
    assert.deepEqual(got, EXPECTED);
  });

  void it("JobStatus mirrors the contract enum order", () => {
    assert.deepEqual(
      [...JOB_STATUS],
      ["open", "funded", "submitted", "completed", "rejected", "expired"],
    );
  });

  void it("matches the compiled artifact's selectors when the Foundry build is present", (t) => {
    const artifact = fileURLToPath(
      new URL("../../../contracts/out/ERC8183.sol/ERC8183.json", import.meta.url),
    );
    if (!existsSync(artifact)) {
      t.skip("contracts/out/ERC8183.sol/ERC8183.json not built (run `forge build` in contracts/)");
      return;
    }
    const abi = (JSON.parse(readFileSync(artifact, "utf8")) as { abi: Abi }).abi;
    const compiled = new Set(
      abi.filter((f): f is AbiFunction => f.type === "function").map((f) => toFunctionSelector(f)),
    );
    for (const fn of AGENTIC_COMMERCE_ABI) {
      assert.ok(
        compiled.has(toFunctionSelector(fn)),
        `${signature(fn)} is not in the compiled ERC8183 ABI`,
      );
    }
  });
});
