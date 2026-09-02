import { TOKENS, type TokenSymbol } from "@/lib/tokens.ts";
import { formatTokenAmount } from "./format.ts";
import type { QuoteResponse } from "./types.ts";

interface QuoteDetailsProps {
  quote: QuoteResponse;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
}

export function QuoteDetails({ quote, tokenIn, tokenOut }: QuoteDetailsProps) {
  const q = quote.quote.quote;
  const expectedOut = formatTokenAmount(tokenOut, q.output.amount);
  const inAmount = formatTokenAmount(tokenIn, q.input.amount);
  const aggregated = q.aggregatedOutputs?.[0];
  const minOut = aggregated ? formatTokenAmount(tokenOut, aggregated.minAmount) : null;
  const priceImpactPct = q.priceImpact !== undefined ? (q.priceImpact * 100).toFixed(3) : null;
  const slippagePct = q.slippage !== undefined ? q.slippage.toFixed(2) : null;
  const gasUsd = q.gasFeeUSD ? `$${parseFloat(q.gasFeeUSD).toFixed(4)}` : null;
  const rate = computeRate(inAmount, expectedOut, tokenIn, tokenOut);

  return (
    <dl className="text-xs space-y-2 px-1">
      <Row label="Rate" value={rate} mono />
      <Row label="Expected output" value={`${expectedOut} ${TOKENS[tokenOut].symbol}`} mono />
      {minOut && <Row label="Min received" value={`${minOut} ${TOKENS[tokenOut].symbol}`} mono />}
      {priceImpactPct && <Row label="Price impact" value={`${priceImpactPct}%`} />}
      {slippagePct && <Row label="Slippage" value={`${slippagePct}%`} />}
      {gasUsd && <Row label="Network fee" value={gasUsd} />}
      <Row label="Route" value={quote.quote.routing} />
    </dl>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-dim">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}

function computeRate(inAmt: string, outAmt: string, tIn: TokenSymbol, tOut: TokenSymbol): string {
  const inN = parseFloat(inAmt);
  const outN = parseFloat(outAmt);
  if (!Number.isFinite(inN) || !Number.isFinite(outN) || inN === 0) return "—";
  const rate = outN / inN;
  return `1 ${tIn} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tOut}`;
}
