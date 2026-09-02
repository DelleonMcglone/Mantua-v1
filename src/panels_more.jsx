// More panels: Swap, Analyze, Agent builder, Transaction sign, Position detail, Onboarding, Wallet connect, Settings
const { useState: useS, useMemo: useMo, useEffect: useEf } = React;

// ── Swap panel (with hook dropdown) ─────────────────────────────
const SwapPanel = ({ close, onReview }) => {
  const [from, setFrom] = useS({sym:'ETH', amount:'0.00'});
  const [to, setTo] = useS({sym:'USDC', amount:'0.00'});
  const [slippage, setSlippage] = useS('0.5');
  const [hook, setHook] = useS({name:'No Hook', desc:'Standard execution'});
  const [showHooks, setShowHooks] = useS(false);
  const [showFromPicker, setShowFromPicker] = useS(false);
  const [showToPicker, setShowToPicker] = useS(false);

  const hooks = [
    {name:'No Hook',           desc:'Standard execution',                      icon:null},
    {name:'Stable Protection', desc:'Minimizes depeg & slippage',              icon:<IconShield size={14}/>},
    {name:'Dynamic Fee',       desc:'Fees adjust to volatility',               icon:<IconZap size={14}/>},
    {name:'RWAgate',           desc:'Compliance-gated routing',                icon:<IconLayers size={14}/>},
    {name:'Async Limit Order', desc:'Off-chain matching, on-chain settle',     icon:<IconChart size={14}/>},
  ];

  const tokens = ['ETH','SOL','BTC','USDC','USDT','cbBTC','EURC'];
  const flip = () => { setFrom(to); setTo(from); };

  const fromBal = from.sym === 'ETH' ? '0.00' : '339.5718';
  const toBal   = to.sym === 'USDC' ? '339.5718' : '0.00';
  const fromPrice = from.sym === 'ETH' ? '$2311.19' : '$1.00';
  const toPrice   = to.sym === 'USDC' ? '$1.00' : '$2311.19';
  const amtFrom = parseFloat(from.amount) || 0;
  const usdFrom = amtFrom * (from.sym === 'ETH' ? 2311.19 : 1);
  const usdTo   = amtFrom * (from.sym === 'ETH' ? 2311.19 : 1);

  // Styles
  const card = { background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:14, padding:'14px 16px' };
  const pctBtn = { flex:1, padding:'7px 0', border:'1px solid var(--border)', background:'transparent', color:'var(--text-dim)', borderRadius:8, fontSize:12, cursor:'pointer', fontWeight:500 };
  const tokenPill = { display:'flex', alignItems:'center', gap:8, padding:'7px 12px 7px 8px', background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:99, cursor:'pointer', color:'var(--text)', fontWeight:500 };

  const setPct = (pct) => {
    const max = from.sym === 'ETH' ? 0 : 339.5718;
    const v = (max * pct / 100).toFixed(2);
    setFrom({...from, amount: v});
  };

  const amountEntered = amtFrom > 0;

  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />

      <div style={{padding:'18px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{fontSize:20, fontWeight:600}}>Swap</div>
        <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
      </div>

      <div style={{padding:'16px 20px 20px', flex:1, overflow:'auto'}}>
        {/* Sell */}
        <div style={card}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13}}>
            <span style={{color:'var(--text)'}}>Sell</span>
            <span style={{color:'var(--text-dim)'}}>Balance: {fromBal}</span>
          </div>
          <div style={{display:'flex', gap:8, marginTop:10}}>
            {['25%','50%','75%','Max'].map(p => (
              <button key={p} onClick={()=>setPct(p==='Max'?100:parseInt(p))} style={pctBtn}>{p}</button>
            ))}
          </div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:14}}>
            <div>
              <input value={from.amount} onChange={e=>setFrom({...from, amount:e.target.value})}
                className="mono"
                style={{background:'transparent', border:'none', outline:'none', fontSize:38, fontWeight:300, color: amountEntered ? 'var(--text)' : 'var(--text-mute)', padding:0, letterSpacing:'-.03em', width:'100%'}}/>
              <div style={{fontSize:13, color:'var(--text-mute)', marginTop:2}}>≈ ${usdFrom.toFixed(2)}</div>
            </div>
            <TokenPicker sym={from.sym} open={showFromPicker} setOpen={setShowFromPicker} onPick={s=>{setFrom({...from, sym:s}); setShowFromPicker(false);}} tokens={tokens} pillStyle={tokenPill}/>
          </div>
          <div style={{borderTop:'1px solid var(--border-soft)', marginTop:14, paddingTop:12, display:'flex', justifyContent:'space-between', fontSize:13}}>
            <span style={{color:'var(--text-dim)'}}>Current Price</span>
            <span className="mono" style={{color:'var(--text)'}}>{fromPrice}</span>
          </div>
        </div>

        {/* Flip button */}
        <div style={{display:'flex', justifyContent:'center', margin:'-10px 0', position:'relative', zIndex:5}}>
          <button onClick={flip} title="Flip"
            style={{width:34, height:34, borderRadius:99, background:'var(--bg-elev)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--green)'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 20V4M7 4l-4 4M7 4l4 4"/>
              <path d="M17 4v16M17 20l-4-4M17 20l4-4"/>
            </svg>
          </button>
        </div>

        {/* Buy */}
        <div style={card}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13}}>
            <span style={{color:'var(--text)'}}>Buy</span>
            <span style={{color:'var(--text-dim)'}}>Balance: {toBal}</span>
          </div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:14}}>
            <div>
              <input value={to.amount} readOnly className="mono"
                style={{background:'transparent', border:'none', outline:'none', fontSize:38, fontWeight:300, color:'var(--text-mute)', padding:0, letterSpacing:'-.03em', width:'100%'}}/>
              <div style={{fontSize:13, color:'var(--text-mute)', marginTop:2}}>≈ ${usdTo.toFixed(2)}</div>
            </div>
            <TokenPicker sym={to.sym} open={showToPicker} setOpen={setShowToPicker} onPick={s=>{setTo({...to, sym:s}); setShowToPicker(false);}} tokens={tokens} pillStyle={tokenPill}/>
          </div>
          <div style={{borderTop:'1px solid var(--border-soft)', marginTop:14, paddingTop:12, display:'flex', justifyContent:'space-between', fontSize:13}}>
            <span style={{color:'var(--text-dim)'}}>Current Price</span>
            <span className="mono" style={{color:'var(--text)'}}>{toPrice}</span>
          </div>
        </div>

        {/* SWAP HOOK */}
        <div style={{marginTop:20}}>
          <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.12em', marginBottom:8, fontWeight:600}}>SWAP HOOK</div>
          <div style={{position:'relative'}}>
            <button onClick={()=>setShowHooks(!showHooks)}
              style={{...card, padding:'14px 16px', display:'flex', alignItems:'center', gap:12, width:'100%', cursor:'pointer', textAlign:'left', color:'var(--text)'}}>
              <div style={{flex:1}}>
                <div style={{fontSize:15, fontWeight:600}}>{hook.name}</div>
                <div style={{fontSize:13, color:'var(--green)', marginTop:2}}>{hook.desc}</div>
              </div>
              <IconChev size={16}/>
            </button>
            {showHooks && (
              <div style={{position:'absolute', top:'calc(100% + 6px)', left:0, right:0, zIndex:20, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:12, padding:6, boxShadow:'0 12px 36px #000a', maxHeight:320, overflow:'auto'}}>
                {hooks.map(h => (
                  <button key={h.name} onClick={()=>{setHook(h); setShowHooks(false);}}
                    style={{display:'flex', alignItems:'center', gap:12, width:'100%', padding:'10px 12px', background: hook.name===h.name?'var(--chip)':'transparent', border:'none', borderRadius:8, cursor:'pointer', color:'var(--text)', textAlign:'left', marginBottom:2}}>
                    <div style={{width:30, height:30, borderRadius:8, background:'var(--chip)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--green)', flexShrink:0}}>
                      {h.icon || <IconLayers size={14}/>}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, fontWeight:500}}>{h.name}</div>
                      <div style={{fontSize:11, color:'var(--text-dim)', marginTop:2}}>{h.desc}</div>
                    </div>
                    {hook.name===h.name && <IconCheck size={14} extra={<></>}/>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Exchange Rate */}
        <div style={{...card, marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 16px'}}>
          <span style={{fontSize:13, color:'var(--text-dim)'}}>Exchange Rate (Incl. Fees)</span>
          <span className="mono" style={{fontSize:13, fontWeight:500}}>1 ETH = 2,311.18 USDC</span>
        </div>

        {/* Fee Architecture */}
        <div style={{marginTop:20}}>
          <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.12em', marginBottom:10, fontWeight:600}}>FEE ARCHITECTURE</div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0'}}>
            <span style={{color:'var(--text-dim)'}}>LP Fee</span>
            <span className="mono">0.0025%</span>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0'}}>
            <span style={{color:'var(--text-dim)'}}>Hook Fee</span>
            <span className="mono">0.00%</span>
          </div>
        </div>

        {/* Divider stats */}
        <div style={{borderTop:'1px solid var(--border-soft)', marginTop:12, paddingTop:14}}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0'}}>
            <span style={{color:'var(--text-dim)'}}>Price Impact</span>
            <span className="mono" style={{color:'var(--green)'}}>&lt;0.01%</span>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0', alignItems:'center'}}>
            <span style={{color:'var(--text-dim)'}}>Max Slippage</span>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <button onClick={()=>setSlippage((parseFloat(slippage)-0.1).toFixed(1))}
                style={{width:22, height:22, borderRadius:5, background:'var(--bg-elev)', border:'1px solid var(--border)', color:'var(--text-dim)', cursor:'pointer', fontSize:14, lineHeight:1}}>−</button>
              <span className="mono" style={{fontSize:13, minWidth:24, textAlign:'center'}}>{slippage}</span>
              <span style={{fontSize:12, color:'var(--text-dim)'}}>%</span>
              <button onClick={()=>setSlippage((parseFloat(slippage)+0.1).toFixed(1))}
                style={{width:22, height:22, borderRadius:5, background:'var(--bg-elev)', border:'1px solid var(--border)', color:'var(--text-dim)', cursor:'pointer', fontSize:14, lineHeight:1}}>+</button>
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0'}}>
            <span style={{color:'var(--text-dim)'}}>Min. Received</span>
            <span className="mono" style={{color:'var(--text-dim)'}}>—</span>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0'}}>
            <span style={{color:'var(--text-dim)'}}>Trade Routed Through</span>
            <span className="mono" style={{color:'var(--green)'}}>{from.sym}/{to.sym} CorePool</span>
          </div>
        </div>

        <button onClick={() => amountEntered && onReview({from, to, hook})}
          disabled={!amountEntered}
          style={{width:'100%', padding:'16px', marginTop:18, fontSize:14, fontWeight:500,
            background: amountEntered ? 'var(--accent)' : 'var(--bg-elev)',
            color: amountEntered ? '#fff' : 'var(--text-dim)',
            border:'1px solid var(--border-soft)', borderRadius:12,
            cursor: amountEntered ? 'pointer' : 'not-allowed'}}>
          {amountEntered ? 'Review Swap' : 'Enter amount'}
        </button>
      </div>
    </>
  );
};

const TokenPicker = ({ sym, open, setOpen, onPick, tokens, pillStyle }) => (
  <div style={{position:'relative'}}>
    <button onClick={()=>setOpen(!open)} style={pillStyle || panelStyles.tokenPick}>
      <AssetIcon a={ASSETS.find(x=>x.sym===sym) || {sym, color:'#888'}} size={20}/>
      <span style={{fontSize:14, fontWeight:500}}>{sym}</span>
      <IconChev size={12}/>
    </button>
    {open && (
      <div style={{position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:10, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:10, padding:4, minWidth:140, boxShadow:'0 8px 24px #0008'}}>
        {tokens.map(t => (
          <button key={t} onClick={()=>onPick(t)} style={{...panelStyles.dropdownItem, display:'flex', alignItems:'center', gap:8}}>
            <AssetIcon a={ASSETS.find(x=>x.sym===t) || {sym:t, color:'#888'}} size={18}/>
            <span style={{fontSize:13}}>{t}</span>
          </button>
        ))}
      </div>
    )}
  </div>
);

// ── Analyze / Research panel ────────────────────────────────────
const AnalyzePanel = ({ close, initialQuery }) => {
  const [query, setQuery] = useS(initialQuery && initialQuery !== 'ETH' ? initialQuery : '');
  const [input, setInput] = useS('');
  const [phase, setPhase] = useS(initialQuery && initialQuery !== 'ETH' ? 'loading' : 'suggest'); // suggest, loading, results
  const [steps, setSteps] = useS([]);

  const SUGGESTIONS = [
    'What is the current price of ETH?',
    'Is EURC trading above or below its peg?',
    'Analyze USDC/USDT pool health',
    'Show me top performing RWA tokens',
    'What is cbBTC\u2019s 24h volume trend?',
    'Learn about Mantua hooks',
  ];

  useEf(() => {
    if (phase !== 'loading') return;
    setSteps([]);
    const s = [
      'Scanning on-chain activity...',
      'Fetching price history & volume...',
      'Analyzing holder distribution...',
      'Cross-referencing protocol integrations...',
      'Compiling report...'
    ];
    s.forEach((step, i) => {
      setTimeout(() => setSteps(prev => [...prev, step]), 350 * (i+1));
    });
    setTimeout(() => setPhase('results'), 350 * (s.length + 1));
  }, [phase]);

  const runQuery = (q) => {
    setQuery(q);
    setInput('');
    setPhase('loading');
  };

  const rerun = () => { setPhase('loading'); };

  // Mock chart
  const pts = useMo(() => Array.from({length: 50}, (_,i) => 50 + Math.sin(i*0.3)*15 + i*.6 + Math.cos(i*1.1)*4), []);
  const w=480, h=120, pad=8;
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const sx = i => pad + i/(pts.length-1) * (w-pad*2);
  const sy = v => pad + (1-(v-mn)/(mx-mn+.001))*(h-pad*2);
  const chartPath = pts.map((v,i)=>`${i===0?'M':'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

  // Tailor "subject" displayed in Research header and chart tile
  const subjectSym = (() => {
    const up = (query||'').toUpperCase();
    const known = ['ETH','SOL','BTC','USDC','USDT','cbBTC','EURC','CBBTC'];
    for (const k of known) if (up.includes(k.toUpperCase())) return k === 'CBBTC' ? 'cbBTC' : k;
    return 'ETH';
  })();

  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />

      <div style={{padding:'18px 20px 0'}}>
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10}}>
          <div style={{display:'flex', alignItems:'flex-start', gap:10, flex:1, minWidth:0}}>
            {phase !== 'suggest' && (
              <button onClick={()=>setPhase('suggest')} style={{...panelStyles.iconBtn, marginTop:2}} title="Back to suggestions">
                <IconBack size={16}/>
              </button>
            )}
            <div style={{minWidth:0}}>
              <div style={{fontSize:18, fontWeight:600}}>
                {phase === 'suggest' ? 'Analyze & Research' : <>Research — <span style={{color:'var(--accent)'}}>{query || subjectSym}</span></>}
              </div>
              <div style={{fontSize:13, color:'var(--text-dim)', marginTop:2}}>
                {phase === 'suggest' ? 'Pick a suggestion or type what you want to analyze.' : 'Agentic token & protocol analysis.'}
              </div>
            </div>
          </div>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
      </div>

      <div style={{padding:'14px 20px', flex:1, overflow:'auto'}}>
        {phase === 'suggest' && (
          <div style={{animation:'fadeIn .3s'}}>
            <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.08em', marginBottom:10, fontWeight:600}}>SUGGESTED QUESTIONS</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              {SUGGESTIONS.map(q => (
                <button key={q} onClick={()=>runQuery(q)} className="promptCard"
                  style={{display:'flex', alignItems:'center', padding:'14px 14px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12, cursor:'pointer', color:'var(--text)', textAlign:'left', transition:'all .15s', fontSize:13, lineHeight:1.4, fontWeight:500, minHeight:56}}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase !== 'suggest' && (
        <>
        {/* Agentic steps */}
        <div style={{background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12, padding:14}}>
          <div style={{display:'flex', alignItems:'center', gap:8, fontSize:12, color: phase==='loading'?'var(--amber)':'var(--green)'}}>
            {phase==='loading' ? (
              <><Spinner/> <span>Running research...</span></>
            ) : (
              <><IconCheck size={14} extra={<></>}/> <span>Research complete · 5 steps</span></>
            )}
          </div>
          <div style={{marginTop:10, display:'flex', flexDirection:'column', gap:6}}>
            {steps.map((s,i) => (
              <div key={i} style={{display:'flex', gap:8, fontSize:12, color:'var(--text-dim)', animation:'fadeIn .3s'}}>
                <IconCheck size={12} extra={<></>}/> {s}
              </div>
            ))}
          </div>
        </div>

        {phase==='results' && /hook/i.test(query) && (
          <div style={{animation:'fadeIn .4s'}}>
            <div style={{marginTop:14, padding:'14px 16px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12}}>
              <div style={{fontSize:15, fontWeight:600, display:'flex', alignItems:'center', gap:8}}>
                <IconSpark size={15}/> Mantua Hooks
              </div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:4, lineHeight:1.5}}>
                Pluggable contract logic that runs before/after a Uniswap v4 pool operation — Mantua ships four production hooks you can attach to any swap.
              </div>
            </div>

            <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:10}}>
              {[
                { n:'Stable Protection', c:'var(--green)', d:'Monitors peg deviation and applies directional fees — cheaper toward peg, expensive away from it — with a circuit breaker to halt liquidity drain during depegs.' },
                { n:'DynamicFee',        c:'var(--amber)', d:'Adjusts swap fees in real time based on market volatility and Chainlink price data, ensuring LPs are compensated proportionally during high-risk conditions.' },
                { n:'RWAGate',           c:'var(--accent)', d:'Enforces compliance rules on permissioned pools, allowing institutions to interact with tokenized real-world assets while maintaining on-chain composability.' },
                { n:'ALO',               c:'#7084ff',      d:'Asynchronous Limit Orders — place on-chain limit orders that execute asynchronously, enabling precise entry and exit strategies without centralized order books.' },
              ].map(h => (
                <div key={h.n} style={{padding:'14px 16px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12, borderLeft:`3px solid ${h.c}`}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                    <div style={{fontSize:14, fontWeight:600, color:h.c}}>{h.n}</div>
                    <span style={{...panelStyles.tag, fontSize:10}}>Hook</span>
                  </div>
                  <div style={{fontSize:12, color:'var(--text-dim)', marginTop:6, lineHeight:1.55}}>{h.d}</div>
                </div>
              ))}
            </div>

            <div style={{marginTop:14, padding:14, background:'linear-gradient(135deg, #b892ff18, transparent)', border:'1px solid #b892ff40', borderRadius:12}}>
              <div style={{display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:500, color:'var(--accent)'}}>
                <IconSpark size={14}/> Mantua insight
              </div>
              <div style={{fontSize:13, color:'var(--text)', marginTop:6, lineHeight:1.55}}>
                Choose a hook per pool based on intent. For stablecoins, pair <b>Stable Protection</b> with <b>DynamicFee</b>. For institutional RWAs, lead with <b>RWAGate</b>. Every hook is audited and opt-in — swaps default to "Auto" which picks the best hook for the route.
              </div>
            </div>

            <div style={{display:'flex', gap:8, marginTop:16}}>
              <button onClick={()=>setPhase('suggest')} style={{...panelStyles.ghostBtn, flex:1, padding:10, justifyContent:'center'}}>Ask another</button>
              <button style={{...panelStyles.primaryBtn, flex:1, padding:10, fontSize:13}}>Open hooks docs</button>
            </div>
          </div>
        )}

        {phase==='results' && !/hook/i.test(query) && (
          <div style={{animation:'fadeIn .4s'}}>
            {/* Price card */}
            <div style={{...panelStyles.swapBox, marginTop:14}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                <div>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <AssetIcon a={ASSETS.find(x=>x.sym===subjectSym) || ASSETS[0]} size={24}/>
                    <span style={{fontSize:15, fontWeight:500}}>{subjectSym === 'ETH' ? 'Ethereum' : subjectSym}</span>
                    <span style={{...panelStyles.tag, fontSize:10}}>LAYER 1</span>
                  </div>
                  <div style={{fontSize:28, fontWeight:600, marginTop:6, letterSpacing:'-.02em'}} className="mono">$3,630.12</div>
                  <div style={{fontSize:12, color:'var(--red)', marginTop:2}}>↘ 0.75% · 24h</div>
                </div>
                <div style={{display:'flex', gap:6}}>
                  <button style={panelStyles.ghostBtn}><IconExternal size={12}/> Explorer</button>
                  <button style={{...panelStyles.primaryBtn, padding:'6px 10px', fontSize:12}}>Swap</button>
                </div>
              </div>
              <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{marginTop:10}}>
                <defs>
                  <linearGradient id="anFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="var(--amber)" stopOpacity=".25"/>
                    <stop offset="1" stopColor="var(--amber)" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <path d={chartPath+` L${sx(pts.length-1)},${h-pad} L${sx(0)},${h-pad} Z`} fill="url(#anFill)"/>
                <path d={chartPath} fill="none" stroke="var(--amber)" strokeWidth="1.5"/>
              </svg>
            </div>

            {/* Sentiment & stats */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12}}>
              {[
                {l:'Market cap', v:'$437.2B'},
                {l:'24h volume', v:'$18.6B'},
                {l:'Total supply', v:'120.4M'},
                {l:'Sentiment', v:'Bullish', g:true},
              ].map(s => (
                <div key={s.l} style={panelStyles.statBox}>
                  <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.06em'}}>{s.l}</div>
                  <div style={{fontSize:16, fontWeight:500, marginTop:4, color: s.g?'var(--green)':'var(--text)'}} className="mono">{s.v}</div>
                </div>
              ))}
            </div>

            {/* Mantua insight */}
            <div style={{marginTop:14, padding:14, background:'linear-gradient(135deg, #b892ff18, transparent)', border:'1px solid #b892ff40', borderRadius:12}}>
              <div style={{display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:500, color:'var(--accent)'}}>
                <IconSpark size={14}/> Mantua insight
              </div>
              <div style={{fontSize:13, color:'var(--text)', marginTop:6, lineHeight:1.55}}>
                {subjectSym} trades at a <b>12% discount</b> to its 30-day realized vol range. On-chain flows show <b>net accumulation</b> from top 100 wallets (+$84M, 7d). Dencun gas fees at 14-month lows — good window for L2 bridge operations.
              </div>
              <div style={{display:'flex', gap:6, marginTop:10}}>
                <button style={{...panelStyles.ghostBtn, fontSize:11}}>Show similar tokens</button>
                <button style={{...panelStyles.ghostBtn, fontSize:11}}>View top pools</button>
                <button style={{...panelStyles.ghostBtn, fontSize:11}}>Set alert</button>
              </div>
            </div>

            {/* Holders / risk */}
            <div style={{marginTop:14}}>
              <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.06em', marginBottom:8}}>RISK BREAKDOWN</div>
              {[
                {l:'Liquidity depth', v: 92, c:'var(--green)'},
                {l:'Contract audit',  v: 100, c:'var(--green)'},
                {l:'Holder concentration', v: 62, c:'var(--amber)'},
                {l:'Volatility (30d)', v: 48, c:'var(--amber)'},
              ].map(r => (
                <div key={r.l} style={{marginBottom:10}}>
                  <div style={{display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4}}>
                    <span style={{color:'var(--text-dim)'}}>{r.l}</span>
                    <span className="mono" style={{color: r.c}}>{r.v}/100</span>
                  </div>
                  <div style={{height:4, background:'var(--chip)', borderRadius:99, overflow:'hidden'}}>
                    <div style={{height:'100%', width:`${r.v}%`, background: r.c, borderRadius:99}}/>
                  </div>
                </div>
              ))}
            </div>

            <div style={{display:'flex', gap:8, marginTop:16}}>
              <button onClick={()=>setPhase('suggest')} style={{...panelStyles.ghostBtn, flex:1, padding:10, justifyContent:'center'}}>Ask another</button>
              <button onClick={rerun} style={{...panelStyles.ghostBtn, flex:1, padding:10, justifyContent:'center'}}>Re-run</button>
              <button style={{...panelStyles.primaryBtn, flex:1, padding:10, fontSize:13}}>Open position</button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </>
  );
};

const Spinner = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" style={{animation:'spin .8s linear infinite'}}>
    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" opacity=".3"/>
    <path d="M12 7a5 5 0 0 0-5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
  </svg>
);

Object.assign(window, { SwapPanel, TokenPicker, AnalyzePanel, Spinner });
