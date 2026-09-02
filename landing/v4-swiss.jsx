// V4 — Swiss Grid / Art Direction
// Bone bg, oversized grid numerals, rotated type, one strong accent color.
// Feels like a design manifesto poster more than a Web3 landing.

const V4 = () => {
  const ink = '#0e0e0e';
  const paper = '#e8e4da';
  const pop = '#ff4d1f';
  const hooks = [
    { n: '01', name: 'STABLE PROTECTION', blurb: 'Hard ±1.5% depeg band. Halts trading before losses compound.' },
    { n: '02', name: 'DYNAMIC FEE',       blurb: 'Fees flex with realized volatility. LPs capture the premium.' },
    { n: '03', name: 'RWA GATE',          blurb: 'KYC-gated pools for tokenized treasuries. On-chain allowlist.' },
    { n: '04', name: 'ALO',               blurb: 'Active liquidity operator. Agents rebalance 24/7 inside your rules.' },
  ];
  const faq = [
    ['What is Mantua.AI?', 'A DEX where every pool ships with an on-chain AI agent. Describe intent in plain English; agents execute inside your guardrails.'],
    ['Is it custodial?', 'No. Swaps settle on-chain. Agent permissions can be revoked at any time from the Agents tab.'],
    ['Which chains?', 'Base mainnet at launch. Arbitrum and Solana next.'],
    ['Who audits the hooks?', 'Spearbit and Trail of Bits. Reports are linked in the docs.'],
    ['Is there a token?', 'No. This site is the source of truth.'],
  ];
  return (
    <div style={{ background: paper, color: ink, fontFamily: '"Inter", "Helvetica Neue", sans-serif', minHeight: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .sw-mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
        .sw-display { font-family: "Inter", "Helvetica Neue", sans-serif; font-weight: 900; font-stretch: 125%; }
      `}</style>

      {/* Fine grid overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(to right, rgba(14,14,14,.04) 1px, transparent 1px)',
        backgroundSize: '8.333% 100%' }} />

      {/* Nav */}
      <div style={{ padding: '20px 40px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', borderBottom: `1.5px solid ${ink}`, position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="assets/mantua-logo-light.png" width="22" height="22" />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -.2 }}>Mantua.AI</span>
          <span className="sw-mono" style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>EST 2025</span>
        </div>
        <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: '#333' }}>N° 01 · AGENT-DRIVEN LIQUIDITY</div>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'flex-end', fontSize: 13, color: '#333' }}>
          <span>Hooks</span><span>Docs</span><span>Blog</span>
          <a style={{ background: ink, color: paper, padding: '8px 16px', fontSize: 13, fontWeight: 600, display: 'inline-flex', gap: 6 }}>LAUNCH →</a>
        </div>
      </div>

      {/* HERO — monumental wordmark grid */}
      <div style={{ position: 'relative', zIndex: 2, padding: '0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1.5px solid ${ink}` }}>
          {/* col 1: label */}
          <div style={{ padding: '40px 32px', borderRight: `1.5px solid ${ink}` }}>
            <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em' }}>▲ 01 / INTRODUCING</div>
            <div style={{ marginTop: 140, fontSize: 16, lineHeight: 1.5, maxWidth: 320 }}>
              <span style={{ background: pop, color: paper, padding: '0 6px' }}>Mantua</span> is an agent-driven DEX for stable assets. Written intent in, on-chain execution out.
            </div>
            <div style={{ marginTop: 32, display: 'flex', gap: 10, alignItems: 'center' }}>
              <a style={{ background: ink, color: paper, padding: '16px 28px', fontSize: 14, fontWeight: 700, display: 'inline-flex', gap: 8 }}>LAUNCH APP →</a>
              <a style={{ padding: '16px 20px', fontSize: 14, fontWeight: 500, border: `1.5px solid ${ink}` }}>DOCS</a>
            </div>
          </div>
          {/* col 2,3: giant word */}
          <div style={{ gridColumn: '2 / 4', padding: '32px 40px 24px', position: 'relative', minHeight: 420 }}>
            <div className="sw-display" style={{ fontSize: 240, lineHeight: .82, letterSpacing: '-.06em', textTransform: 'uppercase' }}>
              LIQUID<br/>INTENT
            </div>
            <div className="sw-mono" style={{ position: 'absolute', top: 32, right: 40, fontSize: 11, letterSpacing: '.2em', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              FIG.1 — THE PROPOSITION
            </div>
          </div>
        </div>

        {/* Manifesto strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderBottom: `1.5px solid ${ink}` }}>
          {['TALK', 'ROUTE', 'SIGN', 'EXECUTE', 'REBALANCE', 'REPEAT'].map((w, i) => (
            <div key={w} style={{ padding: '22px 20px', borderRight: i < 5 ? `1.5px solid ${ink}` : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="sw-mono" style={{ fontSize: 11, color: pop }}>0{i+1}</span>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' }}>{w}</span>
            </div>
          ))}
        </div>

        {/* Live stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: `1.5px solid ${ink}` }}>
          {[['$840M', 'TVL'], ['$2.1B', '30D VOL'], ['12,847', 'AGENTS'], ['0.02%', 'SLIPPAGE']].map(([v, l], i) => (
            <div key={l} style={{ padding: '28px 32px', borderRight: i < 3 ? `1.5px solid ${ink}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div className="sw-mono" style={{ fontSize: 10, letterSpacing: '.2em', color: '#555' }}>{l}</div>
                <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-.02em', marginTop: 4 }}>{v}</div>
              </div>
              <div style={{ width: 36, height: 36, border: `1.5px solid ${ink}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>↗</div>
            </div>
          ))}
        </div>
      </div>

      {/* Product exhibit */}
      <div style={{ padding: '80px 40px', position: 'relative', zIndex: 2, borderBottom: `1.5px solid ${ink}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 48 }}>
          <div>
            <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em' }}>▲ 02 / THE SURFACE</div>
            <h2 className="sw-display" style={{ fontSize: 80, lineHeight: .88, margin: '28px 0 0', letterSpacing: '-.04em', textTransform: 'uppercase' }}>One<br/>composer.<br/><span style={{ color: pop }}>Every<br/>move.</span></h2>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: '#333', marginTop: 28, maxWidth: 380 }}>
              Swap, rebalance, analyze, or deploy a custom agent — all from a single prompt. The entire product is one conversation you can leave and return to.
            </p>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: -20, left: -20, right: 20, bottom: 20, background: pop, zIndex: 0 }} />
            <div style={{ position: 'relative', border: `1.5px solid ${ink}`, background: '#fff', overflow: 'hidden' }}>
              <div className="sw-mono" style={{ padding: '8px 14px', fontSize: 11, letterSpacing: '.15em', borderBottom: `1.5px solid ${ink}`, display: 'flex', justifyContent: 'space-between' }}>
                <span>APP.MANTUA.AI</span>
                <span>FIG. 02</span>
              </div>
              <img src="assets/preview-home.png" style={{ width: '100%', display: 'block' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Hooks — numbered grid */}
      <div style={{ padding: '0', borderBottom: `1.5px solid ${ink}`, position: 'relative', zIndex: 2 }}>
        <div style={{ padding: '60px 40px 20px', borderBottom: `1.5px solid ${ink}` }}>
          <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', marginBottom: 20 }}>▲ 03 / FOUR HOOKS</div>
          <div className="sw-display" style={{ fontSize: 140, lineHeight: .85, letterSpacing: '-.05em', textTransform: 'uppercase' }}>The<br/>primitives.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {hooks.map((h, i) => (
            <div key={h.n} style={{ padding: '32px 28px', borderRight: i < 3 ? `1.5px solid ${ink}` : 'none', minHeight: 320, display: 'flex', flexDirection: 'column' }}>
              <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', color: pop }}>HOOK / {h.n}</div>
              <div className="sw-display" style={{ fontSize: 96, lineHeight: .9, letterSpacing: '-.04em', marginTop: 12 }}>{h.n}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 20, letterSpacing: '-.01em' }}>{h.name}</div>
              <div style={{ fontSize: 14, color: '#333', lineHeight: 1.55, marginTop: 10, flex: 1 }}>{h.blurb}</div>
              <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.15em', marginTop: 20 }}>READ SPEC →</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: '60px 40px', borderBottom: `1.5px solid ${ink}`, position: 'relative', zIndex: 2 }}>
        <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', marginBottom: 20 }}>▲ 04 / QUESTIONS</div>
        <div className="sw-display" style={{ fontSize: 100, lineHeight: .88, letterSpacing: '-.05em', textTransform: 'uppercase', marginBottom: 40 }}>Q&A</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0, borderTop: `1.5px solid ${ink}` }}>
          {faq.map(([q, a], i) => (
            <div key={i} style={{ padding: '28px 28px', borderRight: i % 2 === 0 ? `1.5px solid ${ink}` : 'none', borderBottom: i < faq.length - 2 ? `1.5px solid ${ink}` : 'none' }}>
              <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', color: pop, marginBottom: 10 }}>Q.0{i+1}</div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.01em' }}>{q}</div>
              <div style={{ fontSize: 14, color: '#333', lineHeight: 1.6, marginTop: 12 }}>{a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Closing CTA */}
      <div style={{ padding: '100px 40px', background: ink, color: paper, position: 'relative', zIndex: 2 }}>
        <div className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', marginBottom: 20, color: pop }}>▲ 05 / NOW</div>
        <div className="sw-display" style={{ fontSize: 180, lineHeight: .85, letterSpacing: '-.05em', textTransform: 'uppercase' }}>Launch.<br/><span style={{ color: pop }}>Now.</span></div>
        <div style={{ marginTop: 56, display: 'flex', gap: 16, alignItems: 'center' }}>
          <a style={{ background: pop, color: ink, padding: '22px 44px', fontSize: 16, fontWeight: 800, display: 'inline-flex', gap: 12, letterSpacing: '.02em' }}>LAUNCH APP →</a>
          <span className="sw-mono" style={{ fontSize: 11, letterSpacing: '.2em', opacity: .6 }}>NO SIGNUP · BASE MAINNET · 12,847 AGENTS</span>
        </div>
        <div className="sw-mono" style={{ marginTop: 120, fontSize: 10, letterSpacing: '.2em', opacity: .4, display: 'flex', justifyContent: 'space-between' }}>
          <span>© 2025 MANTUA LABS</span>
          <span>NOT FINANCIAL ADVICE</span>
          <span>PRINTED IN BASE</span>
        </div>
      </div>
    </div>
  );
};
window.V4 = V4;
