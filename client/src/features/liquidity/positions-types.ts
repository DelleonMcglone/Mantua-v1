export interface Position {
  id: string;
  tokenId: string | null;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  status: "open" | "closed";
  openedTx: string | null;
  closedTx: string | null;
  createdAt: string;
  poolKeyHash: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  hookAddress: string | null;
  /** Pre-formatted uncollected-fees label (e.g. "0.0123 USDC · 0.0001 cbBTC")
   *  for on-chain-discovered rows; undefined when fee data isn't available. */
  feesLabel?: string | null;
}
