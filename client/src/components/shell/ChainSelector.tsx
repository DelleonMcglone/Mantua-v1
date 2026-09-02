import { CHAIN_INFO, DEFAULT_CHAIN_ID, networkKeyForChain } from "@/lib/chains.ts";
import { NetworkLogo } from "./network-icons.tsx";

interface Props {
  /** Kept for call-site compatibility with the old dropdown selector;
   *  the single-chain chip renders the same either way. */
  direction?: "up" | "down";
}

/**
 * Chain chip — the official Base Square logo plus the chain name. Mantua
 * runs on Base Mainnet only, so this is a static indicator (the old
 * multi-chain dropdown is gone). Rendered in the header and under the
 * chat input.
 */
export function ChainSelector(_props: Props) {
  const info = CHAIN_INFO[DEFAULT_CHAIN_ID];

  return (
    <span
      aria-label={`Network: ${info.displayName}`}
      className="px-2.5 py-1 rounded-full border border-border bg-bg-elev text-text-dim text-[12px] inline-flex items-center gap-1.5"
    >
      <NetworkLogo network={networkKeyForChain(DEFAULT_CHAIN_ID)} size={14} />
      {info.shortName}
    </span>
  );
}
