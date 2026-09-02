/**
 * Action-provider tests — verify each provider registers its expected
 * actions (wiring/happy path) and that input validation rejects bad
 * args before any transaction is attempted.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentWallet } from "../lib/action-kit.ts";
import { createBalancesActionProvider } from "./balances.ts";
import { createErc8004ActionProvider } from "./erc8004.ts";
import { createErc8183ActionProvider } from "./erc8183.ts";
import { createAssetAllowlist } from "../config/assets.ts";

const ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// getActions only binds the wallet into invoke; it never calls wallet
// methods, so a minimal stub is enough to enumerate action names.
const stubWallet = {
  getAddress: () => ADDR,
} as unknown as AgentWallet;

function names(actions: { name: string }[]): string[] {
  return actions.map((a) => a.name);
}

test("erc8004 provider registers the four identity/reputation actions", () => {
  const p = createErc8004ActionProvider({
    identityRegistry: ADDR,
    reputationRegistry: ADDR,
    validationRegistry: ADDR,
  });
  const ns = names(p.getActions(stubWallet));
  for (const want of [
    "register_agent_identity",
    "read_agent_registration",
    "read_agent_reputation",
    "verify_credential",
  ]) {
    assert.ok(
      ns.some((n) => n.endsWith(want)),
      `missing ${want} in [${ns.join(", ")}]`,
    );
  }
});

test("erc8183 provider registers job lifecycle actions", () => {
  const p = createErc8183ActionProvider({
    agenticCommerce: ADDR,
    usdc: { symbol: "USDC", address: ADDR, decimals: 6 },
  });
  const ns = names(p.getActions(stubWallet));
  for (const want of ["create_job", "fund_job", "settle_job", "get_job_status"]) {
    assert.ok(
      ns.some((n) => n.endsWith(want)),
      `missing ${want} in [${ns.join(", ")}]`,
    );
  }
});

test("balances provider registers check_balances", () => {
  const allowlist = createAssetAllowlist([{ symbol: "USDC", address: ADDR, decimals: 6 }]);
  const p = createBalancesActionProvider({ allowlist, lowGasWarnEth: 0.001 });
  assert.ok(names(p.getActions(stubWallet)).some((n) => n.endsWith("check_balances")));
});

test("create_job rejects an invalid provider address before any tx", async () => {
  const p = createErc8183ActionProvider({
    agenticCommerce: ADDR,
    usdc: { symbol: "USDC", address: ADDR, decimals: 6 },
  });
  const action = p.getActions(stubWallet).find((a) => a.name.endsWith("create_job"));
  assert.ok(action);
  await assert.rejects(
    () => action.invoke({ provider: "0xbad", evaluator: ADDR, description: "demo" }),
    /Invalid provider/,
  );
});

test("fund_job rejects a non-positive amount before any tx", async () => {
  const p = createErc8183ActionProvider({
    agenticCommerce: ADDR,
    usdc: { symbol: "USDC", address: ADDR, decimals: 6 },
  });
  const action = p.getActions(stubWallet).find((a) => a.name.endsWith("fund_job"));
  assert.ok(action);
  await assert.rejects(() => action.invoke({ jobId: "1", amountUSDC: "0" }), /amountUSDC/);
});
