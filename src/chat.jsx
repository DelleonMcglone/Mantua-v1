// Agent builder, transaction sign, onboarding, wallet connect, settings, position detail, chat thread
const { useState: uSt, useEffect: uEf, useMemo: uMe, useRef: uRf } = React;

// ── Agent builder ───────────────────────────────────────────────
const AgentPanel = ({ close, onDeploy }) => {
  // Autopilot-friendly initial step: allow outside code to preset step via window flag
  const initialStep = (typeof window !== 'undefined' && window.__mantuaAgentInitialStep) || 'mode';
  const [step, setStep] = uSt(initialStep); // 'mode' | 'chat' | 'auto'
  const [name, setName] = uSt('Yield Hunter');
  const [prompt, setPrompt] = uSt('Watch top 20 ETH/stablecoin pools. Suggest rebalances when IL > 1.5% or APR drops below 4%.');
  const [triggers, setTriggers] = uSt({price:true, apr:true, tvl:false, gas:false});
  const [maxSize, setMaxSize] = uSt('500');
  const [networks, setNetworks] = uSt({base:true, arb:true, eth:false});

  // Chat-mode action cards (matches attached screenshot)
  const chatActions = [
    { k:'wallet',   t:'Create & Manage Wallet', d:'Create agent wallet via CDP',       e:'🔑' },
    { k:'send',     t:'Send Tokens',            d:'Transfer tokens to any address',    e:'📩' },
    { k:'swap',     t:'Swap Tokens',            d:'Exchange between tokens in agent wallet', e:'🔄' },
    { k:'liq',      t:'Liquidity',              d:'Add/remove liquidity from a pool',  e:'💧' },
    { k:'query',    t:'Query On-Chain Data',    d:'Fetch any crypto data',             e:'🔍' },
    { k:'fund',     t:'Fund Agent Wallet',      d:'Get tokens',    e:'🚰' },
  ];

  // ── Mode picker screen ────────────────────────────────
  if (step === 'mode') {
    return (
      <>
        <PanelHeader title="Ask Mantua" right={
          <div style={{display:'flex', gap:8}}>
            <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
            <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
          </div>
        } />
        <div style={{padding:'18px 20px 0', display:'flex', justifyContent:'flex-end'}}>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
        <div style={{padding:'20px 28px 28px', flex:1, overflow:'auto', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start'}}>
          <div style={{fontSize:40, lineHeight:1, marginTop:18}}>🤖</div>
          <div style={{fontSize:22, fontWeight:700, marginTop:16, letterSpacing:'-.01em'}}>Choose Agent Mode</div>
          <div style={{fontSize:13, color:'var(--text-dim)', marginTop:6}}>How would you like to interact with the agent?</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:28, width:'100%', maxWidth:480}}>
            <button onClick={()=>setStep('chat')} className="promptCard"
              style={{textAlign:'left', padding:'18px 16px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:14, cursor:'pointer', color:'var(--text)', transition:'all .15s', minHeight:140}}>
              <div style={{fontSize:26}}>💬</div>
              <div style={{fontSize:15, fontWeight:700, marginTop:20}}>Chat Mode</div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:6, lineHeight:1.4}}>Interactive action cards with guided steps</div>
            </button>
            <button onClick={()=>setStep('auto')} className="promptCard"
              style={{textAlign:'left', padding:'18px 16px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:14, cursor:'pointer', color:'var(--text)', transition:'all .15s', minHeight:140}}>
              <div style={{fontSize:26}}>🤖</div>
              <div style={{fontSize:15, fontWeight:700, marginTop:20}}>Autonomous Mode</div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:6, lineHeight:1.4}}>Give the agent an instruction &amp; it executes autonomously</div>
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Chat mode action grid ──────────────────────────────
  if (step === 'chat') {
    return (
      <>
        <PanelHeader title="Ask Mantua" right={
          <div style={{display:'flex', gap:8}}>
            <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
            <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
          </div>
        } />
        <div style={{padding:'18px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <button onClick={()=>setStep('mode')} style={{...panelStyles.ghostBtn}}>
            <IconBack size={14}/> Back
          </button>
          <div style={{display:'flex', alignItems:'center', gap:8, fontSize:15, fontWeight:600}}>
            <span style={{fontSize:16}}>💬</span> Chat Mode
          </div>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
        <div style={{padding:'20px', flex:1, overflow:'auto'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
            {chatActions.map(a => (
              <button key={a.k} onClick={()=>window.__mantuaChatAction && window.__mantuaChatAction(a)} className="promptCard"
                style={{textAlign:'left', padding:'14px 14px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12, cursor:'pointer', color:'var(--text)', transition:'all .15s', minHeight:120, display:'flex', flexDirection:'column'}}>
                <div style={{fontSize:22}}>{a.e}</div>
                <div style={{fontSize:13, fontWeight:700, marginTop:12, lineHeight:1.3}}>{a.t}</div>
                <div style={{fontSize:11, color:'var(--text-dim)', marginTop:4, lineHeight:1.4}}>{a.d}</div>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  // ── Autonomous mode — conversational ──────────────────
  return <AutonomousChat close={close} onBack={()=>setStep('mode')}/>;
};

// ── Autonomous conversational agent ────────────────────────────
const AutonomousChat = ({ close, onBack }) => {
  const [messages, setMessages] = uSt([]);       // {role:'user'|'agent', text, steps?, done?}
  const [input, setInput] = uSt('');
  const [busy, setBusy] = uSt(false);
  const scrollRef = uRf(null);

  uEf(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Autopilot hook — let outside code trigger sends
  uEf(() => {
    window.__mantuaAutoSend = (txt) => send(txt);
    return () => { delete window.__mantuaAutoSend; };
  }, [busy]);

  const EXAMPLES = [
    'Swap 0.1 ETH to USDC on Base',
    'Move my idle USDC into the highest-APR stable pool',
    'Monitor cbBTC price and alert if it drops below $60k',
    'Rebalance my portfolio to 60% ETH / 40% USDC',
  ];

  const send = (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);

    const userMsg = { role:'user', text, id: Date.now() };
    const agentId = Date.now()+1;
    setMessages(m => [...m, userMsg, { role:'agent', id: agentId, steps: [], done:false }]);

    const isWalletCreate = /create.*(agent)?\s*wallet|new\s*wallet|spin\s*up.*wallet/i.test(text);
    const stepScript = isWalletCreate ? [
      'Parsing instruction...',
      'Requesting CDP server-signed wallet...',
      'Generating keypair in secure enclave...',
      'Setting per-tx spending caps & allow-list...',
      'Registering agent wallet on Base...',
    ] : [
      'Parsing instruction...',
      'Loading agent wallet (0x7a3…bE19)...',
      'Scanning on-chain state & gas conditions...',
      'Simulating transaction path...',
      'Submitting transaction to Base...',
    ];
    stepScript.forEach((s, i) => {
      setTimeout(() => {
        setMessages(m => m.map(x => x.id === agentId ? {...x, steps: [...x.steps, s]} : x));
      }, 550 * (i+1));
    });
    setTimeout(() => {
      setMessages(m => m.map(x => x.id === agentId ? {
        ...x,
        done: true,
        result: isWalletCreate ? {
          tx: '0xagent…wallet',
          summary: 'Agent wallet created · 0x7a3f…bE19',
          detail: 'CDP-signed · Base · caps $500/tx, $2k/day',
        } : {
          tx: '0x4f2a…c19b',
          summary: `Executed: ${text.slice(0,80)}`,
          detail: 'Tx confirmed · gas $0.04 · 2.1s',
        }
      } : x));
      setBusy(false);
    }, 550 * (stepScript.length + 1));
  };

  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>setMessages([])}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />

      <div style={{padding:'18px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <button onClick={onBack} style={{...panelStyles.ghostBtn}}>
          <IconBack size={14}/> Back
        </button>
        <div style={{display:'flex', alignItems:'center', gap:8, fontSize:15, fontWeight:600}}>
          <span style={{fontSize:16}}>🤖</span> Autonomous Mode
        </div>
        <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
      </div>

      <div ref={scrollRef} style={{padding:'16px 20px', flex:1, overflow:'auto', display:'flex', flexDirection:'column', gap:12}}>
        {messages.length === 0 && (
          <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'20px 16px', gap:10}}>
            <div style={{fontSize:44, lineHeight:1}}>🤖</div>
            <div style={{fontSize:17, fontWeight:600, marginTop:8}}>Your autonomous agent is ready</div>
            <div style={{fontSize:13, color:'var(--text-dim)', maxWidth:360, lineHeight:1.5}}>
              Powered by AgentKit · Type any instruction below <span style={{color:'var(--accent)'}}>↓</span>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:8, marginTop:14, width:'100%', maxWidth:420}}>
              {EXAMPLES.map(e => (
                <button key={e} onClick={()=>send(e)} className="promptCard"
                  style={{textAlign:'left', padding:'10px 14px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:10, cursor:'pointer', color:'var(--text-dim)', fontSize:13, transition:'all .15s'}}>
                  <span style={{color:'var(--accent)', marginRight:8}}>›</span>{e}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => m.role === 'user' ? (
          <div key={m.id} style={{alignSelf:'flex-end', maxWidth:'78%', padding:'10px 14px', background:'var(--accent)', color:'#fff', borderRadius:'14px 14px 4px 14px', fontSize:13, lineHeight:1.5}}>
            {m.text}
          </div>
        ) : (
          <div key={m.id} style={{alignSelf:'flex-start', maxWidth:'92%', width:'100%'}}>
            <div style={{display:'flex', gap:10, alignItems:'flex-start'}}>
              <div style={{width:28, height:28, borderRadius:8, background:'var(--chip)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0}}>🤖</div>
              <div style={{flex:1, background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:'4px 14px 14px 14px', padding:'12px 14px'}}>
                <div style={{fontSize:11, color: m.done?'var(--green)':'var(--amber)', display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
                  {m.done ? <><IconCheck size={12} extra={<></>}/> Completed</> : <><Spinner/> Working...</>}
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:4}}>
                  {m.steps.map((s,i) => (
                    <div key={i} style={{display:'flex', gap:8, fontSize:12, color:'var(--text-dim)', animation:'fadeIn .3s'}}>
                      <IconCheck size={11} extra={<></>}/> {s}
                    </div>
                  ))}
                </div>
                {m.done && m.result && (
                  <div style={{marginTop:10, padding:10, background:'var(--chip)', borderRadius:8, animation:'fadeIn .4s'}}>
                    <div style={{fontSize:12, fontWeight:500, color:'var(--text)'}}>{m.result.summary}</div>
                    <div style={{display:'flex', alignItems:'center', gap:8, marginTop:6, fontSize:11, color:'var(--text-dim)'}}>
                      <span className="mono" style={{color:'var(--accent)'}}>{m.result.tx}</span>
                      <span>·</span>
                      <span>{m.result.detail}</span>
                      <button style={{...panelStyles.ghostBtn, fontSize:10, padding:'3px 8px', marginLeft:'auto'}}>
                        <IconExternal size={11}/> Explorer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

    </>
  );
};

// ── Wallet connect ──────────────────────────────────────────────
const WalletConnect = ({ onConnect, onClose }) => {
  const [connecting, setConnecting] = uSt(null);
  const wallets = [
    {id:'metamask',  name:'MetaMask',      c:'#f6851b'},
    {id:'coinbase',  name:'Coinbase Wallet', c:'#0052ff'},
    {id:'walletc',   name:'WalletConnect', c:'#3b99fc'},
    {id:'phantom',   name:'Phantom',       c:'#ab9ff2'},
    {id:'rabby',     name:'Rabby',         c:'#7084ff'},
  ];

  const pick = (w) => {
    setConnecting(w.id);
    setTimeout(() => { onConnect(w); }, 1400);
  };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{...modalStyles.modal, maxWidth: 400}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'22px 24px 0', display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:18, fontWeight:600}}>Connect wallet</div>
            <div style={{fontSize:13, color:'var(--text-dim)', marginTop:2}}>Choose how to sign in to Mantua.</div>
          </div>
          <button onClick={onClose} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
        <div style={{padding:'16px 24px 24px', display:'flex', flexDirection:'column', gap:8}}>
          {wallets.map(w => (
            <button key={w.id} onClick={()=>pick(w)} disabled={!!connecting} style={{
              display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
              background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12,
              color:'var(--text)', cursor: connecting?'wait':'pointer', textAlign:'left'
            }}>
              <div style={{width:32, height:32, borderRadius:8, background: w.c+'22', border:`1px solid ${w.c}55`, display:'flex', alignItems:'center', justifyContent:'center', color:w.c, fontWeight:700, fontSize:14}}>
                {w.name[0]}
              </div>
              <div style={{flex:1, fontSize:14, fontWeight:500}}>{w.name}</div>
              {connecting===w.id ? <Spinner/> : <IconArrowRight size={16}/>}
            </button>
          ))}
          <div style={{fontSize:11, color:'var(--text-mute)', textAlign:'center', marginTop:8}}>
            By connecting, you agree to Mantua's <span style={{color:'var(--accent)', cursor:'pointer'}}>Terms</span> & <span style={{color:'var(--accent)', cursor:'pointer'}}>Privacy</span>.
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Transaction sign modal ──────────────────────────────────────
const TxSignModal = ({ tx, onClose, onSigned }) => {
  const [phase, setPhase] = uSt('review'); // review, signing, success
  const sign = () => {
    setPhase('signing');
    setTimeout(() => setPhase('success'), 1600);
  };
  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'22px 24px 0', display:'flex', justifyContent:'space-between'}}>
          <div style={{fontSize:18, fontWeight:600}}>
            {phase==='review' && 'Review transaction'}
            {phase==='signing' && 'Waiting for signature...'}
            {phase==='success' && 'Transaction submitted'}
          </div>
          <button onClick={onClose} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>

        {phase==='review' && (
          <div style={{padding:'16px 24px 24px'}}>
            <div style={{padding:14, background:'var(--bg-elev)', borderRadius:12, border:'1px solid var(--border-soft)'}}>
              <div style={{fontSize:12, color:'var(--text-dim)'}}>{tx.title || 'Swap'}</div>
              <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10}}>
                <AssetIcon a={ASSETS.find(x=>x.sym===(tx.from?.sym || 'ETH'))} size={24}/>
                <div style={{fontSize:18, fontWeight:500}} className="mono">{tx.from?.amount || '1.0'} {tx.from?.sym || 'ETH'}</div>
                <IconArrowRight size={14}/>
                <AssetIcon a={ASSETS.find(x=>x.sym===(tx.to?.sym || 'USDC'))} size={24}/>
                <div style={{fontSize:18, fontWeight:500}} className="mono">{tx.to?.amount || '3,630.12'} {tx.to?.sym || 'USDC'}</div>
              </div>
            </div>
            <div style={{marginTop:12, fontSize:13}}>
              {[
                ['Via', tx.hook?.name || 'Uniswap v4'],
                ['Min received', '3,612.97 USDC'],
                ['Price impact', <span style={{color:'var(--green)'}}>0.02%</span>],
                ['Network fee', '$2.14'],
                ['Slippage', '0.5%'],
              ].map(([l,v],i) => (
                <div key={i} style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom: i<4?'1px dashed var(--border-soft)':'none'}}>
                  <span style={{color:'var(--text-dim)'}}>{l}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:14, padding:10, background:'#f5a52418', border:'1px solid #f5a52440', borderRadius:10, fontSize:12, color:'var(--text)', display:'flex', gap:8, alignItems:'flex-start'}}>
              <IconAlert size={14} extra={<></>}/>
              <span>Mantua simulated this call and returned <b>success</b>. Check details on your wallet before confirming.</span>
            </div>
            <div style={{display:'flex', gap:8, marginTop:16}}>
              <button onClick={onClose} style={{...panelStyles.ghostBtn, flex:1, padding:12, justifyContent:'center'}}>Cancel</button>
              <button onClick={sign} style={{...panelStyles.primaryBtn, flex:2, padding:12, fontSize:14}}>Sign & submit</button>
            </div>
          </div>
        )}

        {phase==='signing' && (
          <div style={{padding:'40px 24px', textAlign:'center'}}>
            <div style={{width:64, height:64, borderRadius:16, background:'var(--bg-elev)', border:'1px solid var(--border-soft)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto', color:'var(--accent)'}}>
              <Spinner/>
            </div>
            <div style={{marginTop:14, fontSize:15, fontWeight:500}}>Confirm in your wallet</div>
            <div style={{marginTop:4, fontSize:13, color:'var(--text-dim)'}}>Open your wallet to approve the transaction.</div>
          </div>
        )}

        {phase==='success' && (
          <div style={{padding:'32px 24px 24px', textAlign:'center'}}>
            <div style={{width:64, height:64, borderRadius:16, background:'#3ddc9722', border:'1px solid #3ddc9755', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto', color:'var(--green)'}}>
              <IconCheck size={28} extra={<></>}/>
            </div>
            <div style={{marginTop:14, fontSize:16, fontWeight:600}}>Transaction submitted</div>
            <div style={{marginTop:6, fontSize:13, color:'var(--text-dim)'}}>Expected confirmation in ~12 seconds.</div>
            <div style={{marginTop:16, padding:'10px 14px', background:'var(--bg-elev)', borderRadius:10, display:'flex', alignItems:'center', gap:8, fontSize:12}}>
              <span className="mono" style={{flex:1, textAlign:'left', color:'var(--text-dim)'}}>0x8f4a...c219</span>
              <button style={{background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer'}}><IconCopy size={12}/></button>
              <button style={{background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer'}}><IconExternal size={12}/></button>
            </div>
            <button onClick={onSigned} style={{...panelStyles.primaryBtn, width:'100%', padding:12, marginTop:16, fontSize:14}}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Settings panel ──────────────────────────────────────────────
const SettingsPanel = ({ close, theme, onThemeChange, density, onDensityChange }) => {
  const [slippage, setSlippage] = uSt('0.5');
  const [notif, setNotif] = uSt({price:true, agent:true, tx:true, news:false});
  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />

      <div style={{padding:'18px 20px 0'}}>
        <div style={{display:'flex', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:18, fontWeight:600}}>Settings</div>
            <div style={{fontSize:13, color:'var(--text-dim)', marginTop:2}}>Preferences & defaults.</div>
          </div>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
      </div>

      <div style={{padding:'14px 20px', flex:1, overflow:'auto'}}>
        <SettingGroup title="APPEARANCE">
          <SettingRow label="Theme">
            <div style={{display:'flex', gap:4, background:'var(--bg-elev)', padding:3, borderRadius:10, border:'1px solid var(--border-soft)'}}>
              {['dark','light'].map(t => (
                <button key={t} onClick={()=>onThemeChange(t)} style={{padding:'6px 14px', borderRadius:7, border:'none', background: theme===t?'var(--chip)':'transparent', color: theme===t?'var(--text)':'var(--text-dim)', cursor:'pointer', fontSize:12, textTransform:'capitalize', fontWeight:500}}>
                  {t}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="Density">
            <div style={{display:'flex', gap:4, background:'var(--bg-elev)', padding:3, borderRadius:10, border:'1px solid var(--border-soft)'}}>
              {['comfortable','compact'].map(d => (
                <button key={d} onClick={()=>onDensityChange(d)} style={{padding:'6px 14px', borderRadius:7, border:'none', background: density===d?'var(--chip)':'transparent', color: density===d?'var(--text)':'var(--text-dim)', cursor:'pointer', fontSize:12, textTransform:'capitalize', fontWeight:500}}>
                  {d}
                </button>
              ))}
            </div>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="TRADING">
          <SettingRow label="Default slippage">
            <div style={{display:'flex', gap:4, background:'var(--bg-elev)', padding:3, borderRadius:10, border:'1px solid var(--border-soft)'}}>
              {['0.1','0.5','1.0'].map(s => (
                <button key={s} onClick={()=>setSlippage(s)} style={{padding:'6px 12px', borderRadius:7, border:'none', background: slippage===s?'var(--chip)':'transparent', color: slippage===s?'var(--text)':'var(--text-dim)', cursor:'pointer', fontSize:12, fontWeight:500}} className="mono">
                  {s}%
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="MEV protection" sub="Route through private mempool by default">
            <Toggle value={true}/>
          </SettingRow>
          <SettingRow label="Simulate before sign" sub="Pre-flight every transaction">
            <Toggle value={true}/>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="NOTIFICATIONS">
          {[{k:'price', l:'Price alerts'}, {k:'agent', l:'Agent activity'}, {k:'tx', l:'Transaction status'}, {k:'news', l:'Protocol news'}].map(n => (
            <SettingRow key={n.k} label={n.l}>
              <Toggle value={notif[n.k]} onChange={v=>setNotif({...notif, [n.k]:v})}/>
            </SettingRow>
          ))}
        </SettingGroup>

        <SettingGroup title="ADVANCED">
          <SettingRow label="Default network">
            <button style={{...panelStyles.chip, padding:'6px 12px'}}>
              <span style={{width:8, height:8, borderRadius:99, background:'#0052ff'}}/> Base <IconChev size={12}/>
            </button>
          </SettingRow>
          <SettingRow label="Gas preference">
            <button style={{...panelStyles.chip, padding:'6px 12px'}}>Standard <IconChev size={12}/></button>
          </SettingRow>
        </SettingGroup>
      </div>
    </>
  );
};

const SettingGroup = ({ title, children }) => (
  <div style={{marginBottom:20}}>
    <div style={{fontSize:10, color:'var(--text-mute)', letterSpacing:'.08em', marginBottom:8}}>{title}</div>
    <div style={{background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:12, overflow:'hidden'}}>
      {children}
    </div>
  </div>
);
const SettingRow = ({ label, sub, children }) => (
  <div style={{display:'flex', alignItems:'center', padding:'12px 14px', borderBottom:'1px solid var(--border-soft)', gap:12}}>
    <div style={{flex:1, minWidth:0}}>
      <div style={{fontSize:13, fontWeight:500}}>{label}</div>
      {sub && <div style={{fontSize:11, color:'var(--text-dim)', marginTop:2}}>{sub}</div>}
    </div>
    {children}
  </div>
);
const Toggle = ({ value, onChange }) => {
  const [v, setV] = uSt(value);
  uEf(()=>setV(value), [value]);
  const toggle = () => { const nv = !v; setV(nv); onChange && onChange(nv); };
  return (
    <button onClick={toggle} style={{width:36, height:20, borderRadius:99, background: v?'var(--accent)':'var(--chip)', border:'none', position:'relative', cursor:'pointer', transition:'background .2s'}}>
      <span style={{position:'absolute', top:2, left: v?18:2, width:16, height:16, borderRadius:99, background:'#fff', transition:'left .2s'}}/>
    </button>
  );
};

// ── Position Detail ─────────────────────────────────────────────
const PositionDetailPanel = ({ asset, close, back }) => {
  const pts = uMe(() => Array.from({length: 60}, (_,i) => 55 + Math.sin(i*0.5)*12 + i*.4 + Math.cos(i*1.2)*3), []);
  const w=500, h=160, pad=8;
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const sx = i => pad + i/(pts.length-1) * (w-pad*2);
  const sy = v => pad + (1-(v-mn)/(mx-mn+.001))*(h-pad*2);
  const path = pts.map((v,i)=>`${i===0?'M':'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

  const a = asset || ASSETS[0];
  return (
    <>
      <PanelHeader title="Ask Mantua" right={
        <div style={{display:'flex', gap:8}}>
          <button style={panelStyles.ghostBtn} onClick={()=>window.__mantuaNewChat && window.__mantuaNewChat()}><IconPlus size={14}/> New chat</button>
          <button style={panelStyles.ghostBtn}><IconHistory size={14}/> History</button>
        </div>
      } />

      <div style={{padding:'18px 20px 0'}}>
        <div style={{display:'flex', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:18, fontWeight:600}}>Position — {a.name}</div>
            <div style={{fontSize:13, color:'var(--text-dim)', marginTop:2}}>Performance & actions</div>
          </div>
          <button onClick={close} style={panelStyles.iconBtn}><IconClose size={16}/></button>
        </div>
      </div>

      <div style={{padding:'14px 20px', flex:1, overflow:'auto'}}>
        <button onClick={back} style={{...panelStyles.ghostBtn, marginBottom:12}}><IconBack size={12}/> Back</button>

        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <AssetIcon a={a} size={36}/>
          <div>
            <div style={{fontSize:15, fontWeight:500}}>{a.name} · {a.sym}</div>
            <div style={{fontSize:12, color:'var(--text-dim)'}}>{a.price} · {a.pct>=0?'↗':'↘'}<span style={{color: a.pct>=0?'var(--green)':'var(--red)', marginLeft:4}}>{Math.abs(a.pct).toFixed(2)}%</span></div>
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:14}}>
          {[
            {l:'Holdings', v:a.qty, s:a.val},
            {l:'Avg cost', v:'$2,847.20', s:''},
            {l:'Unrealized PnL', v:'+$5,486', s:'+27.5%', g:true},
            {l:'Realized PnL', v:'+$1,204', s:'YTD', g:true},
          ].map(s => (
            <div key={s.l} style={panelStyles.statBox}>
              <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.06em'}}>{s.l}</div>
              <div style={{fontSize:17, fontWeight:500, marginTop:4, color: s.g?'var(--green)':'var(--text)'}} className="mono">{s.v}</div>
              {s.s && <div style={{fontSize:11, color:'var(--text-dim)', marginTop:2}}>{s.s}</div>}
            </div>
          ))}
        </div>

        {/* Perf chart */}
        <div style={{marginTop:14}}>
          <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.06em'}}>PERFORMANCE · 90D</div>
          <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{marginTop:6}}>
            <defs>
              <linearGradient id="pdFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--amber)" stopOpacity=".25"/>
                <stop offset="1" stopColor="var(--amber)" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path d={path+` L${sx(pts.length-1)},${h-pad} L${sx(0)},${h-pad} Z`} fill="url(#pdFill)"/>
            <path d={path} fill="none" stroke="var(--amber)" strokeWidth="1.5"/>
          </svg>
        </div>

        {/* Recent txs */}
        <div style={{marginTop:16}}>
          <div style={{fontSize:11, color:'var(--text-mute)', letterSpacing:'.06em', marginBottom:8}}>RECENT ACTIVITY</div>
          {[
            {t:'Buy', d:'+2.1 ETH', s:'$7,623.25', when:'2h', g:true},
            {t:'Add liquidity', d:'ETH / USDC', s:'$4,200', when:'Yesterday'},
            {t:'Sell', d:'-0.8 ETH', s:'$2,904.10', when:'3d ago', r:true},
          ].map((tx,i) => (
            <div key={i} style={{display:'flex', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--border-soft)', gap:12}}>
              <div style={{width:32, height:32, borderRadius:8, background:'var(--bg-elev)', border:'1px solid var(--border-soft)', display:'flex', alignItems:'center', justifyContent:'center', color: tx.g?'var(--green)':tx.r?'var(--red)':'var(--text-dim)'}}>
                {tx.t==='Buy' ? <IconArrowDown size={14}/> : tx.t==='Sell' ? <IconArrowUp size={14}/> : <IconDroplet size={14}/>}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13, fontWeight:500}}>{tx.t} · {tx.d}</div>
                <div style={{fontSize:11, color:'var(--text-dim)'}}>{tx.when}</div>
              </div>
              <div style={{fontSize:13}} className="mono">{tx.s}</div>
            </div>
          ))}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:16}}>
          <button style={{...panelStyles.ghostBtn, padding:12, justifyContent:'center'}}>Swap out</button>
          <button style={{...panelStyles.primaryBtn, padding:12, fontSize:13}}>Add to position</button>
        </div>
      </div>
    </>
  );
};

const modalStyles = {
  backdrop: {
    position:'fixed', inset:0, background:'#000a', backdropFilter:'blur(8px)', zIndex:100,
    display:'flex', alignItems:'center', justifyContent:'center', animation:'fadeIn .2s'
  },
  modal: {
    width:'92%', maxWidth: 460, background:'var(--panel-solid)',
    border:'1px solid var(--border)', borderRadius:18, boxShadow:'0 20px 60px #000c',
    animation:'popIn .22s cubic-bezier(.2,.8,.3,1.2)'
  }
};

Object.assign(panelStyles, {
  modeTab: {
    flex:1, display:'flex', gap:8, alignItems:'center', padding:'10px 12px',
    borderRadius:9, border:'none', background:'transparent', color:'var(--text-dim)', cursor:'pointer'
  },
  modeTabActive: { background:'var(--amber)', color:'#0a1a14' },
  input: {
    width:'100%', padding:'10px 12px', background:'var(--bg-elev)', border:'1px solid var(--border-soft)',
    borderRadius:10, color:'var(--text)', fontSize:13, outline:'none'
  },
  checkbox: {
    display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
    background:'var(--bg-elev)', border:'1px solid var(--border-soft)', borderRadius:10, cursor:'pointer'
  }
});

Object.assign(window, {
  AgentPanel, WalletConnect, TxSignModal, SettingsPanel, PositionDetailPanel, modalStyles
});
