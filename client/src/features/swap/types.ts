/**
 * Quote response shape returned by /api/quote. Mirrors the trimmed Uniswap
 * Trading API response on the server. We only use the fields below; the
 * full nested object is opaque to the client (passed back to /api/swap/calldata).
 */
export interface QuoteResponse {
  quote: {
    requestId: string;
    routing: string;
    permitData: PermitData | null;
    quote: {
      chainId: number;
      swapper: string;
      tradeType: string;
      slippage?: number;
      priceImpact?: number;
      gasFee?: string;
      gasFeeUSD?: string;
      quoteId: string;
      input: { amount: string; token: string };
      output: { amount: string; token: string; recipient: string };
      aggregatedOutputs?: Array<{ amount: string; token: string; minAmount: string }>;
    };
  };
  slippageWarning: "ok" | "warn" | "double_confirm";
}

export interface PermitData {
  domain: unknown;
  types: unknown;
  values: unknown;
}

export interface SwapTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  gasLimit?: string;
}
