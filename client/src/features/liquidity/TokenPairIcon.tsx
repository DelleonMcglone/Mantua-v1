import { AssetIcon, type AssetSymbol } from "@/features/portfolio/asset-icons.tsx";

const KNOWN: AssetSymbol[] = ["USDC", "EURC", "cbBTC"];

function FallbackCoin({ symbol, size }: { symbol: string; size: number }) {
  const initial = symbol.slice(0, 1).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#3b3b46" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="#fff"
        fontFamily="Inter, sans-serif"
      >
        {initial}
      </text>
    </svg>
  );
}

function CoinIcon({ symbol, size }: { symbol: string; size: number }) {
  const norm = symbol === "WETH" ? "ETH" : symbol;
  if ((KNOWN as readonly string[]).includes(norm)) {
    return <AssetIcon symbol={norm as AssetSymbol} size={size} />;
  }
  return <FallbackCoin symbol={symbol} size={size} />;
}

interface Props {
  a: string;
  b: string;
  size?: number;
}

/**
 * Overlapping token-pair badge — matches the design's
 * `<AssetIcon a={…}>` pair pattern from panels.jsx:165-169
 * (two tokens with `marginLeft:-8` overlap).
 */
export function TokenPairIcon({ a, b, size = 22 }: Props) {
  return (
    <div className="flex items-center">
      <CoinIcon symbol={a} size={size} />
      <div style={{ marginLeft: -8 }}>
        <CoinIcon symbol={b} size={size} />
      </div>
    </div>
  );
}
