import { defineChain } from "viem";
import { arcTestnet } from "viem/chains";

/**
 * Arc Mainnet (5042) — Circle's L1 where USDC is the gas token. The pinned
 * viem (2.48.4) ships only `arcTestnet`, so mainnet is defined here from
 * docs.arc.io/arc/references/connect-to-arc (verified live 2026-09-29:
 * `eth_chainId` = 5042 on rpc.mainnet.arc.io). Native currency is USDC at
 * 18 decimals — the same balance the 6-decimal ERC-20 at 0x3600…0000 reads
 * (see native-usdc.ts); never show the two as separate assets.
 */
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://explorer.arc.io",
      apiUrl: "https://explorer.arc.io/api",
    },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: false,
});

/** Arc Testnet (5042002) — development only; never a production code path. */
export { arcTestnet };
