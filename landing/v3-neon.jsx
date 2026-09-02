// V3 — Dark Neon Mesh
// Deep navy/black bg, mesh gradient, electric accents, floating product preview

const V3 = () => {
  const hooks = [
    { k: 'SP', name: 'Stable Protection', blurb: 'Hard depeg band at ±1.5%. Your LP is un-rug-pullable.', color: '#6ee7ff' },
    { k: 'DF', name: 'Dynamic Fee',       blurb: 'Fees scale with volatility. Toxic flow pays, calm flow wins.', color: '#b4ff4d' },
    { k: 'RG', name: 'RWA Gate',          blurb: 'KYC-gated pools for tokenized treasuries and bonds.', color: '#ff7ad9' },
    { k: 'AL', name: 'ALO',               blurb: '24/7 rebalancing. Your agent never sleeps, never tilts.', color: '#ffb347' },
  ];
  const faq = [
    ['What is Mantua.AI?', 'An agent-driven DEX on Uniswap v4. You describe intent; agents execute within your on-chain guardrails.'],
    ['Is it custodial?', 'No. Everything settles on-chain and you can revoke agent permissions at any time.'],
    ['Which chains?', 'Base mainnet at launch. Arbitrum and Solana are on the roadmap.'],
    ['Who audits the hooks?', 'Spearbit and Trail of Bits. Reports published before each mainnet deploy.'],
    ['Is there a token?', 'No. This page is the source of truth.'],
  ];
  return (
    <div style={{ background: '#05060a', color: '#fff', fontFamily: '"Inter", sans-serif', minHeight: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Mesh gradient bg */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 900px 600px at 15% 10%, rgba(110,231,255,.25), transparent 60%), radial-gradient(ellipse 800px 500px at 85% 30%, rgba(255,122,217,.18), transparent 60%), radial-gradient(ellipse 900px 500px at 50% 90%, rgba(180,255,77,.1), transparent 70%)', pointerEvents: 'none' }} />
      {/* Grain */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence baseFrequency='.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.35'/></svg>")`, opacity: .08, mixBlendMode: 'overlay', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* Nav */}
        <div style={{ padding: '28px 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="assets/mantua-logo-dark.png" width="26" height="26" />
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -.3 }}>Mantua.AI</span>
          </div>
          <div style={{ display: 'flex', gap: 36, fontSize: 14, color: '#9aa0b4' }}>
            <span>Hooks</span><span>Agents</span><span>Docs</span><span>Blog</span>
          </div>
          <a style={{ background: '#fff', color: '#05060a', padding: '12px 22px', borderRadius: 999, fontSize: 14, fontWeight: 600, display: 'inline-flex', gap: 8, alignItems: 'center' }}>Launch app <span>→</span></a>
        </div>

        {/* Hero */}
        <div style={{ padding: '96px 56px 40px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.03)', backdropFilter: 'blur(12px)', fontSize: 13, color: '#9aa0b4' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#b4ff4d', boxShadow: '0 0 12px #b4ff4d' }} />
            Live on Base · 12,847 agents running
          </div>
          <h1 style={{ fontSize: 128, lineHeight: .9, margin: '32px 0 0', letterSpacing: '-.045em', fontWeight: 600 }}>
            Liquidity that<br/>
            <span style={{ background: 'linear-gradient(90deg, #6ee7ff, #b4ff4d 40%, #ff7ad9)', WebkitBackgroundClip: 'text', color: 'transparent' }}>thinks for itself.</span>
          </h1>
          <p style={{ fontSize: 20, color: '#c4c9dc', maxWidth: 680, margin: '36px auto 0', lineHeight: 1.5 }}>
            Mantua is an agent-driven DEX for stable assets. Describe intent in plain English. Agents execute 24/7 with on-chain guardrails.
          </p>
          <div style={{ marginTop: 44, display: 'flex', gap: 14, justifyContent: 'center' }}>
            <a style={{ background: 'linear-gradient(90deg, #6ee7ff, #ff7ad9)', color: '#05060a', padding: '18px 34px', borderRadius: 999, fontSize: 15, fontWeight: 700, display: 'inline-flex', gap: 10, alignItems: 'center', boxShadow: '0 10px 40px rgba(110,231,255,.35)' }}>Launch app <span>→</span></a>
            <a style={{ padding: '18px 28px', borderRadius: 999, fontSize: 15, fontWeight: 500, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.03)', backdropFilter: 'blur(8px)' }}>Read docs</a>
          </div>
        </div>

        {/* Product preview floating */}
        <div style={{ padding: '40px 56px 120px', position: 'relative' }}>
          <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ position: 'absolute', inset: -20, background: 'linear-gradient(135deg, #6ee7ff, #ff7ad9, #b4ff4d)', borderRadius: 24, filter: 'blur(60px)', opacity: .3 }} />
            <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 40px 100px rgba(0,0,0,.6)', background: '#0a0b12' }}>
              <div style={{ padding: '10px 16px', background: 'rgba(255,255,255,.03)', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#9aa0b4' }}>
                <span style={{ width: 11, height: 11, borderRadius: 6, background: '#ff5f57' }} />
                <span style={{ width: 11, height: 11, borderRadius: 6, background: '#ffbd2e' }} />
                <span style={{ width: 11, height: 11, borderRadius: 6, background: '#28c840' }} />
                <span style={{ marginLeft: 16 }}>app.mantua.ai</span>
              </div>
              <img src="assets/preview-home.png" style={{ width: '100%', display: 'block' }} />
            </div>
            {/* Floating chat chip */}
            <div style={{ position: 'absolute', right: -20, top: 120, background: 'rgba(10,11,18,.9)', backdropFilter: 'blur(20px)', border: '1px solid rgba(110,231,255,.3)', borderRadius: 12, padding: 16, width: 260, boxShadow: '0 20px 60px rgba(110,231,255,.2)' }}>
              <div style={{ fontSize: 11, color: '#6ee7ff', letterSpacing: '.1em', marginBottom: 8 }}>● AGENT · EXECUTING</div>
              <div style={{ fontSize: 14, lineHeight: 1.4 }}>Rebalancing SOL to 30%. Routing through Aerodrome with MEV shield. Est. save: $24.</div>
            </div>
          </div>
        </div>

        {/* Hooks */}
        <div style={{ padding: '80px 56px' }}>
          <div style={{ textAlign: 'center', marginBottom: 72 }}>
            <div style={{ fontSize: 13, color: '#6ee7ff', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 16 }}>Four hooks</div>
            <h2 style={{ fontSize: 80, lineHeight: .95, margin: 0, letterSpacing: '-.035em', fontWeight: 600 }}>Primitives. <span style={{ color: '#9aa0b4' }}>Stack them.</span></h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {hooks.map(h => (
              <div key={h.k} style={{ padding: 32, borderRadius: 18, border: `1px solid ${h.color}33`, background: 'rgba(255,255,255,.02)', backdropFilter: 'blur(20px)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80, background: h.color, filter: 'blur(60px)', opacity: .25 }} />
                <div style={{ width: 56, height: 56, borderRadius: 14, background: h.color, color: '#05060a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', position: 'relative' }}>{h.k}</div>
                <div style={{ fontSize: 22, fontWeight: 600, marginTop: 24, letterSpacing: '-.01em', position: 'relative' }}>{h.name}</div>
                <div style={{ fontSize: 14, color: '#9aa0b4', marginTop: 12, lineHeight: 1.55, position: 'relative' }}>{h.blurb}</div>
                <div style={{ fontSize: 12, color: h.color, marginTop: 24, letterSpacing: '.1em', position: 'relative' }}>LEARN MORE →</div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div style={{ padding: '120px 56px', maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ fontSize: 72, margin: 0, letterSpacing: '-.035em', fontWeight: 600, textAlign: 'center' }}>Frequently asked.</h2>
          <div style={{ marginTop: 56 }}>
            {faq.map(([q, a], i) => (
              <details key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.1)', padding: '22px 0' }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 19, display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
                  <span>{q}</span>
                  <span style={{ color: '#6ee7ff' }}>+</span>
                </summary>
                <div style={{ fontSize: 15, color: '#9aa0b4', lineHeight: 1.65, marginTop: 12 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: '140px 56px 80px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 120, lineHeight: .88, margin: 0, letterSpacing: '-.045em', fontWeight: 600 }}>
            Ship <span style={{ background: 'linear-gradient(90deg, #6ee7ff, #ff7ad9)', WebkitBackgroundClip: 'text', color: 'transparent' }}>intent</span>,<br/>not transactions.
          </h2>
          <a style={{ marginTop: 56, display: 'inline-flex', background: '#fff', color: '#05060a', padding: '22px 44px', borderRadius: 999, fontSize: 16, fontWeight: 700, gap: 12 }}>Launch app →</a>
          <div style={{ marginTop: 100, fontSize: 12, color: '#555', letterSpacing: '.1em' }}>© 2025 MANTUA LABS · BASE MAINNET</div>
        </div>
      </div>
    </div>
  );
};
window.V3 = V3;
