// App root: state machine, routing, chat input bar
const { useState: useSt, useEffect: useEff, useRef: useRef1 } = React;

function App() {
  // Persisted
  const [theme, setTheme] = useSt(() => localStorage.getItem('mantua.theme') || 'dark');
  const [density, setDensity] = useSt(() => localStorage.getItem('mantua.density') || 'comfortable');

  // Runtime
  const [route, setRoute] = useSt('home'); // home, pool-list, add-liquidity, swap, analyze, agent, settings, position, chat
  const [wallet, setWallet] = useSt({connected:false, address:''});
  const [showWalletConnect, setShowWalletConnect] = useSt(false);
  const [tx, setTx] = useSt(null);
  const [activePool, setActivePool] = useSt(null);
  const [activeAsset, setActiveAsset] = useSt(null);
  const [chatMessages, setChatMessages] = useSt([]);
  const [input, setInput] = useSt('');
  const [typing, setTyping] = useSt(false);
  const [network, setNetwork] = useSt('Base');
  const [showNetworks, setShowNetworks] = useSt(false);

  // Expose "New chat" globally so all panels can call it
  useEff(() => {
    window.__mantuaNewChat = () => { setChatMessages([]); setRoute('home'); setInput(''); };
    return () => { delete window.__mantuaNewChat; };
  }, []);

  // Autopilot demo — triggered via URL hash (#demo=agent-wallet or legacy #demo=add-lp)
  useEff(() => {
    const hash = (window.location.hash || '').toLowerCase();
    if (!/demo=/.test(hash)) return;
    // Force wallet connected for the demo
    setWallet({connected:true, address:'0x8f4a...c219', provider:'Demo'});

    let cancelled = false;
    const timeouts = [];
    const schedule = (fn, ms) => timeouts.push(setTimeout(() => { if(!cancelled) fn(); }, ms));

    const runAgent = () => {
      setRoute('home');
      // Open agent (mode picker)
      schedule(() => {
        window.__mantuaAgentInitialStep = 'mode';
        setRoute('agent');
      }, 1200);
      // Jump to autonomous mode (simulate user picking it)
      schedule(() => {
        window.__mantuaAgentInitialStep = 'auto';
        setRoute('home');
      }, 3200);
      schedule(() => setRoute('agent'), 3350); // re-mount with auto step
      // Fire the wallet-create prompt
      schedule(() => {
        if (window.__mantuaAutoSend) window.__mantuaAutoSend('Create an agent wallet on Base with $500 per-tx cap');
      }, 4600);
      // Loop
      schedule(() => { window.__mantuaAgentInitialStep = 'mode'; setRoute('home'); runAgent(); }, 16000);
    };
    schedule(runAgent, 500);

    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, []);
  const [toast, setToast] = useSt(null);

  // Apply theme & density to document
  useEff(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.setProperty('--density', density === 'compact' ? '0.8' : '1');
    localStorage.setItem('mantua.theme', theme);
    localStorage.setItem('mantua.density', density);
    window.__TWEAKS__.theme = theme;
    window.__TWEAKS__.density = density;
    try { window.parent.postMessage({type:'__edit_mode_set_keys', edits:{theme, density}}, '*'); } catch(e){}
  }, [theme, density]);

  // Tweaks protocol — listener FIRST, then announce
  useEff(() => {
    const handler = (e) => {
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') setTweaksOpen(true);
      else if (d.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    try { window.parent.postMessage({type:'__edit_mode_available'}, '*'); } catch(e){}
    return () => window.removeEventListener('message', handler);
  }, []);

  const [tweaksOpen, setTweaksOpen] = useSt(false);

  // Connect wallet
  const doConnect = (w) => {
    setWallet({connected:true, address:'0x8f4a...c219', provider: w.name});
    setShowWalletConnect(false);
    showToast(`${w.name} connected`);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Chat/submit handler — routes commands or starts a conversation
  const submit = (text) => {
    const t = (text || input).trim();
    if (!t) return;
    setInput('');
    const lower = t.toLowerCase();
    // quick-command routing
    if (/swap|exchange|trade/.test(lower)) return setRoute('swap');
    if (/pool|liquidity|lp/.test(lower)) return setRoute('pool-list');
    if (/agent|bot|autonomous/.test(lower)) return setRoute('agent');
    if (/setting|preference/.test(lower)) return setRoute('settings');
    if (/analy[sz]e|research|tell me about|what is/.test(lower)) return setRoute('analyze');

    // Otherwise start chat conversation
    const userMsg = { role:'user', text: t, id: Date.now() };
    setChatMessages(msgs => [...msgs, userMsg]);
    setRoute('chat');
    setTyping(true);
    // fake agentic response
    setTimeout(() => {
      setChatMessages(msgs => [...msgs, {
        role:'agent', id: Date.now()+1, steps: [
          'Parsing request...',
          'Checking market conditions...',
          'Drafting response...'
        ],
        text: `Here's what I found about "${t}". I can also open a swap or research panel — just say the word.`
      }]);
      setTyping(false);
    }, 1800);
  };

  // Prompt input bar (fixed at bottom of right panel)
  const InputBar = () => (
    <div style={{padding:'14px 20px 16px', borderTop:'1px solid var(--border-soft)'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'var(--bg-elev)', borderRadius:12, border:'1px solid var(--border-soft)'}}>
        <input value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter') submit(); }}
          placeholder="Ask Mantua anything or type a trade command..."
          style={{flex:1, background:'transparent', border:'none', outline:'none', fontSize:13, color:'var(--text)'}}/>
        <button onClick={()=>submit()} style={{background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', display:'flex', padding:4}}>
          <IconSend size={16}/>
        </button>
      </div>
      <div style={{marginTop:8, display:'flex', gap:8, alignItems:'center', justifyContent:'flex-start'}}>
        <div style={{position:'relative'}}>
          <button onClick={()=>setShowNetworks(!showNetworks)} style={{...panelStyles.chip, padding:'5px 10px', fontSize:12}}>
            <span style={{width:8, height:8, borderRadius:99, background:'#0052ff'}}/> {network} <IconChev size={12}/>
          </button>
          {showNetworks && (
            <div style={{position:'absolute', bottom:'calc(100% + 4px)', left:0, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:10, padding:4, minWidth:120, zIndex:10, boxShadow:'0 8px 24px #0008'}}>
              {['Base'].map(n => (
                <button key={n} onClick={()=>{setNetwork(n); setShowNetworks(false);}} style={panelStyles.dropdownItem}>
                  <span style={{fontSize:13}}>{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{flex:1}}/>
        <button onClick={()=>setRoute('settings')} style={{...panelStyles.ghostBtn, padding:'5px 10px', fontSize:11}}>
          <IconSettings size={11}/>
        </button>
      </div>
    </div>
  );

  // Chat thread view
  const ChatView = () => {
    const endRef = useRef1();
    useEff(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [chatMessages, typing]);

    return (
      <>
        <PanelHeader title="Ask Mantua" right={
          <div style={{display:'flex', gap:8}}>
            <button onClick={()=>{ setChatMessages([]); setRoute('home'); }} style={panelStyles.ghostBtn}><IconPlus size={14}/> New chat</button>
            <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
          </div>
        } />
        <div ref={endRef} style={{flex:1, overflow:'auto', padding:'20px'}}>
          {chatMessages.map(m => m.role === 'user' ? (
            <div key={m.id} style={{display:'flex', justifyContent:'flex-end', marginBottom:14}}>
              <div style={{maxWidth:'80%', padding:'10px 14px', background:'var(--accent)', color:'#fff', borderRadius:'14px 14px 2px 14px', fontSize:13, lineHeight:1.5}}>
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} style={{display:'flex', gap:10, marginBottom:14}}>
              <div style={panelStyles.avatarSm}><LogoMark size={22}/></div>
              <div style={{flex:1, maxWidth:'82%'}}>
                <AgentStepList steps={m.steps}/>
                <div style={{padding:'10px 14px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:'14px 14px 14px 2px', fontSize:13, lineHeight:1.55, marginTop:8}}>
                  {m.text}
                </div>
                <div style={{display:'flex', gap:6, marginTop:8}}>
                  <button onClick={()=>setRoute('analyze')} style={{...panelStyles.ghostBtn, fontSize:11, padding:'5px 10px'}}>Open research</button>
                  <button onClick={()=>setRoute('swap')} style={{...panelStyles.ghostBtn, fontSize:11, padding:'5px 10px'}}>Start swap</button>
                </div>
              </div>
            </div>
          ))}
          {typing && (
            <div style={{display:'flex', gap:10, marginBottom:14}}>
              <div style={panelStyles.avatarSm}><LogoMark size={22}/></div>
              <div style={{padding:'10px 14px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:'14px 14px 14px 2px', fontSize:13, color:'var(--text-dim)', display:'flex', gap:6, alignItems:'center'}}>
                <Spinner/> <span>Thinking...</span>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  const AgentStepList = ({ steps }) => {
    const [visible, setVisible] = useSt(0);
    useEff(() => {
      if (!steps) return;
      let i = 0;
      const tick = () => {
        i++; setVisible(i);
        if (i < steps.length) setTimeout(tick, 400);
      };
      setTimeout(tick, 200);
    }, []);
    if (!steps) return null;
    return (
      <div style={{padding:'8px 12px', background:'transparent', border:'1px dashed var(--border-soft)', borderRadius:10, fontSize:11, color:'var(--text-dim)'}}>
        {steps.slice(0, visible).map((s,i) => (
          <div key={i} style={{display:'flex', alignItems:'center', gap:6, padding:'2px 0', animation:'fadeIn .25s'}}>
            <IconCheck size={10} extra={<></>}/> {s}
          </div>
        ))}
      </div>
    );
  };

  // Which right-panel view
  const renderRightPanel = () => {
    switch(route) {
      case 'home': return <HomeMenu go={setRoute} onNewChat={()=>setChatMessages([])} onHistory={()=>{}}/>;
      case 'pool-list': return <PoolListPanel back={()=>setRoute('home')} close={()=>setRoute('home')}
        onSelectPool={(p)=>{setActivePool(p); setRoute('add-liquidity');}}
        onCreate={()=>{setActivePool({a:'Token A', b:'Token B', hook:'No Hook', tvl:'—', apr:'—'}); setRoute('add-liquidity');}}/>;
      case 'add-liquidity': return <AddLiquidityPanel pool={activePool}
        back={()=>setRoute('pool-list')} close={()=>setRoute('home')}
        onSubmit={(data)=>setTx({title:'Add liquidity', from:{sym:data.pool.a, amount:data.tokenA}, to:{sym:data.pool.b, amount:data.tokenB}, hook:data.hook})}/>;
      case 'swap': return <SwapPanel close={()=>setRoute('home')}
        onReview={(data)=>setTx({title:'Swap', ...data})}/>;
      case 'analyze': return <AnalyzePanel close={()=>setRoute('home')}/>;
      case 'agent': return <AgentPanel close={()=>setRoute('home')} onDeploy={(a)=>{showToast(`${a.name} deployed`); setRoute('home');}}/>;
      case 'settings': return <SettingsPanel close={()=>setRoute('home')}
        theme={theme} onThemeChange={setTheme}
        density={density} onDensityChange={setDensity}/>;
      case 'position': return <PositionDetailPanel asset={activeAsset} back={()=>setRoute('home')} close={()=>setRoute('home')}/>;
      case 'chat': return <ChatView/>;
      default: return <HomeMenu go={setRoute} onNewChat={()=>{}} onHistory={()=>{}}/>;
    }
  };

  return (
    <div style={{minHeight:'100vh', display:'flex', flexDirection:'column'}}>
      <Header theme={theme}
        onToggleTheme={()=>setTheme(theme==='dark'?'light':'dark')}
        walletState={wallet}
        onConnectWallet={()=>setShowWalletConnect(true)}/>

      <div style={{
        display:'grid', gridTemplateColumns:'minmax(340px, 1fr) minmax(460px, 1.3fr)',
        gap: 'calc(20px * var(--density))',
        padding: 'calc(20px * var(--density)) calc(32px * var(--density))',
        flex:1, alignItems:'stretch', minHeight:0
      }}>
        {/* Left column */}
        <div style={{display:'flex', flexDirection:'column', gap:'calc(20px * var(--density))', minHeight:0}}>
          <PortfolioCard openDetail={()=>{}}/>
          <div style={{flex:1, minHeight:0, display:'flex'}}>
            <div style={{flex:1, display:'flex', flexDirection:'column', minHeight:0}}>
              <AssetsCard onAssetClick={(a)=>{ setActiveAsset(a); setRoute('position'); }}/>
            </div>
          </div>
        </div>

        {/* Right column — chat panel, aligned to full left column height */}
        <div style={{...shellStyles.card, padding:0, display:'flex', flexDirection:'column', minHeight:0, alignSelf:'stretch'}}>
          <div style={{flex:1, display:'flex', flexDirection:'column', minHeight:0, overflow:'hidden'}}>
            {renderRightPanel()}
          </div>
          <InputBar/>
        </div>
      </div>

      {/* Modals */}
      {showWalletConnect && <WalletConnect onConnect={doConnect} onClose={()=>setShowWalletConnect(false)}/>}
      {tx && <TxSignModal tx={tx} onClose={()=>setTx(null)} onSigned={()=>{ setTx(null); showToast('Transaction submitted'); setRoute('home'); }}/>}

      {/* Toast */}
      {toast && (
        <div style={{position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:12, padding:'10px 16px', fontSize:13, boxShadow:'0 8px 24px #0008', display:'flex', alignItems:'center', gap:8, zIndex:200, animation:'popIn .22s'}}>
          <IconCheck size={14} extra={<></>} /> {toast}
        </div>
      )}

      {/* Tweaks panel */}
      {tweaksOpen && (
        <div style={{position:'fixed', bottom:24, right:24, zIndex:150, background:'var(--panel-solid)', border:'1px solid var(--border)', borderRadius:14, padding:16, boxShadow:'0 12px 40px #000a', width: 260}}>
          <div style={{fontSize:13, fontWeight:600, marginBottom:12}}>Tweaks</div>
          <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.08em', marginBottom:6}}>THEME</div>
          <div style={{display:'flex', gap:4, background:'var(--bg-elev)', padding:3, borderRadius:10, border:'1px solid var(--border-soft)', marginBottom:12}}>
            {['dark','light'].map(t => (
              <button key={t} onClick={()=>setTheme(t)} style={{flex:1, padding:'7px 0', borderRadius:7, border:'none', background: theme===t?'var(--chip)':'transparent', color: theme===t?'var(--text)':'var(--text-dim)', cursor:'pointer', fontSize:12, textTransform:'capitalize', fontWeight:500}}>
                {t}
              </button>
            ))}
          </div>
          <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.08em', marginBottom:6}}>DENSITY</div>
          <div style={{display:'flex', gap:4, background:'var(--bg-elev)', padding:3, borderRadius:10, border:'1px solid var(--border-soft)'}}>
            {['comfortable','compact'].map(d => (
              <button key={d} onClick={()=>setDensity(d)} style={{flex:1, padding:'7px 0', borderRadius:7, border:'none', background: density===d?'var(--chip)':'transparent', color: density===d?'var(--text)':'var(--text-dim)', cursor:'pointer', fontSize:11, textTransform:'capitalize', fontWeight:500}}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Global CSS animations injected
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes popIn { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
  .promptCard:hover { border-color: var(--accent) !important; background: var(--row-hover) !important; }
  .poolRow:hover { background: var(--row-hover); }
  .assetRow:hover { background: var(--row-hover); }
  .portfolioCard:hover { border-color: var(--border); }
  button:hover { opacity: .92; }
`;
document.head.appendChild(styleEl);

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
