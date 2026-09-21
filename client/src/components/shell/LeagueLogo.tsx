import { useState, type ComponentType } from "react";
import { useTheme } from "@/hooks/use-theme.tsx";

interface Props {
  /** The league's logo URLs (when it has one) and the glyph to fall back to. */
  league: {
    label: string;
    logo?: string | undefined;
    logoDark?: string | undefined;
    icon: ComponentType<{ className?: string }>;
  };
  className?: string;
}

/**
 * A league's real logo, with the glyph as the mark when the sport has no
 * logo and as the fallback when the image cannot load (offline, blocked
 * host). A mark that is mostly black carries a `logoDark` variant, because
 * the default surface IS black and the supplied wordmark would otherwise
 * render as an empty gap. Decorative: the label sits beside it wherever it
 * renders, so the image carries no alt text.
 */
export function LeagueLogo({ league, className = "h-[18px] w-[18px]" }: Props) {
  const [failed, setFailed] = useState(false);
  const { theme } = useTheme();
  const Icon = league.icon;
  const src = theme === "dark" ? (league.logoDark ?? league.logo) : league.logo;
  if (failed || !src) return <Icon className={className} />;
  return (
    <img
      src={src}
      key={src}
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
