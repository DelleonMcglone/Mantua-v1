// V1 — Brutalist Terminal
// Black bg, mono type, green phosphor, ASCII ornament. Zero rounded corners.

const V1 = () => {
  const green = '#86ff6b';
  const amber = '#ffb347';
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const time = now.toISOString().replace('T', ' ').slice(0, 19) + 'Z';

  const hooks = [
    { id: '01', name: 'STABLE_PROTECTION', blurb: 'Hard-cap depeg at ±1.5%. No slippage beyond the band.' },
    { id: '02', name: 'DYNAMIC_FEE',       blurb: 'Fees flex with volatility. LPs keep 80% of the premium.' },
    { id: '03', name: 'RWA_GATE',          blurb: 'KYC-gated pools for tokenized treasuries. On-chain allowlist.' },
    { id: '04', name: 'ALO',               blurb: 'Active liquidity operator. Agents rebalance 24/7.' },
  ];

  const faq = [
    ['WHAT IS MANTUA.AI?', 'An agent-driven DEX built on Uniswap v4 hooks. You describe intent in plain English; agents route, hedge, and rebalance.'],
    ['IS IT CUSTODIAL?', 'No. All swaps settle on-chain. Your wallet, your keys. Agents only sign transactions you pre-authorize.'],
    ['WHICH CHAINS?', 'Base mainnet at launch. Arbitrum and Solana on the roadmap for Q2.'],
    ['WHO AUDITS IT?', 'Hooks audited by Spearbit and Trail of Bits. Reports are published before each mainnet deploy.'],
    ['IS THERE A TOKEN?', 'Not today. If one ever launches, this site will say so here. Ignore anyone claiming otherwise.'],
  ];

  return (
    <div style={{ background: '#0a0a0a', color: green, fontFamily: '"JetBrains Mono", ui-monospace, monospace', minHeight: '100%', width: '100%' }}>
      {/* Scanline */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(134,255,107,.03) 0 1px, transparent 1px 3px)',
        mixBlendMode: 'overlay', zIndex: 1 }} />

      {/* Top bar */}
      <div style={{ borderBottom: `1px solid ${green}33`, padding: '14px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, letterSpacing: '.08em' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <span style={{ color: '#fff', fontWeight: 700 }}>MANTUA.AI</span>
          <span style={{ opacity: .5 }}>v0.9.4-beta</span>
          <span style={{ opacity: .5 }}>//</span>
          <span style={{ opacity: .5 }}>{time}</span>
        </div>
        <div style={{ display: 'flex', gap: 32 }}>
          <span style={{ opacity: .7 }}>[ DOCS ]</span>
          <span style={{ opacity: .7 }}>[ GITHUB ]</span>
          <span style={{ opacity: .7 }}>[ DISCORD ]</span>
          <span style={{ color: '#fff', background: green, padding: '2px 10px', fontWeight: 700 }}>LAUNCH_APP →</span>
        </div>
      </div>

      {/* Hero */}
      <div style={{ padding: '80px 40px 60px', position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 12, color: amber, marginBottom: 28, letterSpacing: '.2em' }}>▌ SYSTEM ONLINE · 2,418 AGENTS DEPLOYED</div>
        <h1 style={{ fontSize: 132, lineHeight: .9, fontWeight: 400, margin: 0, letterSpacing: '-.04em', color: '#fff' }}>
          AGENT-DRIVEN<br/>
          LIQUIDITY<br/>
          <span style={{ color: green }}>FOR STABLE<br/>ASSETS.</span>
        </h1>
        <div style={{ maxWidth: 620, marginTop: 44, fontSize: 17, lineHeight: 1.55, color: '#ccc' }}>
          Mantua is a Uniswap v4 DEX where every pool ships with an AI operator. Describe intent in plain English — <span style={{ color: amber }}>"rebalance SOL when it drops 8%"</span> — and agents execute 24/7 with hard on-chain guardrails.
        </div>
        <div style={{ marginTop: 56, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <a style={{ background: green, color: '#000', padding: '20px 36px', fontWeight: 700, fontSize: 14, letterSpacing: '.1em', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            LAUNCH APP <span>→</span>
          </a>
          <a style={{ color: '#fff', padding: '20px 24px', fontWeight: 600, fontSize: 14, letterSpacing: '.1em', border: `1px solid ${green}55` }}>
            READ THE DOCS
          </a>
          <div style={{ fontSize: 12, opacity: .5, marginLeft: 8 }}>{'> no signup. connect wallet → go.'}</div>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ borderTop: `1px solid ${green}33`, borderBottom: `1px solid ${green}33`, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', position: 'relative', zIndex: 2 }}>
        {[
          ['$840M', 'TVL'],
          ['$2.1B', '30D VOLUME'],
          ['12,847', 'ACTIVE AGENTS'],
          ['0.02%', 'AVG SLIPPAGE'],
        ].map(([v, l]) => (
          <div key={l} style={{ padding: '32px 40px', borderRight: `1px solid ${green}33` }}>
            <div style={{ fontSize: 40, color: '#fff', fontWeight: 500, letterSpacing: '-.02em' }}>{v}</div>
            <div style={{ fontSize: 11, opacity: .6, letterSpacing: '.15em', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Product preview */}
      <div style={{ padding: '100px 40px 40px', position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 12, color: amber, letterSpacing: '.2em', marginBottom: 16 }}>── LIVE_SURFACE ──</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 56, alignItems: 'start' }}>
          <div>
            <h2 style={{ fontSize: 48, lineHeight: 1, color: '#fff', margin: 0, fontWeight: 400, letterSpacing: '-.02em' }}>
              Talk to it<br/>like a trader,<br/>not a dApp.
            </h2>
            <p style={{ color: '#ccc', marginTop: 28, fontSize: 15, lineHeight: 1.6 }}>
              Every portfolio action — swaps, rebalances, yield hunts — starts from one prompt. No nested menus, no gas math, no MEV roulette.
            </p>
            <div style={{ marginTop: 32, borderLeft: `2px solid ${green}`, paddingLeft: 20, fontSize: 13, color: '#aaa', lineHeight: 1.8 }}>
              {'> "swap 2 eth to usdc with mev shield"'}<br/>
              {'> "keep my sol exposure at 30%"'}<br/>
              {'> "exit if stETH depegs past 1.5%"'}
            </div>
          </div>
          <div style={{ border: `1px solid ${green}66`, background: '#000' }}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${green}33`, display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '.1em' }}>
              <span>▸ app.mantua.ai/home</span>
              <span style={{ color: amber }}>● CONNECTED · 0x7a3…b9f1</span>
            </div>
            <img src="assets/preview-home.png" alt="Mantua product" style={{ width: '100%', display: 'block', filter: 'contrast(1.05) saturate(.9)' }} />
          </div>
        </div>
      </div>

      {/* Hooks */}
      <div style={{ padding: '100px 40px', borderTop: `1px solid ${green}33`, position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 12, color: amber, letterSpacing: '.2em', marginBottom: 16 }}>── FOUR_HOOKS ──</div>
        <h2 style={{ fontSize: 64, color: '#fff', margin: 0, lineHeight: 1, fontWeight: 400, letterSpacing: '-.03em' }}>
          The primitives.<br/><span style={{ color: green }}>Stack them.</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0, marginTop: 60, border: `1px solid ${green}33` }}>
          {hooks.map((h, i) => (
            <div key={h.id} style={{ padding: '40px 36px', borderRight: i % 2 === 0 ? `1px solid ${green}33` : 'none', borderBottom: i < 2 ? `1px solid ${green}33` : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: green, fontSize: 13 }}>[{h.id}]</span>
                <span style={{ color: amber, fontSize: 10, letterSpacing: '.15em' }}>● AUDITED</span>
              </div>
              <div style={{ fontSize: 26, color: '#fff', marginTop: 8, fontWeight: 500, letterSpacing: '-.01em' }}>{h.name}</div>
              <div style={{ color: '#aaa', marginTop: 14, fontSize: 14, lineHeight: 1.55 }}>{h.blurb}</div>
              <div style={{ marginTop: 24, fontSize: 11, color: green, letterSpacing: '.1em', opacity: .8 }}>VIEW_CONTRACT →</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: '100px 40px', borderTop: `1px solid ${green}33`, position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 56 }}>
          <div>
            <div style={{ fontSize: 12, color: amber, letterSpacing: '.2em', marginBottom: 16 }}>── FAQ ──</div>
            <h2 style={{ fontSize: 56, color: '#fff', margin: 0, lineHeight: .95, fontWeight: 400, letterSpacing: '-.03em' }}>Questions<br/>you should<br/>be asking.</h2>
          </div>
          <div>
            {faq.map(([q, a], i) => (
              <details key={i} style={{ borderBottom: `1px solid ${green}33`, padding: '22px 0' }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', color: '#fff', fontSize: 17, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{q}</span>
                  <span style={{ color: green }}>+</span>
                </summary>
                <div style={{ color: '#aaa', marginTop: 12, fontSize: 14, lineHeight: 1.65, paddingRight: 80 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div style={{ padding: '120px 40px', borderTop: `1px solid ${green}33`, position: 'relative', zIndex: 2, textAlign: 'center' }}>
        <h2 style={{ fontSize: 96, color: '#fff', margin: 0, lineHeight: .9, fontWeight: 400, letterSpacing: '-.04em' }}>
          Stop clicking.<br/><span style={{ color: green }}>Start prompting.</span>
        </h2>
        <a style={{ marginTop: 48, display: 'inline-flex', background: green, color: '#000', padding: '24px 48px', fontWeight: 700, fontSize: 16, letterSpacing: '.1em', gap: 12 }}>
          LAUNCH APP <span>→</span>
        </a>
        <div style={{ marginTop: 80, fontSize: 11, opacity: .4, letterSpacing: '.15em' }}>© 2025 MANTUA LABS · BASE MAINNET · NO TOKEN · NOT FINANCIAL ADVICE</div>
      </div>
    </div>
  );
};

window.V1 = V1;
