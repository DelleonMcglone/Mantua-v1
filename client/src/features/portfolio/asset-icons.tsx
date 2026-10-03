/**
 * Token SVG icon — inline so it renders without extra requests; sized by
 * the `size` prop. The token set matches Mantua's one supported token on
 * Arc (see `client/src/lib/tokens.ts`): USDC.
 */

interface IconProps {
  size?: number;
}

/**
 * Circle's signature broken ring — two white arcs with gaps at top and
 * bottom (the centered glyph reads through the gaps).
 */
function CircleRing({ stroke = "#fff" }: { stroke?: string }) {
  return (
    <g fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round">
      <path d="M18.54 5.82 A10.5 10.5 0 0 1 18.54 26.18" />
      <path d="M13.46 26.18 A10.5 10.5 0 0 1 13.46 5.82" />
    </g>
  );
}

/** USDC — Circle blue with the broken ring + dollar mark. */
export function UsdcIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <CircleRing />
      <path
        d="M20.5 18.5c0-2.4-1.5-3.2-4.3-3.6-2-.3-2.5-.8-2.5-1.8s.7-1.5 2-1.5c1.2 0 1.9.4 2.3 1.4.1.2.3.3.5.3h1c.3 0 .5-.2.5-.5v-.1c-.3-1.4-1.5-2.5-3-2.6v-1.5c0-.3-.2-.5-.5-.6h-1c-.3 0-.5.2-.6.5V10c-2 .3-3.2 1.6-3.2 3.2 0 2.3 1.4 3.1 4.2 3.5 1.9.3 2.5.7 2.5 1.9 0 1.2-1 2-2.4 2-1.9 0-2.5-.8-2.7-1.9-.1-.3-.3-.4-.5-.4h-1.1c-.3 0-.5.2-.5.5v.1c.3 1.6 1.3 2.7 3.4 3v1.5c0 .3.2.5.5.6h1c.3 0 .5-.2.6-.5v-1.5c2-.3 3.3-1.7 3.3-3.5z"
        fill="#fff"
      />
    </svg>
  );
}

export type AssetSymbol = "USDC";

export function AssetIcon({ size = 28 }: { symbol: AssetSymbol; size?: number }) {
  return <UsdcIcon size={size} />;
}
