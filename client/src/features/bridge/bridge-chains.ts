/**
 * Outbound bridge destinations (USDC, CCTP V2) from Base Mainnet. Every
 * CCTP-V2 mainnet chain Bridge Kit can reach from Base is listed — typing
 * "bridge 10 USDC to arbitrum" selects the matching card. (Solana is
 * skipped because the app only holds an EVM recipient address.)
 *
 * `sdkName` is the exact Bridge Kit string chain identifier (the SDK's
 * `chain:` param also accepts these literals). If a route turns out not to
 * support the Forwarding Service at runtime the bridge surfaces a clear
 * "route unavailable" message (see use-bridge.ts).
 */
export type BridgeChainName =
  | "Ethereum"
  | "Arbitrum"
  | "Optimism"
  | "Polygon"
  | "Avalanche";

export interface BridgeDestination {
  sdkName: BridgeChainName;
  label: string;
  /** CCTP domain — shown for reference, not used in the SDK call. */
  cctpDomain: number;
  explorerTxUrl: (hash: string) => string;
}

/** Source is fixed: the app lives on Base Mainnet. */
export const SOURCE_CHAIN = "Base" as const;

/** Word/alias → destination, for parsing typed bridge commands. Order matters:
 *  more specific aliases first so "arbitrum" doesn't swallow "arb" etc. */
const DESTINATION_ALIASES: { sdkName: BridgeChainName; aliases: RegExp }[] = [
  { sdkName: "Arbitrum", aliases: /\b(arbitrum|arb)\b/ },
  { sdkName: "Optimism", aliases: /\b(optimism|op)\b/ },
  { sdkName: "Polygon", aliases: /\b(polygon|matic)\b/ },
  { sdkName: "Avalanche", aliases: /\b(avalanche|avax)\b/ },
  // Ethereum last: plain "eth"/"ethereum"/"mainnet" → Ethereum only if none
  // of the more specific chains matched above.
  { sdkName: "Ethereum", aliases: /\b(ethereum|eth|mainnet)\b/ },
];

/** Match a destination chain from free text ("bridge 10 USDC to arbitrum"). */
export function matchBridgeDestination(text: string): BridgeDestination | undefined {
  const t = text.toLowerCase();
  for (const { sdkName, aliases } of DESTINATION_ALIASES) {
    if (aliases.test(t)) return BRIDGE_DESTINATIONS.find((d) => d.sdkName === sdkName);
  }
  return undefined;
}

export const BRIDGE_DESTINATIONS: BridgeDestination[] = [
  {
    sdkName: "Ethereum",
    label: "Ethereum",
    cctpDomain: 0,
    explorerTxUrl: (h) => `https://etherscan.io/tx/${h}`,
  },
  {
    sdkName: "Arbitrum",
    label: "Arbitrum One",
    cctpDomain: 3,
    explorerTxUrl: (h) => `https://arbiscan.io/tx/${h}`,
  },
  {
    sdkName: "Optimism",
    label: "OP Mainnet",
    cctpDomain: 2,
    explorerTxUrl: (h) => `https://optimistic.etherscan.io/tx/${h}`,
  },
  {
    sdkName: "Polygon",
    label: "Polygon",
    cctpDomain: 7,
    explorerTxUrl: (h) => `https://polygonscan.com/tx/${h}`,
  },
  {
    sdkName: "Avalanche",
    label: "Avalanche",
    cctpDomain: 1,
    explorerTxUrl: (h) => `https://snowtrace.io/tx/${h}`,
  },
];
