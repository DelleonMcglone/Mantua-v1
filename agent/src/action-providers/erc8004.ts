/**
 * ERC-8004 action provider — agent identity & reputation on Base.
 * Actions: register_agent_identity, read_agent_registration,
 * read_agent_reputation, verify_credential. Registry addresses are
 * injected (from env) so this stays testable. Reads use readContract;
 * the one write (register) encodes calldata and sends via the wallet.
 */
import { encodeFunctionData } from "viem";
import { z } from "zod";
import { type ActionProvider, type AgentWallet, customActionProvider } from "../lib/action-kit.ts";
import {
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "../abis/erc8004.ts";
import { BASE_EXPLORER_URL } from "../config/base-chain.ts";

export interface Erc8004Config {
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
}

const txUrl = (hash: string): string => `${BASE_EXPLORER_URL}/tx/${hash}`;

const registerSchema = z.object({ agentURI: z.string().min(1, "agentURI is required") });
const agentIdSchema = z.object({ agentId: z.string().regex(/^\d+$/, "agentId must be a number") });
const requestHashSchema = z.object({
  requestHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "requestHash must be a 0x 32-byte hash"),
});

export function createErc8004ActionProvider(cfg: Erc8004Config): ActionProvider {
  return customActionProvider([
    {
      name: "register_agent_identity",
      description:
        "Register the agent's onchain identity in the ERC-8004 IdentityRegistry on Base, minting an identity NFT. Provide a metadata URI (e.g. an https/ipfs URL describing the agent).",
      schema: registerSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const { agentURI } = registerSchema.parse(raw);
        const data = encodeFunctionData({
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "register",
          args: [agentURI],
        });
        const hash = await wallet.sendTransaction({ to: cfg.identityRegistry, data });
        await wallet.waitForTransactionReceipt(hash);
        return `Registered agent identity. Tx: ${txUrl(hash)}. Read the new agentId via read_agent_registration (ownerOf of the minted token).`;
      },
    },
    {
      name: "read_agent_registration",
      description:
        "Read an ERC-8004 agent registration: owner wallet, metadata (token) URI, and bound agent wallet, by agentId.",
      schema: agentIdSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const { agentId } = agentIdSchema.parse(raw);
        const id = BigInt(agentId);
        const [owner, uri, agentWallet] = await Promise.all([
          wallet.readContract({
            address: cfg.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "ownerOf",
            args: [id],
          }),
          wallet.readContract({
            address: cfg.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "tokenURI",
            args: [id],
          }),
          wallet.readContract({
            address: cfg.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "getAgentWallet",
            args: [id],
          }),
        ]);
        return `Agent ${agentId}: owner=${owner}, agentWallet=${agentWallet}, metadataURI=${uri}`;
      },
    },
    {
      name: "read_agent_reputation",
      description:
        "Read an ERC-8004 agent's aggregate reputation (feedback count + summed score) from the ReputationRegistry, by agentId.",
      schema: agentIdSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const { agentId } = agentIdSchema.parse(raw);
        const id = BigInt(agentId);
        const clients = await wallet.readContract({
          address: cfg.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: "getClients",
          args: [id],
        });
        const [count, value, valueDecimals] = await wallet.readContract({
          address: cfg.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: "getSummary",
          args: [id, clients, "", ""],
        });
        return `Agent ${agentId} reputation: ${String(count)} feedback entries from ${String(clients.length)} clients; summed value ${String(value)} (×10^-${String(valueDecimals)}).`;
      },
    },
    {
      name: "verify_credential",
      description:
        "Verify a credential/validation request against the ERC-8004 ValidationRegistry by its requestHash. Returns the validator, agentId, and response (100 = passed, 0 = failed).",
      schema: requestHashSchema,
      invoke: async (wallet: AgentWallet, raw: unknown) => {
        const { requestHash } = requestHashSchema.parse(raw);
        const [validator, agentId, response, , tag, lastUpdate] = await wallet.readContract({
          address: cfg.validationRegistry,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: "getValidationStatus",
          args: [requestHash as `0x${string}`],
        });
        const verdict =
          response >= 100
            ? "PASSED"
            : response === 0
              ? "FAILED/none"
              : `partial (${String(response)})`;
        return `Credential ${requestHash}: ${verdict}. validator=${validator}, agentId=${String(agentId)}, tag=${tag}, lastUpdate=${String(lastUpdate)}.`;
      },
    },
  ]);
}
