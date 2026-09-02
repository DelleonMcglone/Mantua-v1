// Icon components — tiny, consistent stroke style
const Icon = ({ d, size=16, stroke=1.6, fill="none", extra }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
);

const IconSend = (p) => <Icon {...p} d="M3 11.5l17-7.5-7.5 17-2.2-7.3L3 11.5z" />;
const IconPlus = (p) => <Icon {...p} d="M12 5v14M5 12h14" />;
const IconHistory = (p) => <Icon {...p} d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" />;
const IconClose = (p) => <Icon {...p} d="M6 6l12 12M18 6L6 18" />;
const IconBack = (p) => <Icon {...p} d="M15 18l-6-6 6-6" />;
const IconSearch = (p) => <Icon {...p} d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4" />;
const IconChev = (p) => <Icon {...p} d="M6 9l6 6 6-6" />;
const IconArrowUp = (p) => <Icon {...p} d="M12 19V5M5 12l7-7 7 7" />;
const IconArrowDown = (p) => <Icon {...p} d="M12 5v14M5 12l7 7 7-7" />;
const IconArrowRight = (p) => <Icon {...p} d="M5 12h14M13 5l7 7-7 7" />;
const IconSun = (p) => <Icon {...p} d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />;
const IconMoon = (p) => <Icon {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />;
const IconSwap = (p) => <Icon {...p} d="M7 4v16M7 20l-3-3M7 4l-3 3M17 20V4M17 4l3 3M17 20l3-3" />;
const IconDroplet = (p) => <Icon {...p} d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z" />;
const IconChart = (p) => <Icon {...p} d="M4 20V8M10 20V4M16 20v-8M22 20H2" />;
const IconBot = (p) => <Icon {...p} d="M9 11h.01M15 11h.01M8 4h8v3H8zM6 7h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM3 13h-1M21 13h1M9 19v2M15 19v2" />;
const IconSettings = (p) => <Icon {...p} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />;
const IconWallet = (p) => <Icon {...p} d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 9h18M17 14h.01" />;
const IconCheck = (p) => <Icon {...p} d="M20 6L9 17l-5-5" />;
const IconSpark = (p) => <Icon {...p} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM5 18l.8 2.2L8 21l-2.2.8L5 24l-.8-2.2L2 21l2.2-.8L5 18z" />;
const IconZap = (p) => <Icon {...p} d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />;
const IconDots = (p) => <Icon {...p} d="M5 12h.01M12 12h.01M19 12h.01" stroke={2.5} />;
const IconCopy = (p) => <Icon {...p} d="M9 5h10a2 2 0 0 1 2 2v10M5 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" />;
const IconExternal = (p) => <Icon {...p} d="M15 3h6v6M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />;
const IconShield = (p) => <Icon {...p} d="M12 2l9 4v6c0 5-3.5 9-9 10-5.5-1-9-5-9-10V6l9-4z" />;
const IconAlert = (p) => <Icon {...p} d="M12 9v4M12 17h.01M10.3 3.9L2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />;
const IconFilter = (p) => <Icon {...p} d="M3 4h18l-7 9v7l-4-2v-5L3 4z" />;
const IconLayers = (p) => <Icon {...p} d="M12 2l10 6-10 6-10-6 10-6zM2 17l10 6 10-6M2 12l10 6 10-6" />;
const IconPlay = (p) => <Icon {...p} d="M6 4v16l14-8L6 4z" fill="currentColor" />;
const IconPause = (p) => <Icon {...p} d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none" />;
const IconStop = (p) => <Icon {...p} d="M6 6h12v12H6z" fill="currentColor" stroke="none" />;

// Mantua logo — user-provided dark/light variants
const LogoMark = ({ size=28 }) => {
  const getTheme = () => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || 'dark';
  const [theme, setTheme] = React.useState(getTheme);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const src = theme === 'light' ? 'assets/mantua-logo-light.png' : 'assets/mantua-logo-dark.png';
  return <img src={src} width={size} height={size} style={{display:'block', objectFit:'contain'}} alt="Mantua"/>;
};

Object.assign(window, {
  Icon, IconSend, IconPlus, IconHistory, IconClose, IconBack, IconSearch, IconChev,
  IconArrowUp, IconArrowDown, IconArrowRight, IconSun, IconMoon, IconSwap, IconDroplet,
  IconChart, IconBot, IconSettings, IconWallet, IconCheck, IconSpark, IconZap, IconDots,
  IconCopy, IconExternal, IconShield, IconAlert, IconFilter, IconLayers, IconPlay, IconPause, IconStop,
  LogoMark
});
