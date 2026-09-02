// Right-side panels: home menu, pool list, add liquidity, swap
const { useState: uS, useEffect: uE, useMemo: uM } = React;

// ── Panel chrome (header + close/back) ──────────────────────────
const PanelHeader = ({ title, subtitle, onBack, onClose, right }) => (
  <div style={{display:'flex', alignItems:'flex-start', gap: 10, padding: '18px 20px 14px', borderBottom:'1px solid var(--border-soft)'}}>
    {onBack && (
      <button onClick={onBack} style={panelStyles.iconBtn} aria-label="back">
        <IconBack size={16}/>
      </button>
    )}
    <div style={{flex:1, minWidth:0}}>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <div style={{fontSize: 17, fontWeight: 600, letterSpacing:'-.01em'}}>{title}</div>
      </div>
      {subtitle && <div style={{fontSize:13, color:'var(--text-dim)', marginTop: 2}}>{subtitle}</div>}
    </div>
    {right}
    {onClose && (
      <button onClick={onClose} style={panelStyles.iconBtn} aria-label="close">
        <IconClose size={16}/>
      </button>
    )}
  </div>
);

// ── Home (default) panel ────────────────────────────────────────
const HomeMenu = ({ go, onNewChat, onHistory }) => {
  const prompts = [
    { id:'pool', title:'Create / Add Liquidity', icon: <IconDroplet size={18}/>, route:'pool-list' },
    { id:'swap', title:'Swap Tokens', icon: <IconSwap size={18}/>, route:'swap' },
    { id:'analyze', title:'Analyze and research your favorite token or protocol', icon: <IconChart size={18}/>, route:'analyze' },
    { id:'agent', title:'Create / Manage Agent', icon: <IconBot size={18}/>, route:'agent' },
  ];
  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={onNewChat}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn} onClick={onHistory}><IconHistory size={14}/> History</button>
        </div>
      } />
      <div style={{padding: 24, flex:1, display:'flex', flexDirection:'column'}}>
        <div style={{display:'flex', alignItems:'flex-start', gap:12, marginBottom: 10}}>
          <div style={panelStyles.avatarSm}><LogoMark size={22}/></div>
          <div>
            <div style={{fontSize: 17, fontWeight:500}}>What can I help you with?</div>
            <div style={{fontSize: 13, color:'var(--text-dim)', marginTop:4}}>Try some of the prompts below or use your own to begin.</div>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop: 14}}>
          {prompts.map(p => (
            <button key={p.id} onClick={() => go(p.route)} className="promptCard" style={panelStyles.promptCard}>
              <div style={{fontSize: 13, lineHeight: 1.4, textAlign:'left', color:'var(--text)'}}>{p.title}</div>
              <div style={{color:'var(--text-dim)', marginTop: 24}}>{p.icon}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

// ── Pool list (Create Liquidity) ────────────────────────────────
const POOLS = [
  { a:'ETH',  b:'USDC', tvl:'$482.1M', vol:'$28.4M', fee:'$8,520', apr:'6.42%', tier:'0.05%', hook:'No Hook',            category:'Majors' },
  { a:'USDC', b:'EURC', tvl:'$124.7M', vol:'$6.8M',  fee:'$1,020', apr:'3.85%', tier:'0.01%', hook:'StableProtection',   category:'Stables' },
  { a:'USDC', b:'USDT', tvl:'$68.4M',  vol:'$18.0M', fee:'$900',   apr:'2.41%', tier:'0.01%', hook:'StableProtection',   category:'Stables' },
  { a:'ETH',  b:'USDC', tvl:'$312.5M', vol:'$22.1M', fee:'$6,840', apr:'7.18%', tier:'dynamic', hook:'Dynamic Fee',      category:'Majors' },
  { a:'cbBTC',b:'USDC', tvl:'$96.3M',  vol:'$5.2M',  fee:'$1,562', apr:'4.62%', tier:'dynamic', hook:'Dynamic Fee',      category:'Majors' },
  { a:'USDC', b:'EURC', tvl:'$42.0M',  vol:'$1.8M',  fee:'$420',   apr:'5.20%', tier:'0.05%', hook:'RWAgate',            category:'RWAs' },
  { a:'USDC', b:'cbBTC',tvl:'$38.2M',  vol:'$2.1M',  fee:'$512',   apr:'4.95%', tier:'0.05%', hook:'RWAgate',            category:'RWAs' },
  { a:'ETH',  b:'USDC', tvl:'$58.6M',  vol:'$3.4M',  fee:'$980',   apr:'8.14%', tier:'0.05%', hook:'ALO',                category:'Async Limit Order' },
];

const PoolListPanel = ({ back, close, onSelectPool, onCreate }) => {
  const [q, setQ] = uS('');
  const [sort, setSort] = uS('tvl');
  const [cat, setCat] = uS('All');
  const [openCat, setOpenCat] = uS(false);
  const CATEGORIES = ['All', 'Stables', 'Majors', 'RWAs', 'Async Limit Order'];
  const filtered = POOLS.filter(p => {
    const s = q.toLowerCase();
    const matchQ = !q
      || `${p.a}/${p.b}`.toLowerCase().includes(s)
      || p.a.toLowerCase().includes(s)
      || p.b.toLowerCase().includes(s)
      || p.hook.toLowerCase().includes(s);
    const matchCat = cat === 'All' || p.category === cat;
    return matchQ && matchCat;
  });
  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />
      <div style={{padding:'18px 20px 0'}}>
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:18, fontWeight:600}}>Create Pool</div>
            <div style={{fontSize:13, color:'var(--text-dim)', marginTop:2}}>Explore and manage your liquidity positions.</div>
          </div>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 10, marginTop: 18}}>
          {[{l:'TVL',v:'$1.28M'}, {l:'VOLUME',v:'$180.25K'}, {l:'FEES',v:'$540.75'}].map(s => (
            <div key={s.l} style={panelStyles.statBox}>
              <div style={{fontSize: 11, color:'var(--text-mute)', letterSpacing:'.08em'}}>{s.l}</div>
              <div style={{fontSize: 22, fontWeight:600, marginTop:4, letterSpacing:'-.01em'}}>{s.v}</div>
            </div>
          ))}
        </div>

        <div style={{display:'flex', gap:8, marginTop: 16, alignItems:'center', position:'relative'}}>
          <div style={panelStyles.searchBox}>
            <IconSearch size={15}/>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pools or hooks..."
              style={{background:'transparent', border:'none', outline:'none', color:'inherit', fontSize:13, flex:1, padding:0}}/>
          </div>
          <div style={{position:'relative'}}>
            <button onClick={()=>setOpenCat(!openCat)} style={{...panelStyles.chip, padding:'8px 12px'}}>
              {cat} <IconChev size={12}/>
            </button>
            {openCat && (
              <div style={{position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:30, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:10, padding:4, minWidth:160, boxShadow:'0 10px 30px #000a'}}>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={()=>{setCat(c); setOpenCat(false);}}
                    style={{display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'8px 10px', background: cat===c?'var(--chip)':'transparent', border:'none', borderRadius:6, cursor:'pointer', color:'var(--text)', fontSize:13, textAlign:'left'}}>
                    <span>{c}</span>
                    <span style={{fontSize:11, color:'var(--text-mute)'}}>
                      {c==='All' ? POOLS.length : POOLS.filter(p=>p.category===c).length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onCreate} style={{...panelStyles.primaryBtn, padding:'8px 14px', fontSize:13}}>
            <IconPlus size={14}/> Create Pool
          </button>
        </div>
      </div>

      <div style={{padding:'16px 20px 0', flex:1, display:'flex', flexDirection:'column', minHeight:0}}>
        <div style={panelStyles.tableHeader}>
          <div style={{flex: 1.6}}>Pool</div>
          <div style={{flex:1, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end'}}>TVL ↓ <IconChev size={10}/></div>
          <div style={{flex:1, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end'}}>VOLUME (24H) <IconChev size={10}/></div>
          <div style={{flex:.9, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end'}}>FEES (24H) <IconChev size={10}/></div>
          <div style={{flex:.6, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end'}}>APR <IconChev size={10}/></div>
        </div>
        <div style={{overflow:'auto', flex:1}}>
          {filtered.length === 0 && (
            <div style={{padding:'40px 20px', textAlign:'center', color:'var(--text-dim)', fontSize:13}}>No pools match your search.</div>
          )}
          {filtered.map((p,i) => {
            const hasHook = p.hook && p.hook !== 'No Hook';
            return (
              <div key={i} onClick={() => onSelectPool(p)} className="poolRow" style={panelStyles.poolRow}>
                <div style={{flex: 1.6, display:'flex', alignItems:'center', gap:10, minWidth:0}}>
                  <div style={{display:'flex'}}>
                    <AssetIcon a={ASSETS.find(x=>x.sym===p.a) || {sym:p.a, color:'#627eea'}} size={22}/>
                    <div style={{marginLeft:-8}}>
                      <AssetIcon a={ASSETS.find(x=>x.sym===p.b) || {sym:p.b, color:'#2775ca'}} size={22}/>
                    </div>
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:500, fontSize:13}}>{p.a} / {p.b}</div>
                    <div style={{fontSize:11, color:'var(--text-mute)', marginTop:3, display:'flex', alignItems:'center', gap:6}}>
                      <span>{p.tier}</span>
                      <span
                        style={hasHook ? {
                          padding:'2px 7px', borderRadius:6, fontSize:10, fontWeight:600, letterSpacing:'.01em',
                          background:'rgba(61, 220, 151, 0.14)', color:'var(--green)',
                          border:'1px solid rgba(61, 220, 151, 0.35)'
                        } : {
                          padding:'2px 7px', borderRadius:6, fontSize:10, fontWeight:500, letterSpacing:'.01em',
                          background:'var(--chip)', color:'var(--text-mute)',
                          border:'1px solid var(--border-soft)'
                        }}>
                        {p.hook}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{flex:1, textAlign:'right', fontSize:13}} className="mono">{p.tvl}</div>
                <div style={{flex:1, textAlign:'right', fontSize:13}} className="mono">{p.vol}</div>
                <div style={{flex:.9, textAlign:'right', fontSize:13}} className="mono">{p.fee}</div>
                <div style={{flex:.6, textAlign:'right', fontSize:13, color:'var(--green)'}} className="mono">{p.apr}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// ── Add Liquidity panel ─────────────────────────────────────────
const AddLiquidityPanel = ({ pool, back, close, onSubmit }) => {
  const [tokenA, setTokenA] = uS('0.0');
  const [tokenB, setTokenB] = uS('0.0');
  const [flipped, setFlipped] = uS(false);
  const symA = flipped ? pool.b : pool.a;
  const symB = flipped ? pool.a : pool.b;
  const [range, setRange] = uS('Full');
  const [hook, setHook] = uS({name:'No Hook', desc:'Standard execution'});
  const [showHooks, setShowHooks] = uS(false);
  const [rangeChart, setRangeChart] = uS('7D');

  const hooks = [
    {name:'No Hook',           desc:'Standard execution'},
    {name:'Stable Protection', desc:'Minimizes depeg & slippage'},
    {name:'Dynamic Fee',       desc:'Fees adjust to volatility'},
    {name:'RWAgate',           desc:'Compliance-gated routing'},
    {name:'Async Limit Order', desc:'Off-chain matching, on-chain settle'},
  ];

  // Deterministic chart
  const pts = uM(() => Array.from({length: 28}, (_,i) => 55 + Math.sin(i*0.9)*6 + Math.cos(i*1.4)*3));
  const w=480, h=130, pad=14;
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const sx = i => pad + i/(pts.length-1) * (w - pad*2);
  const sy = v => pad + (1-(v-mn)/(mx-mn+.001)) * (h - pad*2);
  const chartPath = pts.map((v,i)=>`${i===0?'M':'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />

      <div style={{padding:'16px 20px 0'}}>
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:18, fontWeight:600}}>Create Pool</div>
            <div style={{fontSize:13, color:'var(--text-dim)', marginTop:2}}>Explore and manage your liquidity positions.</div>
          </div>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
      </div>

      <div style={{padding:'14px 20px', flex:1, overflow:'auto'}}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
          <button onClick={back} style={panelStyles.iconBtn}><IconBack size={14}/></button>
          <div style={{display:'flex', gap:-6}}>
            <AssetIcon a={ASSETS.find(x=>x.sym===symA) || {sym:symA, color:'#627eea'}} size={22}/>
            <div style={{marginLeft:-8}}>
              <AssetIcon a={ASSETS.find(x=>x.sym===symB) || {sym:symB, color:'#3ddc97'}} size={22}/>
            </div>
          </div>
          <div style={{fontWeight:600, fontSize:14}}>{symA} / {symB}</div>
          <div style={{...panelStyles.tag, fontSize:10}}>{pool.hook?.toUpperCase() || 'NO HOOK'}</div>
        </div>
        <div style={{display:'flex', gap:14, fontSize:12, marginBottom:14, color:'var(--text-dim)'}}>
          <span style={{color:'var(--green)'}}>↗ 0.029% Fee</span>
          <span>TVL — {pool.tvl||''}</span>
          <span>APY — {pool.apr||''}</span>
        </div>

        {/* Chart tabs */}
        <div style={{display:'flex', gap:16, fontSize:12, color:'var(--text-dim)', borderBottom:'1px solid var(--border-soft)', paddingBottom:8}}>
          <span style={{color:'var(--text)', fontWeight:500, borderBottom:'2px solid var(--amber)', paddingBottom:6, marginBottom:-9}}>Volume</span>
          <span>TVL</span>
          <div style={{flex:1}}/>
          <div style={panelStyles.rangeGroup}>
            {['1D','7D','30D'].map(r => (
              <button key={r} onClick={()=>setRangeChart(r)} style={{...panelStyles.rangeBtn, ...(rangeChart===r?panelStyles.rangeBtnActive:{})}}>{r}</button>
            ))}
          </div>
        </div>

        <div style={{fontSize: 11, color:'var(--text-mute)', marginTop:10}}>Token A/Token B Price</div>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{display:'block', marginTop:4}}>
          <defs>
            <linearGradient id="alFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--amber)" stopOpacity=".25"/>
              <stop offset="1" stopColor="var(--amber)" stopOpacity="0"/>
            </linearGradient>
          </defs>
          {/* y-axis ticks */}
          {[0, 0.33, 0.66, 1].map((t,i) => (
            <text key={i} x={0} y={pad + t*(h-pad*2)+3} fill="var(--text-mute)" fontSize="8" fontFamily="JetBrains Mono, monospace">
              {(1.005 - t*0.008).toFixed(4).replace(/^/, '$')}
            </text>
          ))}
          <line x1={pad+18} y1={h-pad} x2={w-pad} y2={h-pad} stroke="var(--border-soft)" strokeDasharray="2 3"/>
          <path d={chartPath+` L${sx(pts.length-1)},${h-pad} L${sx(0)},${h-pad} Z`} fill="url(#alFill)"/>
          <path d={chartPath} fill="none" stroke="var(--amber)" strokeWidth="1.5"/>
          {/* X ticks */}
          {Array.from({length: 28}).map((_,i) => i%1===0 && (
            <text key={i} x={sx(i)} y={h-2} fill="var(--text-mute)" fontSize="8" textAnchor="middle" fontFamily="JetBrains Mono, monospace">{i+1}</text>
          ))}
        </svg>

        {/* Token inputs */}
        <div style={{display:'grid', gridTemplateColumns:'1fr auto 1fr', gap: 8, marginTop: 16, alignItems:'stretch'}}>
          <TokenInput label="Token A" value={tokenA} onChange={setTokenA} sym={symA} balance="0.00"/>
          <button
            onClick={() => {
              setFlipped(f => !f);
              setTokenA(tokenB);
              setTokenB(tokenA);
            }}
            title="Flip token order"
            style={{...panelStyles.iconBtn, alignSelf:'center', transform:'rotate(90deg)'}}>
            <IconSwap size={14}/>
          </button>
          <TokenInput label="Token B" value={tokenB} onChange={setTokenB} sym={symB} balance="0.00"/>
        </div>

        {/* Hook + Range */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginTop: 16}}>
          <div>
            <div style={{fontSize:10, color:'var(--text-mute)', letterSpacing:'.08em', marginBottom:6}}>LIQUIDITY HOOK</div>
            <div style={{position:'relative'}}>
              <button onClick={()=>setShowHooks(!showHooks)} style={panelStyles.selectBtn}>
                <IconArrowUp size={14}/>
                <div style={{flex:1, textAlign:'left'}}>
                  <div style={{fontSize:13, fontWeight:500}}>{hook.name}</div>
                  <div style={{fontSize:11, color:'var(--text-dim)'}}>{hook.desc}</div>
                </div>
                <IconChev size={14}/>
              </button>
              {showHooks && (
                <div style={panelStyles.dropdown}>
                  {hooks.map(h => (
                    <button key={h.name} onClick={()=>{setHook(h); setShowHooks(false);}} style={panelStyles.dropdownItem}>
                      <div style={{fontSize:13, fontWeight:500}}>{h.name}</div>
                      <div style={{fontSize:11, color:'var(--text-dim)'}}>{h.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <div style={{fontSize:10, color:'var(--text-mute)', letterSpacing:'.08em', marginBottom:6}}>PRICE RANGE</div>
            <div style={{display:'flex', gap:4, background:'var(--bg-elev)', padding: 3, borderRadius:10, border:'1px solid var(--border-soft)'}}>
              {['Full','Wide','Narrow','∞'].map(r => (
                <button key={r} onClick={()=>setRange(r)} style={{flex:1, padding:'8px 0', borderRadius:8, border:'none', fontSize:12, cursor:'pointer', background: range===r?'var(--chip)':'transparent', color: range===r?'var(--text)':'var(--text-dim)', fontWeight:500}}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginTop:18, color:'var(--text-dim)'}}>
          <span>Fee Tier</span>
          <span className="mono" style={{color:'var(--text)'}}>0.05%</span>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginTop:8, color:'var(--text-dim)'}}>
          <span>Hook Benefit</span>
          <span style={{color:'var(--green)'}}>{hook.desc}</span>
        </div>

        <button onClick={() => onSubmit({pool: {...pool, a:symA, b:symB}, tokenA, tokenB, hook, range})}
          style={{...panelStyles.primaryBtn, width:'100%', padding:'12px', marginTop:18, fontSize:14}}>
          Review &amp; Sign Position
        </button>
      </div>
    </>
  );
};

const TokenInput = ({ label, value, onChange, sym, balance, readOnly }) => (
  <div style={panelStyles.tokenBox}>
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11}}>
      <span style={{color:'var(--text-dim)'}}>{label}</span>
      <span style={{color:'var(--text-mute)'}}>Balance: {balance}</span>
    </div>
    <div style={{display:'flex', alignItems:'center', gap:8, marginTop: 4}}>
      <input value={value} onChange={e => onChange && onChange(e.target.value)} readOnly={readOnly}
        style={{background:'transparent', border:'none', outline:'none', fontSize: 24, fontWeight:400, color:'var(--text)', width:'100%', padding:0, letterSpacing:'-.01em'}} className="mono"/>
      <button style={panelStyles.tokenPick}>
        {sym ? <AssetIcon a={ASSETS.find(x=>x.sym===sym) || {sym, color:'#888'}} size={18}/> : <div style={{width:18, height:18, borderRadius:99, background:'var(--border)'}}/>}
        <span style={{fontSize:13, fontWeight:500}}>{sym || 'Select token'}</span>
        <IconChev size={12}/>
      </button>
    </div>
    <div style={{fontSize:11, color:'var(--text-mute)', marginTop:2}}>≈ $0.00</div>
    <div style={{borderTop:'1px dashed var(--border-soft)', marginTop:10, paddingTop:8, display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-dim)'}}>
      <span>Current Price</span>
      <span className="mono">$—</span>
    </div>
  </div>
);

const panelStyles = {
  iconBtn: {
    width:30, height:30, borderRadius:8, background:'transparent',
    border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center',
    color:'var(--text-dim)', cursor:'pointer', flexShrink:0
  },
  ghostBtn: {
    padding:'7px 12px', borderRadius:8, border:'1px solid var(--border)',
    background:'transparent', color:'var(--text-dim)', fontSize:12,
    display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer'
  },
  primaryBtn: {
    background:'var(--accent)', color:'#fff', border:'none', borderRadius:10,
    fontWeight:500, cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6
  },
  avatarSm: {
    width:28, height:28, borderRadius:10, background:'var(--bg-elev)',
    border:'1px solid var(--border-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0
  },
  promptCard: {
    background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:14,
    padding: 16, minHeight: 105, cursor:'pointer', display:'flex', flexDirection:'column',
    justifyContent:'space-between', transition:'all .2s', textAlign:'left'
  },
  statBox: {
    background:'var(--bg-elev)', border:'1px solid var(--border-soft)',
    borderRadius: 12, padding: 14
  },
  searchBox: {
    flex:1, display:'flex', alignItems:'center', gap:8, padding:'9px 12px',
    background:'var(--bg-elev)', borderRadius:10, border:'1px solid var(--border-soft)', color:'var(--text-dim)'
  },
  chip: {
    padding:'8px 12px', borderRadius: 10, border:'1px solid var(--border-soft)',
    background:'var(--bg-elev)', color:'var(--text-dim)', fontSize:13,
    display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer'
  },
  tableHeader: {
    display:'flex', padding:'10px 12px', fontSize:11, color:'var(--text-mute)',
    letterSpacing:'.06em', borderBottom:'1px solid var(--border-soft)'
  },
  poolRow: {
    display:'flex', alignItems:'center', padding:'12px', borderBottom:'1px solid var(--border-soft)',
    cursor:'pointer', transition:'background .15s'
  },
  tag: {
    padding:'2px 8px', borderRadius:6, background:'var(--chip)', color:'var(--text-dim)',
    fontSize:10, fontWeight:600, letterSpacing:'.08em'
  },
  rangeGroup: {
    display:'inline-flex', background:'var(--bg-elev)', borderRadius: 8,
    padding: 2, border:'1px solid var(--border-soft)'
  },
  rangeBtn: {
    padding:'3px 10px', borderRadius: 6, border:'none', background:'transparent',
    color:'var(--text-dim)', fontSize:11, cursor:'pointer'
  },
  rangeBtnActive: { background:'var(--green)', color:'#0a1a14' },
  tokenBox: {
    background:'var(--bg-elev)', border:'1px solid var(--border-soft)',
    borderRadius:12, padding: 12, minWidth: 0
  },
  tokenPick: {
    display:'flex', alignItems:'center', gap:6, padding:'5px 10px',
    borderRadius: 99, background:'var(--chip)', border:'1px solid var(--border-soft)',
    color:'var(--text)', cursor:'pointer', flexShrink:0
  },
  selectBtn: {
    width:'100%', display:'flex', alignItems:'center', gap:10, padding: 10,
    background:'var(--bg-elev)', border:'1px solid var(--border-soft)',
    borderRadius: 10, color:'var(--text)', cursor:'pointer'
  },
  dropdown: {
    position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:10,
    background:'var(--panel-solid)', border:'1px solid var(--border)',
    borderRadius:10, padding:4, boxShadow:'0 8px 24px #0008'
  },
  dropdownItem: {
    width:'100%', display:'block', textAlign:'left', padding:'8px 10px',
    background:'transparent', border:'none', borderRadius:6, cursor:'pointer', color:'var(--text)'
  }
};

Object.assign(window, {
  PanelHeader, HomeMenu, PoolListPanel, POOLS, AddLiquidityPanel, TokenInput, panelStyles
});
