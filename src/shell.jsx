// Shell: header, portfolio card, assets list
const { useState, useEffect, useRef, useMemo } = React;

// ── Header ──────────────────────────────────────────────────────
const Header = ({ theme, onToggleTheme, walletState, onConnectWallet }) => (
  <header style={shellStyles.header}>
    <div style={{display:'flex', alignItems:'center', gap: 12}}>
      <LogoMark size={30} />
      <div style={{fontWeight: 600, fontSize: 17, letterSpacing: '-.01em'}}>Mantua.AI</div>
    </div>
    <div style={{display:'flex', alignItems:'center', gap: 10}}>
      <button style={shellStyles.iconBtn} onClick={onToggleTheme} aria-label="toggle theme">
        {theme === 'dark' ? <IconSun size={18}/> : <IconMoon size={18}/>}
      </button>
      {walletState.connected ? (
        <button style={{...shellStyles.walletBtn, background: 'transparent', border:'1px solid var(--border)'}}>
          <span style={{width:8, height:8, borderRadius:99, background:'var(--green)'}}/>
          <span className="mono" style={{fontSize:13}}>{walletState.address}</span>
        </button>
      ) : (
        <button style={{...shellStyles.walletBtn, backgroundColor: 'rgb(161, 102, 244)'}} onClick={onConnectWallet}>Connect Wallet</button>
      )}
    </div>
  </header>
);

// ── Portfolio card ──────────────────────────────────────────────
const PortfolioCard = ({ openDetail }) => {
  const [range, setRange] = useState('TW');
  const ranges = ['1H','1D','TW','1M','1Y'];

  // Shape matches screenshot: sharp early dip, climb, mid pullback, final peak
  const points = useMemo(() => {
    const base = range === '1H' ? 80 : range === '1D' ? 100 : range === 'TW' ? 150 : range === '1M' ? 200 : 260;
    const out = [];
    for (let i=0; i<base; i++) {
      const t = i / (base-1);
      let v = 58 + t * 36;
      v -= 48 * Math.exp(-Math.pow((t-0.09)/0.045, 2));
      v -= 6 * Math.exp(-Math.pow((t-0.42)/0.05, 2));
      v -= 8 * Math.exp(-Math.pow((t-0.62)/0.06, 2));
      v += 6 * Math.exp(-Math.pow((t-0.78)/0.04, 2));
      v += Math.sin(t*22) * 2.2 + Math.cos(t*41) * 1.3 + Math.sin(t*70) * 0.8;
      out.push(v);
    }
    return out;
  }, [range]);

  const w = 560, h = 170, pad = 8;
  const min = Math.min(...points), max = Math.max(...points);
  const sx = (i) => pad + (i/(points.length-1)) * (w - pad*2);
  const sy = (v) => pad + (1 - (v-min)/(max-min+.001)) * (h - pad*2);
  const path = points.map((v,i) => `${i===0?'M':'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const area = path + ` L${sx(points.length-1)},${h-pad} L${sx(0)},${h-pad} Z`;

  return (
    <div style={shellStyles.card} onClick={openDetail} className="portfolioCard">
      <div style={{textAlign:'center', paddingTop: 18}}>
        <div style={{fontSize: 13, color:'var(--text-dim)'}}>Portfolio</div>
        <div style={{fontSize: 34, fontWeight: 600, marginTop: 2, letterSpacing:'-.02em'}}>$72,697.83</div>
        <div style={{fontSize: 13, color:'var(--green)', marginTop: 2}}>
          <span style={{marginRight:4}}>↗</span>3.51% past week
        </div>
      </div>
      <div style={{position:'relative', marginTop: 8}}>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{display:'block'}}>
          <defs>
            <linearGradient id="amberFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--amber)" stopOpacity="0.25"/>
              <stop offset="1" stopColor="var(--amber)" stopOpacity="0"/>
            </linearGradient>
            <pattern id="dotPat" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".8" fill="var(--amber)" opacity=".18"/>
            </pattern>
          </defs>
          <rect x="0" y={h*0.45} width={w} height={h*0.55} fill="url(#dotPat)"/>
          <path d={area} fill="url(#amberFill)"/>
          <path d={path} fill="none" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>

        <div style={{display:'flex', justifyContent:'center', gap: 2, marginTop: 4, alignItems:'center'}}>
          <div style={shellStyles.rangeGroup}>
            {ranges.map(r => (
              <button key={r} onClick={(e) => {e.stopPropagation(); setRange(r);}}
                style={{...shellStyles.rangeBtn, ...(range===r ? shellStyles.rangeBtnActive : {})}}>
                {r}
              </button>
            ))}
          </div>
          <div style={{marginLeft: 12, display:'flex', alignItems:'center', gap:6, color:'var(--text-dim)', fontSize: 12}}>
            <span style={{width:6, height:6, borderRadius:99, background:'var(--green)', boxShadow:'0 0 8px var(--green)'}}/>
            Live
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Assets list ─────────────────────────────────────────────────
const ASSETS = [
  { sym:'ETH', name:'Ethereum', price:'$3,630.12', pct: -0.75, qty:'7.01', val:'$25,385.54', color:'#627eea' },
  { sym:'SOL', name:'Solana',   price:'$241.320', pct:  6.01, qty:'76.16', val:'$18,372.30', color:'#9945ff' },
  { sym:'BTC', name:'Bitcoin',  price:'$67,224.32', pct: 0.31, qty:'0.22', val:'$14,234.40', color:'#f7931a' },
  { sym:'USDC',name:'USDC',     price:'$1.00', pct: 0.00, qty:'7,292.36', val:'$7,292.38', color:'#2775ca' },
];

const TOKEN_SVGS = {
  ETH: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#627eea"/>
      <g fill="#fff" fillRule="evenodd">
        <path fillOpacity=".6" d="M16.5 4v8.87l7.5 3.35z"/>
        <path d="M16.5 4L9 16.22l7.5-3.35z"/>
        <path fillOpacity=".6" d="M16.5 21.97v6.03L24 17.62z"/>
        <path d="M16.5 28v-6.03L9 17.62z"/>
        <path fillOpacity=".2" d="M16.5 20.57l7.5-4.35-7.5-3.35z"/>
        <path fillOpacity=".6" d="M9 16.22l7.5 4.35v-7.7z"/>
      </g>
    </svg>
  ),
  SOL: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#000"/>
      <defs>
        <linearGradient id="solg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9945ff"/><stop offset="1" stopColor="#14f195"/></linearGradient>
      </defs>
      <path d="M9 21.5l2-2h13l-2 2H9zM9 11.5l2-2h13l-2 2H9zM23 16.5l-2-2H8l2 2h13z" fill="url(#solg)"/>
    </svg>
  ),
  BTC: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#f7931a"/>
      <path d="M21 14.3c.3-1.9-1.2-2.9-3.2-3.6l.7-2.6-1.6-.4-.7 2.5c-.4-.1-.8-.2-1.3-.3l.7-2.6-1.6-.4-.7 2.6c-.4-.1-.7-.2-1-.2L10 9l-.4 1.7s1.2.3 1.1.3c.6.2.7.6.7.9l-.8 3c0 .1.1.1.2.1l-.2-.1-1.1 4.2c-.1.2-.3.5-.8.4.1.1-1.1-.3-1.1-.3L7 20.8l2.1.5c.4.1.8.2 1.1.3l-.7 2.6 1.6.4.7-2.6 1.3.3-.7 2.6 1.6.4.7-2.6c2.8.5 4.8.3 5.7-2.2.7-2-.1-3.1-1.5-3.8 1-.3 1.8-1 2.1-2.4zm-3.7 5.1c-.5 2-3.9.9-5 .6l.9-3.5c1.1.3 4.6.8 4.1 2.9zm.5-5.1c-.5 1.8-3.3.9-4.2.6l.8-3.2c1 .2 3.9.7 3.4 2.6z" fill="#fff"/>
    </svg>
  ),
  USDC: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#2775ca"/>
      <path d="M20.5 18.5c0-2.4-1.5-3.2-4.3-3.6-2-.3-2.5-.8-2.5-1.8s.7-1.5 2-1.5c1.2 0 1.9.4 2.3 1.4.1.2.3.3.5.3h1c.3 0 .5-.2.5-.5v-.1c-.3-1.4-1.5-2.5-3-2.6v-1.5c0-.3-.2-.5-.5-.6h-1c-.3 0-.5.2-.6.5V10c-2 .3-3.2 1.6-3.2 3.2 0 2.3 1.4 3.1 4.2 3.5 1.9.3 2.5.7 2.5 1.9 0 1.2-1 2-2.4 2-1.9 0-2.5-.8-2.7-1.9-.1-.3-.3-.4-.5-.4h-1.1c-.3 0-.5.2-.5.5v.1c.3 1.6 1.3 2.7 3.4 3v1.5c0 .3.2.5.5.6h1c.3 0 .5-.2.6-.5v-1.5c2-.3 3.3-1.7 3.3-3.5z" fill="#fff"/>
    </svg>
  ),
  USDT: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#26a17b"/>
      <path d="M17.9 14.6v-2h4.5V9.5H9.7v3.1h4.5v2c-3.7.2-6.4 1-6.4 1.9 0 .9 2.8 1.7 6.4 1.9v6.5h3.6v-6.5c3.6-.2 6.4-1 6.4-1.9 0-.9-2.8-1.7-6.4-1.9zm0 3.2v-.1c-.1 0-.7.1-1.9.1-1 0-1.6 0-1.9-.1v.1c-3.2-.1-5.5-.7-5.5-1.4 0-.7 2.4-1.3 5.5-1.4v2.3c.3 0 1 .1 1.9.1 1.1 0 1.8-.1 1.9-.1v-2.3c3.1.1 5.5.7 5.5 1.4 0 .7-2.4 1.3-5.5 1.4z" fill="#fff"/>
    </svg>
  ),
  EURC: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#003399"/>
      <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#ffcc00" fontFamily="Inter, sans-serif">€</text>
    </svg>
  ),
  cbBTC: (s) => (
    <svg width={s} height={s} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#0052ff"/>
      <path d="M21 14.3c.3-1.9-1.2-2.9-3.2-3.6l.7-2.6-1.6-.4-.7 2.5c-.4-.1-.8-.2-1.3-.3l.7-2.6-1.6-.4-.7 2.6c-.4-.1-.7-.2-1-.2L10 9l-.4 1.7s1.2.3 1.1.3c.6.2.7.6.7.9l-.8 3c0 .1.1.1.2.1l-.2-.1-1.1 4.2c-.1.2-.3.5-.8.4.1.1-1.1-.3-1.1-.3L7 20.8l2.1.5c.4.1.8.2 1.1.3l-.7 2.6 1.6.4.7-2.6 1.3.3-.7 2.6 1.6.4.7-2.6c2.8.5 4.8.3 5.7-2.2.7-2-.1-3.1-1.5-3.8 1-.3 1.8-1 2.1-2.4zm-3.7 5.1c-.5 2-3.9.9-5 .6l.9-3.5c1.1.3 4.6.8 4.1 2.9zm.5-5.1c-.5 1.8-3.3.9-4.2.6l.8-3.2c1 .2 3.9.7 3.4 2.6z" fill="#fff"/>
    </svg>
  ),
};

const AssetIcon = ({ a, size=28 }) => {
  const render = TOKEN_SVGS[a.sym];
  if (render) {
    return <div style={{width:size, height:size, borderRadius:99, overflow:'hidden', flexShrink:0, display:'flex'}}>{render(size)}</div>;
  }
  return (
    <div style={{
      width:size, height:size, borderRadius:99, background: (a.color||'#888')+'22',
      border:`1px solid ${(a.color||'#888')}55`,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize: 11, fontWeight:700, color: a.color||'#888', flexShrink:0
    }}>{a.sym[0]}</div>
  );
};

const NETWORKS = [
  { id:'all', name:'All networks', color:'#8a8e98', icon: (s)=> (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
  )},
  { id:'eth', name:'Ethereum', color:'#627eea', icon: (s)=>TOKEN_SVGS.ETH(s) },
  { id:'base', name:'Base', color:'#0052ff', icon: (s)=>(
    <svg width={s} height={s} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0052ff"/><path d="M15.7 25.5c5.2 0 9.5-4.3 9.5-9.5S20.9 6.5 15.7 6.5c-5 0-9 3.8-9.5 8.6h12.6v1.7H6.3c.5 4.8 4.5 8.7 9.4 8.7z" fill="#fff"/></svg>
  )},
  { id:'arb', name:'Arbitrum', color:'#28a0f0', icon: (s)=>(
    <svg width={s} height={s} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#2d374b"/><path d="M13.5 10L9 21h3l.9-2.3h6.2L20 21h3l-4.5-11h-5zm1.7 1.8l2.2 5.5h-4.4l2.2-5.5z" fill="#28a0f0"/></svg>
  )},
  { id:'sol', name:'Solana', color:'#9945ff', icon: (s)=>TOKEN_SVGS.SOL(s) },
  { id:'poly', name:'Polygon', color:'#8247e5', icon: (s)=>(
    <svg width={s} height={s} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#8247e5"/><path d="M20.5 13.5l-3-1.7c-.3-.1-.6-.1-.9 0l-3 1.7c-.3.2-.5.5-.5.8v3.4c0 .3.2.6.5.8l3 1.7c.3.1.6.1.9 0l3-1.7c.3-.2.5-.5.5-.8v-3.4c0-.3-.2-.6-.5-.8zm-5.5 5.1l-1.5-.9v-1.7l1.5.9v1.7zm0-3.4l-1.5-.9 1.5-.9 1.5.9-1.5.9zm3 2.5l-1.5.9v-1.7l1.5-.9v1.7z" fill="#fff"/></svg>
  )},
];

const AssetsCard = ({ onAssetClick }) => {
  const [q, setQ] = useState('');
  const [net, setNet] = useState(NETWORKS[0]);
  const [openNet, setOpenNet] = useState(false);
  const [sort, setSort] = useState('Descending');
  const [openSort, setOpenSort] = useState(false);
  const numVal = v => parseFloat(String(v).replace(/[^0-9.-]/g,'')) || 0;
  const filtered = ASSETS
    .filter(a => !q || a.sym.toLowerCase().includes(q.toLowerCase()) || a.name.toLowerCase().includes(q.toLowerCase()))
    .slice()
    .sort((a,b) => {
      if (sort === 'Alphabetical') return a.name.localeCompare(b.name);
      if (sort === 'Ascending') return numVal(a.val) - numVal(b.val);
      return numVal(b.val) - numVal(a.val); // Descending
    });
  return (
    <div style={{...shellStyles.card, padding: 0}}>
      <div style={{padding:'14px 16px', borderBottom:'1px solid var(--border-soft)', display:'flex', alignItems:'center', gap:10}}>
        <IconSearch size={16}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13, fontWeight:500}}>Assets</div>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search assets"
            style={{border:'none', background:'transparent', outline:'none', fontSize:12, color:'var(--text-dim)', width:'100%', padding: 0, marginTop:2}}/>
        </div>
      </div>
      <div style={{padding:'10px 14px', display:'flex', gap:8, alignItems:'center', borderBottom:'1px solid var(--border-soft)', position:'relative'}}>
        <div style={{position:'relative'}}>
          <button onClick={()=>{setOpenNet(!openNet); setOpenSort(false);}} style={shellStyles.chip}>
            <span style={{width:14, height:14, display:'inline-flex', alignItems:'center', justifyContent:'center', color:net.color, marginRight:2}}>
              {net.icon(14)}
            </span>
            {net.name} <IconChev size={12}/>
          </button>
          {openNet && (
            <div style={{position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:20, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:10, padding:4, minWidth:170, boxShadow:'0 10px 30px #000a'}}>
              {NETWORKS.map(n => (
                <button key={n.id} onClick={()=>{setNet(n); setOpenNet(false);}}
                  style={{display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 10px', background: net.id===n.id?'var(--chip)':'transparent', border:'none', borderRadius:6, cursor:'pointer', color:'var(--text)', textAlign:'left'}}>
                  <span style={{width:18, height:18, display:'inline-flex', alignItems:'center', justifyContent:'center', color:n.color}}>
                    {n.icon(18)}
                  </span>
                  <span style={{fontSize:13, flex:1}}>{n.name}</span>
                  {net.id===n.id && <IconCheck size={12} extra={<></>}/>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{position:'relative'}}>
          <button onClick={()=>{setOpenSort(!openSort); setOpenNet(false);}} style={shellStyles.chip}>{sort} <IconChev size={12}/></button>
          {openSort && (
            <div style={{position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:20, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:10, padding:4, minWidth:140, boxShadow:'0 10px 30px #000a'}}>
              {['Descending','Ascending','Alphabetical'].map(s => (
                <button key={s} onClick={()=>{setSort(s); setOpenSort(false);}}
                  style={{display:'block', width:'100%', padding:'8px 10px', background: sort===s?'var(--chip)':'transparent', border:'none', borderRadius:6, cursor:'pointer', color:'var(--text)', fontSize:13, textAlign:'left'}}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{flex:1}}/>
        <div style={{fontSize:12, color:'var(--text-dim)'}}>PnL</div>
      </div>
      <div style={{maxHeight: 320, overflow:'auto'}}>
        {filtered.map(a => (
          <div key={a.sym} className="assetRow" onClick={() => onAssetClick(a)}
            style={shellStyles.assetRow}>
            <AssetIcon a={a} />
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                <span style={{fontWeight:500, fontSize:14}}>{a.name}</span>
                <span style={{fontSize:12, color: a.pct>=0?'var(--green)':'var(--red)'}}>
                  {a.pct>=0?'↗':'↘'} {Math.abs(a.pct).toFixed(2)}%
                </span>
              </div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:2}}>
                {a.sym} · {a.price}
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:14, fontWeight:500}}>{a.qty}</div>
              <div style={{fontSize:12, color:'var(--text-dim)'}}>{a.val}</div>
            </div>
            <IconChev size={14} extra={<></>} />
          </div>
        ))}
      </div>
    </div>
  );
};

const shellStyles = {
  header: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'18px 32px', borderBottom:'1px solid var(--border-soft)',
  },
  iconBtn: {
    width:36, height:36, borderRadius:10, background:'transparent',
    border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center',
    color:'var(--text-dim)', cursor:'pointer', transition:'all .15s'
  },
  walletBtn: {
    padding:'9px 16px', borderRadius:10, background:'var(--accent)',
    color: '#fff', border:'none', fontSize:14, fontWeight:500, cursor:'pointer',
    display:'flex', alignItems:'center', gap:8, transition:'all .15s'
  },
  card: {
    background:'var(--panel-solid)', border:'1px solid var(--border-soft)',
    borderRadius:16, padding: 'calc(18px * var(--density))', cursor:'default',
    transition:'border-color .2s'
  },
  rangeGroup: {
    display:'inline-flex', background:'var(--bg-elev)', borderRadius: 99,
    padding: 3, gap: 0, border:'1px solid var(--border-soft)'
  },
  rangeBtn: {
    padding:'4px 10px', borderRadius: 99, border:'none', background:'transparent',
    color:'var(--text-dim)', fontSize:12, cursor:'pointer', fontWeight:500
  },
  rangeBtnActive: {
    background:'var(--chip)', color:'var(--text)'
  },
  chip: {
    padding:'5px 10px', borderRadius: 99, border:'1px solid var(--border)',
    background:'var(--bg-elev)', color:'var(--text-dim)', fontSize:12,
    display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer'
  },
  assetRow: {
    display:'flex', alignItems:'center', gap:12,
    padding:'12px 16px', borderBottom:'1px solid var(--border-soft)',
    cursor:'pointer', transition:'background .15s'
  }
};

Object.assign(window, { Header, PortfolioCard, AssetsCard, AssetIcon, ASSETS, TOKEN_SVGS, shellStyles });
