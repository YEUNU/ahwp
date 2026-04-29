// SettingsScreen.jsx — Settings modal w/ AI Provider tab active
function SettingsScreen({ initialDark=false }) {
  const [dark, setDark] = React.useState(initialDark);
  const [active, setActive] = React.useState('ai');
  const [activeProvider, setActiveProvider] = React.useState('anthropic');
  const t = dark ? T.dark : T.light;

  const tabs = [
    { id:'general', label:'일반', icon:<Ic.Settings s={14}/> },
    { id:'ai', label:'AI 공급자', icon:<Ic.Sparkle s={13}/> },
    { id:'shortcuts', label:'단축키', icon:<span style={{fontFamily:'ui-monospace, monospace', fontSize:11}}>⌘</span> },
    { id:'about', label:'정보', icon:<span style={{fontSize:13, fontWeight:700, fontFamily:'serif'}}>i</span> },
  ];

  return (
    <div data-screen-label="03 Settings" style={{
      width:'100%', height:'100%', position:'relative', overflow:'hidden',
      borderRadius:8, background: dark? '#0e0e10' : '#1c1a16',
      fontFamily:'Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    }}>
      {/* Backdrop preview of main app behind */}
      <div style={{
        position:'absolute', inset:0,
        background: dark
          ? 'radial-gradient(ellipse at top, #1c1c20 0%, #0a0a0c 70%)'
          : 'radial-gradient(ellipse at top, #2a2620 0%, #100e0a 70%)',
        opacity:.92,
      }}/>
      {/* faint backdrop content */}
      <div style={{
        position:'absolute', inset:'48px 60px', borderRadius:12, opacity:.18,
        background:`repeating-linear-gradient(180deg, transparent 0 12px, ${dark?'#fff':'#fff'}10 12px 13px)`,
      }}/>

      {/* Modal */}
      <div style={{
        position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        width:'min(900px, 92%)', height:'min(620px, 88%)',
        background: dark? '#1a1a1d' : '#fbfaf6', borderRadius:12, overflow:'hidden',
        boxShadow:'0 30px 80px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04)',
        display:'flex', color:t.text, fontSize:13,
      }}>
        {/* Left tabs */}
        <div style={{
          width:200, background: dark?'#15151a':'#f1ecdf',
          borderRight:`1px solid ${t.border}`, padding:'18px 10px',
          display:'flex', flexDirection:'column',
        }}>
          <div style={{padding:'4px 10px 16px', display:'flex', alignItems:'center', gap:8}}>
            <Logo dark={dark}/>
            <span style={{fontWeight:700, fontSize:13, letterSpacing:'-0.01em'}}>설정</span>
          </div>
          {tabs.map(tb=>(
            <button key={tb.id} onClick={()=>setActive(tb.id)} style={{
              display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
              border:'none', borderRadius:6, marginBottom:1, cursor:'pointer',
              background: active===tb.id? (dark?'#2a2a32':'#fff') : 'transparent',
              color: active===tb.id? t.text : t.textMuted,
              fontWeight: active===tb.id? 600 : 500, fontSize:12.5,
              fontFamily:'inherit', textAlign:'left',
              boxShadow: active===tb.id? '0 1px 2px rgba(0,0,0,.05)':'none',
            }}>
              <span style={{width:14, display:'flex', justifyContent:'center'}}>{tb.icon}</span>
              {tb.label}
            </button>
          ))}
          <div style={{flex:1}}/>
          <div style={{padding:'10px', fontSize:10.5, color:t.textSubtle}}>ahwp v0.4.2</div>
        </div>

        {/* Right content */}
        <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
          <div style={{
            padding:'18px 28px 14px', borderBottom:`1px solid ${t.border}`,
            display:'flex', alignItems:'flex-end', justifyContent:'space-between',
          }}>
            <div>
              <h2 style={{margin:0, fontSize:17, fontWeight:700, letterSpacing:'-0.015em'}}>AI 공급자</h2>
              <p style={{margin:'4px 0 0', fontSize:12, color:t.textMuted, lineHeight:1.5}}>
                채팅에 사용할 AI 공급자를 설정합니다. 키는 OS 키체인에 암호화되어 저장됩니다.
              </p>
            </div>
            <button onClick={()=>setDark(!dark)} style={{
              ...iconBtn(t), width:28, height:28, border:`1px solid ${t.border}`, borderRadius:6,
            }}>{dark?<Ic.Sun s={13}/>:<Ic.Moon s={13}/>}</button>
          </div>

          <div style={{flex:1, overflow:'auto', padding:'18px 28px 24px'}}>
            <ProviderCard t={t} dark={dark} id="openai" name="OpenAI" sub="GPT-4o, GPT-4 Turbo"
              connected enabled keyMask="sk-proj-…X8hQ" model="gpt-4o" 
              activeId={activeProvider} onActive={setActiveProvider} brand="#10a37f"/>
            <ProviderCard t={t} dark={dark} id="anthropic" name="Anthropic" sub="Claude Sonnet 4.6, Claude Opus 4"
              connected enabled keyMask="sk-ant-…7B2c" model="claude-sonnet-4-6" 
              activeId={activeProvider} onActive={setActiveProvider} brand="#c96442" recommended/>
            <ProviderCard t={t} dark={dark} id="google" name="Google" sub="Gemini 1.5 Pro, Gemini 1.5 Flash"
              connected={false} enabled={false} keyMask="" model="gemini-1.5-pro"
              activeId={activeProvider} onActive={setActiveProvider} brand="#4285f4"/>
            <ProviderCard t={t} dark={dark} id="ollama" name="Ollama" sub="로컬 모델 (오프라인 작동)"
              connected enabled isLocal baseUrl="http://localhost:11434" model="llama3.1:70b"
              activeId={activeProvider} onActive={setActiveProvider} brand="#5a5547"/>
            <ProviderCard t={t} dark={dark} id="custom" name="커스텀 (OpenAI 호환)" sub="자체 호스팅 또는 프록시 엔드포인트"
              connected={false} enabled={false} isCustom baseUrl="https://api.example.com/v1" keyMask="" model=""
              activeId={activeProvider} onActive={setActiveProvider} brand="#6b665b"/>
          </div>

          <div style={{
            padding:'12px 28px', borderTop:`1px solid ${t.border}`,
            display:'flex', alignItems:'center', gap:10,
            background: dark?'#15151a':'#f6f4ef',
          }}>
            <span style={{fontSize:11.5, color:t.textMuted, flex:1}}>
              변경사항은 자동으로 저장됩니다. 키를 변경하려면 새 값을 입력하세요.
            </span>
            <button style={{
              padding:'7px 14px', borderRadius:6, border:`1px solid ${t.borderStrong}`,
              background:'transparent', color:t.text, fontSize:12.5, fontWeight:500, cursor:'pointer',
              fontFamily:'inherit',
            }}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({t, dark, id, name, sub, connected, enabled, keyMask, model, baseUrl, isLocal, isCustom, brand, recommended, activeId, onActive}){
  const [on, setOn] = React.useState(enabled);
  const [keyVal, setKeyVal] = React.useState('');
  const isActive = id===activeId;
  return (
    <div style={{
      background: dark? '#1d1d22' : '#fff',
      border: `1px solid ${isActive? t.accent : t.border}`,
      borderRadius:9, marginBottom:10, overflow:'hidden',
      boxShadow: isActive? `0 0 0 3px ${dark?'rgba(95,180,179,.12)':'rgba(43,106,107,.08)'}`: 'none',
      transition:'all .15s',
    }}>
      <div style={{padding:'12px 14px', display:'flex', alignItems:'center', gap:12}}>
        <div style={{
          width:32, height:32, borderRadius:7, background:brand+'18',
          color:brand, display:'flex', alignItems:'center', justifyContent:'center',
          fontWeight:700, fontSize:13, letterSpacing:'-0.02em', flexShrink:0,
        }}>{name[0]}</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <span style={{fontSize:13.5, fontWeight:600, letterSpacing:'-0.01em'}}>{name}</span>
            {recommended && <span style={{
              fontSize:9.5, fontWeight:600, padding:'1.5px 6px', borderRadius:3,
              background:dark?'rgba(95,180,179,.18)':'#e3edec', color:t.accentText,
              textTransform:'uppercase', letterSpacing:'0.04em',
            }}>권장</span>}
          </div>
          <div style={{fontSize:11.5, color:t.textMuted, marginTop:2}}>{sub}</div>
        </div>
        {/* status badge */}
        <div style={{
          fontSize:10.5, fontWeight:600, padding:'3px 8px', borderRadius:10,
          display:'flex', alignItems:'center', gap:5,
          background: connected? (dark?'rgba(123,185,139,.15)':'#e3efdf') : (dark?'#2a2a32':'#ede9dc'),
          color: connected? (dark?'#9bd5a8':'#3f7a4d') : t.textSubtle,
        }}>
          <span style={{width:5, height:5, borderRadius:5, background: connected? '#3f7a4d' : t.textSubtle}}/>
          {connected? '연결됨' : '미연결'}
        </div>
        {/* toggle */}
        <button onClick={()=>setOn(!on)} style={{
          width:32, height:18, borderRadius:9, border:'none', padding:0, cursor:'pointer',
          background: on? t.accent : (dark?'#3a3a44':'#d6cfbf'),
          position:'relative', transition:'background .15s',
        }}>
          <span style={{
            position:'absolute', top:2, left: on? 16 : 2, width:14, height:14, borderRadius:7,
            background:'#fff', boxShadow:'0 1px 2px rgba(0,0,0,.18)',
            transition:'left .15s',
          }}/>
        </button>
      </div>

      {/* form section */}
      <div style={{
        padding:'2px 14px 12px', display:'grid',
        gridTemplateColumns: isCustom? '1fr 1fr' : '1.4fr 1fr',
        gap:10, opacity: on? 1 : 0.55, pointerEvents: on? 'auto' : 'none',
      }}>
        {!isLocal && !isCustom && (
          <Field t={t} dark={dark} label="API 키">
            <div style={{position:'relative'}}>
              <input
                type="password" placeholder={connected? `현재: ${keyMask}` : 'sk-…'}
                value={keyVal} onChange={e=>setKeyVal(e.target.value)}
                style={inputStyle(t, dark)}/>
              {connected && !keyVal && <span style={{
                position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
                fontSize:10.5, color:t.textSubtle, fontFamily:'ui-monospace, monospace',
              }}>{keyMask}</span>}
            </div>
          </Field>
        )}
        {isLocal && (
          <Field t={t} dark={dark} label="Base URL">
            <input defaultValue={baseUrl} style={inputStyle(t, dark)}/>
          </Field>
        )}
        {isCustom && (
          <>
            <Field t={t} dark={dark} label="Base URL">
              <input defaultValue={baseUrl} style={inputStyle(t, dark)}/>
            </Field>
            <Field t={t} dark={dark} label="API 키">
              <input type="password" placeholder="키 입력…" style={inputStyle(t, dark)}/>
            </Field>
          </>
        )}
        {!isCustom && (
          <Field t={t} dark={dark} label="기본 모델">
            <SelectStub t={t} dark={dark} value={model || '모델 선택'}/>
          </Field>
        )}
        {isCustom && (
          <Field t={t} dark={dark} label="모델명" full>
            <input placeholder="예: my-finetune-v2" style={inputStyle(t, dark)}/>
          </Field>
        )}

        <div style={{gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:8, marginTop:2}}>
          <button style={{
            padding:'5px 11px', borderRadius:5, border:`1px solid ${t.borderStrong}`,
            background:'transparent', color:t.text, fontSize:11.5, cursor:'pointer',
            fontFamily:'inherit', display:'flex', alignItems:'center', gap:5,
          }}><Ic.Check s={11}/> 연결 테스트</button>
          <span style={{fontSize:11, color:t.textSubtle}}>
            {connected? '· 마지막 확인 2분 전' : '· 키를 입력 후 테스트하세요'}
          </span>
          <div style={{flex:1}}/>
          <label style={{
            display:'flex', alignItems:'center', gap:6, fontSize:11.5,
            color: isActive? t.text : t.textMuted, cursor: on? 'pointer' : 'default',
          }}>
            <input type="radio" name="active-provider" checked={isActive}
              onChange={()=>onActive(id)} disabled={!on}
              style={{accentColor:t.accent}}/>
            활성 공급자로 사용
          </label>
        </div>
      </div>
    </div>
  );
}

function Field({t, dark, label, full, children}){
  return (
    <div style={{gridColumn: full? '1 / -1' : 'auto'}}>
      <div style={{fontSize:10.5, fontWeight:600, color:t.textMuted, textTransform:'uppercase',
        letterSpacing:'0.05em', marginBottom:5}}>{label}</div>
      {children}
    </div>
  );
}
function inputStyle(t, dark){
  return {
    width:'100%', height:30, padding:'0 10px', borderRadius:6,
    border:`1px solid ${t.border}`, background: dark?'#15151a':'#fbfaf6',
    color:t.text, fontSize:12, fontFamily:'inherit', outline:'none', boxSizing:'border-box',
  };
}
function SelectStub({t, dark, value}){
  return (
    <div style={{
      ...inputStyle(t, dark), display:'flex', alignItems:'center', justifyContent:'space-between',
      cursor:'pointer', paddingRight:8,
    }}>
      <span style={{fontFamily:'ui-monospace, monospace', fontSize:11.5}}>{value}</span>
      <span style={{color:t.textMuted, display:'flex'}}><Ic.Chevron s={11}/></span>
    </div>
  );
}

window.SettingsScreen = SettingsScreen;
