/**
 * The landing page's wordmark as live vector art, not a picture: the
 * leaf-M mark (the same paths as `mantua-logo-dark.svg`) followed by an
 * outlined "ANTUA", both stroked with the brand gradient, so it sits
 * straight on the night-sky art with nothing behind it.
 */
export function HeroWordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 150"
      role="img"
      aria-label="Mantua"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="wm-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9d6bff" />
          <stop offset="0.55" stopColor="#38a8e8" />
          <stop offset="1" stopColor="#1ce8a8" />
        </linearGradient>
        <mask id="wm-leaf-cut">
          <rect width="800" height="150" fill="white" />
          <path
            transform="translate(-25 -16) scale(1.52)"
            d="M42 42 C26 37 17 56 33 79 C45 71 47 53 42 42 Z"
            fill="black"
          />
        </mask>
      </defs>
      <g fill="none" stroke="url(#wm-g)" strokeWidth="5">
        <g transform="translate(-25 -16) scale(1.52)" strokeWidth="3.6">
          <path
            d="M28 88 V32 H42 L60 64 L78 32 H92 V88 H81 V46 L60 82 L39 46 V88 Z"
            mask="url(#wm-leaf-cut)"
          />
          <path d="M42 42 C26 37 17 56 33 79 C45 71 47 53 42 42 Z" strokeLinejoin="round" />
          <path d="M34 74 C33 63 34 52 39 45" strokeLinecap="round" />
        </g>
        <text
          x="140"
          y="118"
          textLength="640"
          lengthAdjust="spacing"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="124"
          fontWeight="700"
          strokeLinejoin="round"
        >
          ANTUA
        </text>
      </g>
    </svg>
  );
}
