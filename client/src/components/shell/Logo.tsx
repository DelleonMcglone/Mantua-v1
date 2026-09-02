import { useTheme } from "@/hooks/use-theme.tsx";

/**
 * Mantua "M" mark — transparent-background gradient SVGs, one tuned per
 * theme: `mantua-logo-dark.svg` (brighter stops) on dark backgrounds,
 * `mantua-logo-light.svg` (deeper stops) on light ones.
 */
export function Logo({ size = 30 }: { size?: number }) {
  const { theme } = useTheme();
  const src = theme === "dark" ? "/assets/mantua-logo-dark.svg" : "/assets/mantua-logo-light.svg";
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="Mantua"
      className="block shrink-0"
      style={{ objectFit: "contain" }}
    />
  );
}
