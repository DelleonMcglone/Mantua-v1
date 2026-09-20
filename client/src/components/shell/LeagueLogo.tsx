import { useState, type ComponentType } from "react";

interface Props {
  /** The league's logo URL (when it has one) and the glyph to fall back to. */
  league: { label: string; logo?: string | undefined; icon: ComponentType<{ className?: string }> };
  className?: string;
}

/**
 * A league's real logo, with the glyph as the mark when the sport has no
 * logo and as the fallback when the image cannot load (offline, blocked
 * host). Decorative: the label sits beside it wherever it renders, so the
 * image carries no alt text.
 */
export function LeagueLogo({ league, className = "h-[18px] w-[18px]" }: Props) {
  const [failed, setFailed] = useState(false);
  const Icon = league.icon;
  if (failed || !league.logo) return <Icon className={className} />;
  return (
    <img
      src={league.logo}
      alt=""
      className={`${className} shrink-0 object-contain`}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
