// V2 — Monumental Editorial
// Bone background, deep ink, amber accent. Giant serif display mixed with sans.
// Newspaper-style feel but pushed BIG.

const V2 = () => {
  const ink = '#14110d';
  const bone = '#f4ede0';
  const amber = '#c96442';
  const hooks = [
    { n: '01', name: 'Stable Protection', blurb: 'A hard ±1.5% depeg band. If the pair cracks, the hook halts trades before your capital does.' },
    { n: '02', name: 'Dynamic Fee',       blurb: 'Fees rise with volatility and fall with calm. LPs stop subsidizing toxic flow.' },
    { n: '03', name: 'RWA Gate',          blurb: 'KYC-gated pools for tokenized treasuries. Permissioned liquidity, permissionless infra.' },
    { n: '04', name: 'ALO',               blurb: 'Active Liquidity Operator. Your agent concentrates, rebalances, and retreats — on your rules.' },
  ];
  const faq = [
    ['What is Mantua.AI?', 'A DEX on Uniswap v4 where every pool ships with an on-chain AI operator. You describe intent in plain English; agents execute within your guardrails.'],
    ['Is it custodial?', 'No. Settlement is on-chain. Agents only sign transactions you pre-authorize, and any rule can be revoked in one click.'],
    ['Which chains?', 'Base mainnet at launch. Arbitrum and Solana are next.'],
    ['Who audits the hooks?', 'Spearbit and Trail of Bits. Reports are posted before each mainnet deploy.'],
    ['Is there a token?', 'No. If one ever launches it will be announced here. Ignore anyone who says otherwise.'],
  ];
  return (
    <div style={{ background: bone, color: ink, fontFamily: '"Inter", -apple-system, sans-serif', minHeight: '100%', width: '100%' }}>
      <style>{`
        .ed-serif { font-family: "Fraunces", "Times New Roman", serif; font-weight: 400; font-style: normal; }
        .ed-italic { font-family: "Fraunces", serif; font-style: italic; font-weight: 300; }
      `}</style>

      {/* Nav */}
      <div style={{ padding: '24px 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${ink}22` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="assets/mantua-logo-light.png" width="24" height="24" />
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -.3 }}>Mantua.AI</span>
        </div>
        <div style={{ display: 'flex', gap: 36, fontSize: 14, color: '#555' }}>
          <span>Hooks</span><span>Agents</span><span>Docs</span><span>Blog</span>
        </div>
        <a style={{ background: ink, color: bone, padding: '12px 22px', borderRadius: 999, fontSize: 14, fontWeight: 500, display: 'inline-flex', gap: 8, alignItems: 'center' }}>Launch app <span>→</span></a>
      </div>

      {/* Hero */}
      <div style={{ padding: '72px 56px 48px', position: 'relative' }}>
        <div style={{ fontSize: 13, color: amber, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 40, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 40, height: 1, background: amber }} /> Issue № 01 · Winter 2025
        </div>
        <h1 className="ed-serif" style={{ fontSize: 180, lineHeight: .88, margin: 0, letterSpacing: '-.04em' }}>
          Liquidity,<br/>
          <span className="ed-italic" style={{ color: amber }}>now with</span><br/>
          a brain.
        </h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56, marginTop: 64, alignItems: 'end' }}>
          <div style={{ fontSize: 21, lineHeight: 1.45, color: '#2a2520', maxWidth: 540, fontWeight: 400 }}>
            Mantua is an agent-driven DEX for <span className="ed-italic" style={{ color: amber }}>stable assets</span>. You set intent — cap slippage, hold a peg, harvest yield — and on-chain agents enforce it around the clock.
          </div>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end', alignItems: 'center' }}>
            <a style={{ background: ink, color: bone, padding: '20px 32px', borderRadius: 999, fontSize: 15, fontWeight: 500, display: 'inline-flex', gap: 10, alignItems: 'center' }}>Launch app <span>→</span></a>
            <a style={{ padding: '20px 24px', borderRadius: 999, fontSize: 15, fontWeight: 500, border: `1px solid ${ink}33` }}>Read docs</a>
          </div>
        </div>
      </div>

      {/* Pull quote + stats */}
      <div style={{ padding: '72px 56px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 56, borderTop: `1px solid ${ink}22` }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '.15em', textTransform: 'uppercase', color: '#777', marginBottom: 20 }}>A Note From the Operator</div>
          <div className="ed-serif" style={{ fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em' }}>
            “Most DEXs assume the user knows when to rebalance, when to hedge, when to exit. <span style={{ color: amber }} className="ed-italic">We stopped assuming.</span>”
          </div>
          <div style={{ marginTop: 28, fontSize: 14, color: '#555' }}>— M. Caro, founder · Mantua Labs</div>
        </div>
        <div style={{ display: 'grid', gap: 28 }}>
          {[['$840M', 'Total value deployed'], ['12,847', 'Agents running now'], ['0.02%', 'Median slippage']].map(([v, l]) => (
            <div key={l}>
              <div className="ed-serif" style={{ fontSize: 56, lineHeight: 1, letterSpacing: '-.02em' }}>{v}</div>
              <div style={{ fontSize: 13, color: '#777', marginTop: 6 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Product preview */}
      <div style={{ padding: '80px 56px', borderTop: `1px solid ${ink}22`, background: '#ebe2d2' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 56, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: amber, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20 }}>The product</div>
            <h2 className="ed-serif" style={{ fontSize: 72, lineHeight: .95, margin: 0, letterSpacing: '-.03em' }}>One prompt.<br/><span className="ed-italic" style={{ color: amber }}>Every move.</span></h2>
            <p style={{ fontSize: 17, lineHeight: 1.55, color: '#3a332c', marginTop: 28, maxWidth: 440 }}>
              Swap, rebalance, hedge, research. There are no tabs to learn — just a composer and an agent that understands you.
            </p>
            <div style={{ marginTop: 28, display: 'grid', gap: 10, fontSize: 14, color: '#555' }}>
              <div>— “Swap 2 ETH to USDC with MEV shield”</div>
              <div>— “Keep SOL at 30% of portfolio”</div>
              <div>— “Exit stETH if peg breaks 1.5%”</div>
            </div>
          </div>
          <div style={{ boxShadow: '0 30px 80px rgba(20,17,13,.15), 0 2px 8px rgba(20,17,13,.08)', border: `1px solid ${ink}15`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
            <img src="assets/preview-home.png" style={{ width: '100%', display: 'block' }} />
          </div>
        </div>
      </div>

      {/* Hooks — giant numerals */}
      <div style={{ padding: '96px 56px', borderTop: `1px solid ${ink}22` }}>
        <div style={{ fontSize: 13, color: amber, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20 }}>Four hooks</div>
        <h2 className="ed-serif" style={{ fontSize: 88, lineHeight: .95, margin: 0, letterSpacing: '-.03em', marginBottom: 72 }}>The primitives,<br/><span className="ed-italic">yours to stack.</span></h2>
        <div style={{ display: 'grid', gap: 0 }}>
          {hooks.map((h, i) => (
            <div key={h.n} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1.4fr 120px', gap: 40, padding: '40px 0', borderTop: `1px solid ${ink}22`, alignItems: 'baseline' }}>
              <div className="ed-serif" style={{ fontSize: 96, lineHeight: .9, letterSpacing: '-.03em', color: amber }}>{h.n}</div>
              <div className="ed-serif" style={{ fontSize: 36, lineHeight: 1, letterSpacing: '-.02em' }}>{h.name}</div>
              <div style={{ fontSize: 17, lineHeight: 1.5, color: '#3a332c' }}>{h.blurb}</div>
              <div style={{ fontSize: 13, color: amber, textAlign: 'right' }}>Read →</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: '96px 56px', borderTop: `1px solid ${ink}22`, background: '#ebe2d2' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 56 }}>
          <div>
            <div style={{ fontSize: 13, color: amber, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20 }}>FAQ</div>
            <h2 className="ed-serif" style={{ fontSize: 72, lineHeight: .95, margin: 0, letterSpacing: '-.03em' }}>Questions,<br/><span className="ed-italic">answered.</span></h2>
          </div>
          <div>
            {faq.map(([q, a], i) => (
              <details key={i} style={{ borderBottom: `1px solid ${ink}22`, padding: '24px 0' }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 22, display: 'flex', justifyContent: 'space-between', letterSpacing: '-.01em' }} className="ed-serif">
                  <span>{q}</span>
                  <span style={{ color: amber, fontSize: 20 }}>+</span>
                </summary>
                <div style={{ fontSize: 16, color: '#3a332c', lineHeight: 1.6, marginTop: 14, maxWidth: 680 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '140px 56px', textAlign: 'center', background: ink, color: bone }}>
        <h2 className="ed-serif" style={{ fontSize: 140, lineHeight: .88, margin: 0, letterSpacing: '-.04em' }}>
          Give your<br/>liquidity <span className="ed-italic" style={{ color: amber }}>a mind.</span>
        </h2>
        <a style={{ marginTop: 56, display: 'inline-flex', background: amber, color: ink, padding: '22px 44px', borderRadius: 999, fontSize: 16, fontWeight: 600, gap: 12 }}>Launch app →</a>
        <div style={{ marginTop: 100, fontSize: 12, opacity: .5, letterSpacing: '.1em' }}>© 2025 MANTUA LABS · BUILT ON BASE · NOT FINANCIAL ADVICE</div>
      </div>
    </div>
  );
};
window.V2 = V2;
