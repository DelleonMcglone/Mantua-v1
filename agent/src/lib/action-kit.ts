/**
 * Minimal action-kit — the local replacement for Coinbase AgentKit.
 *
 * An action provider exposes a set of named actions; `getActions(wallet)`
 * binds the wallet and returns actions whose `invoke(rawArgs)` validates its
 * input with its own zod schema (parse-inside) and performs the on-chain work.
 * `createActionKit` flattens providers into a single registry — what an LLM
 * tool loop would enumerate and dispatch.
 */
import type { ZodTypeAny } from "zod";
import type { PublicClient, TransactionReceipt } from "viem";

/** The wallet surface the agent's actions use — backed by viem on Base. */
export interface AgentWallet {
  getAddress(): string;
  readContract: PublicClient["readContract"];
  getBalance(): Promise<bigint>;
  sendTransaction(tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<`0x${string}`>;
  waitForTransactionReceipt(hash: `0x${string}`): Promise<TransactionReceipt>;
}

/** An action definition. `invoke` receives raw args and validates them with
 *  `schema` (parse-inside), keeping the registry free of per-action generics. */
export interface ActionDef {
  name: string;
  description: string;
  schema: ZodTypeAny;
  invoke: (wallet: AgentWallet, rawArgs: unknown) => Promise<string>;
}

/** An action with the wallet already bound. */
export interface BoundAction {
  name: string;
  description: string;
  schema: ZodTypeAny;
  invoke: (rawArgs: unknown) => Promise<string>;
}

export interface ActionProvider {
  getActions(wallet: AgentWallet): BoundAction[];
}

export function customActionProvider(defs: ActionDef[]): ActionProvider {
  return {
    getActions: (wallet) =>
      defs.map((d) => ({
        name: d.name,
        description: d.description,
        schema: d.schema,
        invoke: (rawArgs: unknown) => d.invoke(wallet, rawArgs),
      })),
  };
}

export interface ActionKit {
  getActions(): BoundAction[];
}

export function createActionKit(wallet: AgentWallet, providers: ActionProvider[]): ActionKit {
  const actions = providers.flatMap((p) => p.getActions(wallet));
  return { getActions: () => actions };
}
