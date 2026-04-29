// MainScreen.jsx — ahwp main 3-pane editor
// Custom desktop chrome — original design, not a clone of any existing app.

const T = {
  // Light theme — warm paper neutrals + ink accent
  light: {
    bg: '#f6f4ef',           // app bg (warm off-white)
    chrome: '#efece5',       // titlebar / panel chrome
    panel: '#fbfaf6',        // sidebar / chat bg
    paper: '#ffffff',        // editor paper
    border: '#e3ddd0',
    borderStrong: '#d6cfbf',
    text: '#1c1a16',
    textMuted: '#6b665b',
    textSubtle: '#9a9486',
    accent: '#2b6a6b',       // deep teal-ink
    accentSoft: '#e3edec',
    accentText: '#1f4f50',
    danger: '#a8423b',
    success: '#3f7a4d',
    selected: '#e8e3d4',
    selectedText: '#1c1a16',
    chipBg: '#ece7d8',
  },
  dark: {
    bg: '#17171a',
    chrome: '#1d1d21',
    panel: '#1a1a1d',
    paper: '#23232a',
    border: '#2c2c34',
    borderStrong: '#3a3a44',
    text: '#e7e3d6',
    textMuted: '#9d9788',
    textSubtle: '#6b675c',
    accent: '#5fb4b3',
    accentSoft: '#1e3736',
    accentText: '#9fdcdb',
    danger: '#d97a72',
    success: '#7bb98b',
    selected: '#2a2a32',
    selectedText: '#f3efe2',
    chipBg: '#2a2a32',
  }
};

function MainScreen({ initialDark=false }) {
  const [dark, setDark] = React.useState(initialDark);
  const [mode, setMode] = React.useState('manual'); // manual | agent
  const [tab, setTab] = React.useState('chat');     // chat | history
  const [activeFile, setActiveFile] = React.useState(2);
  const [provider, setProvider] = React.useState('Claude Sonnet 4.6');
  const [providerOpen, setProviderOpen] = React.useState(false);
  const [diffStatus, setDiffStatus] = React.useState('pending'); // pending | accepted | rejected
  const [input, setInput] = React.useState('');
  const t = dark ? T.dark : T.light;

  const files = [
    { name: '2024년 사업계획서.hwpx', date: '오늘 · 14:23', dirty: true },
    { name: '제안서_초안_v3.hwpx', date: '오늘 · 11:08', dirty: false },
    { name: '회의록_4월정기.hwpx', date: '어제', dirty: false },
    { name: '인사규정 개정안.hwp', date: '어제', dirty: false, legacy: true },
    { name: '품질관리 매뉴얼.hwpx', date: '4월 24일', dirty: false },
    { name: '연구개발 보고서.hwpx', date: '4월 22일', dirty: false },
    { name: '교육계획_상반기.hwpx', date: '4월 19일', dirty: false },
    { name: '예산집행 내역서.hwpx', date: '4월 15일', dirty: false },
  ];

  const messages = [
    { role:'user', text:'이 단락 더 격식 있게 다듬어줘.' },
    { role:'assistant', text:'두 번째 단락이 구어체가 섞여 있네요. 격식체로 통일하고 어휘를 보고서 톤에 맞춰 정리해 드릴게요. 변경 제안을 아래 카드에서 확인해 주세요.' },
    { role:'user', text:'좋아. 표 합계 행도 굵게 처리해줘.' },
    { role:'assistant', text:'합계 행을 **bold**로 처리하고 셀 배경에 옅은 강조를 넣었습니다. 두 가지 변경이 함께 적용됩니다.', diff:true },
  ];

  return (
    <div data-screen-label="01 Main 3-Pane" style={{
      width:'100%', height:'100%', background:t.bg, color:t.text,
      fontFamily:'Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
      fontSize:13, letterSpacing:'-0.005em', display:'flex', flexDirection:'column',
      overflow:'hidden', borderRadius:8,
    }}>
      {/* Titlebar */}
      <div style={{
        height:36, background:t.chrome, borderBottom:`1px solid ${t.border}`,
        display:'flex', alignItems:'center', paddingLeft:78, paddingRight:10,
        gap:12, flexShrink:0, fontSize:12,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Logo dark={dark} />
          <span style={{color:t.text, fontWeight:600, letterSpacing:'-0.01em'}}>ahwp</span>
        </div>
        <div style={{width:1, height:14, background:t.border}}/>
        <div style={{color:t.textMuted, display:'flex', alignItems:'center', gap:6}}>
          <span>{files[activeFile].name}</span>
          {files[activeFile].dirty && <span style={{width:5, height:5, borderRadius:5, background:t.accent, display:'inline-block'}}/>}
        </div>
        <div style={{flex:1}}/>
        <button onClick={()=>setDark(!dark)} title={dark?'라이트 모드':'다크 모드'} style={iconBtn(t)}>
          {dark? <Ic.Sun s={14}/> : <Ic.Moon s={14}/>}
        </button>
        <button title="설정" style={iconBtn(t)}><Ic.Settings s={14}/></button>
      </div>

      {/* 3-Pane body */}
      <div style={{flex:1, display:'flex', minHeight:0}}>
        {/* LEFT SIDEBAR */}
        <div style={{
          width:260, background:t.panel, borderRight:`1px solid ${t.border}`,
          display:'flex', flexDirection:'column', flexShrink:0,
        }}>
          <div style={{padding:'12px 12px 10px', display:'flex', gap:6}}>
            <button style={{
              flex:1, height:30, background:t.accent, color:'#fff', border:'none', borderRadius:6,
              fontSize:12.5, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', gap:5, fontFamily:'inherit', letterSpacing:'-0.01em',
            }}>
              <Ic.Plus s={13}/> 새 문서
            </button>
            <button style={{
              flex:1, height:30, background:'transparent', color:t.text,
              border:`1px solid ${t.borderStrong}`, borderRadius:6, fontSize:12.5,
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              gap:5, fontFamily:'inherit',
            }}>
              <Ic.Folder s={13}/> 파일 열기
            </button>
          </div>

          <div style={{padding:'4px 12px 8px'}}>
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'4px 2px 6px',
            }}>
              <span style={{fontSize:11, fontWeight:600, color:t.textMuted, textTransform:'uppercase', letterSpacing:'0.06em'}}>최근 파일</span>
              <span style={{fontSize:11, color:t.textSubtle}}>{files.length}</span>
            </div>
            <div style={{
              position:'relative', height:28,
            }}>
              <div style={{position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', color:t.textSubtle, display:'flex'}}>
                <Ic.Search s={12}/>
              </div>
              <input placeholder="파일 검색…" style={{
                width:'100%', height:28, padding:'0 8px 0 26px', borderRadius:6,
                border:`1px solid ${t.border}`, background:dark?'#15151a':'#fdfcf8',
                color:t.text, fontSize:12, fontFamily:'inherit', outline:'none',
                boxSizing:'border-box',
              }}/>
            </div>
          </div>

          <div style={{flex:1, overflow:'auto', padding:'2px 6px 8px'}}>
            {files.map((f,i)=> (
              <FileRow key={i} file={f} active={i===activeFile} t={t} onClick={()=>setActiveFile(i)}/>
            ))}
          </div>

          <div style={{padding:'8px 12px 10px', borderTop:`1px solid ${t.border}`, display:'flex', alignItems:'center', gap:8, fontSize:11.5, color:t.textMuted}}>
            <div style={{
              width:22, height:22, borderRadius:11, background:t.accentSoft, color:t.accentText,
              display:'flex', alignItems:'center', justifyContent:'center', fontWeight:600, fontSize:10.5,
            }}>JK</div>
            <div style={{flex:1, lineHeight:1.2}}>
              <div style={{color:t.text, fontWeight:500, fontSize:11.5}}>김지원</div>
              <div style={{fontSize:10.5}}>로컬 워크스페이스</div>
            </div>
          </div>
        </div>

        {/* CENTER EDITOR */}
        <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0, background:t.bg}}>
          {/* editor toolbar */}
          <div style={{
            height:34, borderBottom:`1px solid ${t.border}`, display:'flex', alignItems:'center',
            padding:'0 12px', gap:10, fontSize:11.5, color:t.textMuted, background:t.bg,
          }}>
            <span style={{display:'flex', alignItems:'center', gap:6, color:t.text, fontWeight:500}}>
              <span style={{width:6, height:6, borderRadius:6, background: files[activeFile].dirty? '#d18b3c' : t.success}}/>
              {files[activeFile].dirty? '저장 안 됨' : '저장됨'}
            </span>
            <span style={{color:t.textSubtle}}>·</span>
            <span style={{fontFamily:'ui-monospace, "SF Mono", Menlo, monospace', fontSize:11}}>~/문서/2024년 사업계획서.hwpx</span>
            <div style={{flex:1}}/>
            <button style={iconBtn(t)} title="실행 취소"><Ic.Undo s={13}/></button>
            <button style={iconBtn(t)} title="다시 실행"><Ic.Redo s={13}/></button>
            <div style={{width:1, height:14, background:t.border, margin:'0 2px'}}/>
            <button style={iconBtn(t)} title="더 보기"><Ic.More s={14}/></button>
          </div>

          {/* paper */}
          <div style={{flex:1, overflow:'auto', padding:'28px 24px 60px', display:'flex', justifyContent:'center'}}>
            <Paper t={t} dark={dark}/>
          </div>

          {/* status bar */}
          <div style={{
            height:24, borderTop:`1px solid ${t.border}`, background:t.chrome,
            display:'flex', alignItems:'center', padding:'0 12px', gap:14, fontSize:11,
            color:t.textMuted, fontFamily:'ui-monospace, "SF Mono", Menlo, monospace',
          }}>
            <span>글자수 1,847</span>
            <span>단어 432</span>
            <div style={{flex:1}}/>
            <span>페이지 3 / 12</span>
            <span>UTF-8</span>
            <span>한국어</span>
          </div>
        </div>

        {/* RIGHT CHAT PANEL */}
        <div style={{
          width:380, background:t.panel, borderLeft:`1px solid ${t.border}`,
          display:'flex', flexDirection:'column', flexShrink:0, minWidth:0,
        }}>
          {/* mode toggle */}
          <div style={{padding:'12px 14px 10px'}}>
            <div style={{
              display:'flex', padding:3, background: dark?'#121215':'#e8e3d4',
              borderRadius:7, gap:2,
            }}>
              <ModeButton t={t} active={mode==='manual'} onClick={()=>setMode('manual')}
                icon={<Ic.Hand s={13}/>} label="Manual" sub="제안 → 승인"/>
              <ModeButton t={t} active={mode==='agent'} onClick={()=>setMode('agent')}
                icon={<Ic.Robot s={13}/>} label="Agent" sub="자동 실행"/>
            </div>
          </div>

          {/* tabs */}
          <div style={{padding:'0 14px', display:'flex', gap:0, borderBottom:`1px solid ${t.border}`}}>
            <Tab t={t} active={tab==='chat'} onClick={()=>setTab('chat')}>채팅</Tab>
            <Tab t={t} active={tab==='history'} onClick={()=>setTab('history')}>히스토리</Tab>
          </div>

          {tab==='chat' ? (
            <>
              {/* provider row */}
              <div style={{
                padding:'10px 14px', display:'flex', alignItems:'center', gap:8,
                borderBottom:`1px solid ${t.border}`,
              }}>
                <button onClick={()=>setProviderOpen(!providerOpen)} style={{
                  display:'flex', alignItems:'center', gap:6, padding:'5px 9px',
                  borderRadius:6, border:`1px solid ${t.border}`,
                  background:dark?'#15151a':'#fff', color:t.text, fontSize:12,
                  fontFamily:'inherit', cursor:'pointer',
                }}>
                  <Ic.Sparkle s={12}/>
                  <span style={{fontWeight:500}}>{provider}</span>
                  <Ic.Chevron s={11}/>
                </button>
                <div style={{flex:1}}/>
                <button title="새 대화" style={{
                  ...iconBtn(t), border:`1px solid ${t.border}`, borderRadius:6,
                  width:26, height:26,
                }}>
                  <Ic.Plus s={12}/>
                </button>
                {providerOpen && (
                  <ProviderMenu t={t} current={provider} onPick={p=>{setProvider(p); setProviderOpen(false);}}/>
                )}
              </div>

              {/* messages */}
              <div style={{flex:1, overflow:'auto', padding:'14px 14px 8px', display:'flex', flexDirection:'column', gap:10}}>
                {messages.map((m,i)=>(
                  <Message key={i} m={m} t={t} dark={dark}
                    diffStatus={diffStatus}
                    onAccept={()=>setDiffStatus('accepted')}
                    onReject={()=>setDiffStatus('rejected')}/>
                ))}
              </div>

              {/* input */}
              <div style={{padding:'10px 12px 12px'}}>
                <div style={{
                  border:`1px solid ${t.borderStrong}`, borderRadius:8,
                  background:dark?'#15151a':'#fff', padding:'8px 10px 6px',
                }}>
                  <textarea
                    value={input} onChange={e=>setInput(e.target.value)}
                    placeholder={mode==='manual'? '문서에 대해 물어보거나 수정 제안을 요청하세요…' : '에이전트에게 작업을 지시하세요…'}
                    rows={2}
                    style={{
                      width:'100%', border:'none', outline:'none', resize:'none',
                      background:'transparent', color:t.text, fontSize:12.5,
                      fontFamily:'inherit', lineHeight:1.45, padding:0,
                      boxSizing:'border-box',
                    }}/>
                  <div style={{display:'flex', alignItems:'center', gap:6, marginTop:4}}>
                    <button style={iconBtn(t)} title="첨부"><Ic.Paperclip s={13}/></button>
                    <button style={iconBtn(t)} title="현재 단락 참조">
                      <span style={{fontSize:11, color:t.textMuted, padding:'2px 6px', borderRadius:4, border:`1px dashed ${t.border}`}}>@단락 2</span>
                    </button>
                    <div style={{flex:1}}/>
                    <span style={{fontSize:10.5, color:t.textSubtle, fontFamily:'ui-monospace, monospace'}}>⌘↵</span>
                    <button style={{
                      width:26, height:26, borderRadius:6, border:'none',
                      background: input? t.accent : (dark?'#2a2a32':'#d8d2c1'),
                      color: input? '#fff' : t.textSubtle,
                      cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      <Ic.Send s={13}/>
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <HistoryList t={t}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────

function Logo({ dark }){
  return (
    <div style={{
      width:18, height:18, borderRadius:5,
      background: dark? 'linear-gradient(135deg, #5fb4b3 0%, #2b6a6b 100%)'
                      : 'linear-gradient(135deg, #2b6a6b 0%, #1d4f50 100%)',
      display:'flex', alignItems:'center', justifyContent:'center',
      color:'#fff', fontSize:10, fontWeight:700, letterSpacing:'-0.04em',
      boxShadow: dark? 'inset 0 1px 0 rgba(255,255,255,.15)' : '0 1px 0 rgba(0,0,0,.08)',
    }}>한</div>
  );
}
window.Logo = Logo;

function iconBtn(t){
  return {
    width:24, height:24, borderRadius:5, border:'none', background:'transparent',
    color:t.textMuted, cursor:'pointer', display:'flex', alignItems:'center',
    justifyContent:'center', padding:0,
  };
}
window.iconBtn = iconBtn;

function FileRow({file, active, t, onClick}){
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} style={{
      display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderRadius:6,
      background: active? t.selected : (hover? (t.bg) : 'transparent'),
      cursor:'pointer', marginBottom:1, position:'relative',
    }}>
      <div style={{color: file.legacy? '#b08a3a' : t.textMuted, display:'flex'}}>
        <Ic.File s={14}/>
      </div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{
          fontSize:12.5, color:t.text, fontWeight: active?500:400,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', lineHeight:1.25,
        }}>{file.name}</div>
        <div style={{fontSize:10.5, color:t.textSubtle, lineHeight:1.3, marginTop:1}}>{file.date}</div>
      </div>
      {file.dirty && !hover && <span style={{width:5, height:5, borderRadius:5, background:t.accent}}/>}
      {hover && (
        <button style={{
          ...iconBtn(t), width:22, height:22, background:t.bg, border:`1px solid ${t.border}`,
        }}>
          <Ic.More s={12}/>
        </button>
      )}
    </div>
  );
}
window.FileRow = FileRow;

function Paper({t, dark}){
  return (
    <div style={{
      width:720, maxWidth:'100%', background:t.paper, color: dark?'#dad6c8':'#1c1a16',
      borderRadius:3, padding:'56px 72px',
      boxShadow: dark
        ? '0 1px 0 rgba(255,255,255,.04), 0 12px 32px rgba(0,0,0,.45)'
        : '0 1px 0 rgba(0,0,0,.04), 0 8px 28px rgba(50,40,30,.10), 0 2px 8px rgba(50,40,30,.05)',
      fontFamily:'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", serif',
      fontSize:14, lineHeight:1.75,
    }}>
      <div style={{textAlign:'center', marginBottom:28}}>
        <div style={{fontSize:11, letterSpacing:'0.2em', color: dark?'#7a7363':'#8a8470', marginBottom:8}}>2024 ANNUAL REPORT</div>
        <h1 style={{fontSize:24, fontWeight:700, margin:0, letterSpacing:'-0.02em'}}>2024년도 사업계획서</h1>
        <div style={{
          width:48, height:2, background: dark?'#5fb4b3':'#2b6a6b',
          margin:'14px auto 0',
        }}/>
      </div>

      <h2 style={{fontSize:15, fontWeight:600, margin:'24px 0 10px'}}>1. 추진 배경</h2>
      <p style={{margin:'0 0 12px'}}>
        본 사업계획은 디지털 전환 가속화에 따른 업무 환경 변화에 대응하고, 한글 문서 작업의
        효율성을 제고하기 위하여 수립되었다. <span style={{
          background: dark?'rgba(95,180,179,.12)':'#fff7d6',
          padding:'1px 3px', borderRadius:2,
        }}>특히 AI 기반 문서 보조 기능의 도입을 통해</span> 단순 반복 작업을 줄이고
        창의적 업무에 집중할 수 있는 기반을 마련하고자 한다.
      </p>

      <h2 style={{fontSize:15, fontWeight:600, margin:'20px 0 10px'}}>2. 주요 추진 과제</h2>
      <p style={{margin:'0 0 12px', color: dark?'#9d9788':'#52504a'}}>
        다음과 같이 네 가지 핵심 과제를 중심으로 단계적으로 추진한다. 각 과제는 1분기부터
        4분기에 걸쳐 순차적으로 시행되며, 분기별 성과를 정량 지표로 측정하여 차기 연도
        계획에 반영한다.
      </p>

      {/* table */}
      <table style={{
        width:'100%', borderCollapse:'collapse', marginTop:14, fontSize:13,
      }}>
        <thead>
          <tr style={{background: dark?'#1d1d22':'#f5f1e6'}}>
            <th style={cellH(dark)}>구분</th>
            <th style={cellH(dark)}>과제명</th>
            <th style={cellH(dark)}>일정</th>
            <th style={{...cellH(dark), textAlign:'right'}}>예산(천원)</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={cell(dark)}>1</td><td style={cell(dark)}>문서 표준 템플릿 정비</td><td style={cell(dark)}>Q1</td><td style={{...cell(dark), textAlign:'right'}}>12,400</td></tr>
          <tr><td style={cell(dark)}>2</td><td style={cell(dark)}>AI 보조 기능 시범 도입</td><td style={cell(dark)}>Q2–Q3</td><td style={{...cell(dark), textAlign:'right'}}>38,200</td></tr>
          <tr><td style={cell(dark)}>3</td><td style={cell(dark)}>전사 워크플로우 통합</td><td style={cell(dark)}>Q3</td><td style={{...cell(dark), textAlign:'right'}}>21,800</td></tr>
          <tr style={{background: dark?'rgba(95,180,179,.07)':'#fbf7eb', fontWeight:600}}>
            <td style={cell(dark)}></td><td style={cell(dark)}>합계</td><td style={cell(dark)}></td><td style={{...cell(dark), textAlign:'right'}}>72,400</td>
          </tr>
        </tbody>
      </table>

      <p style={{margin:'18px 0 0', color: dark?'#9d9788':'#52504a', fontSize:13}}>
        세부 추진 일정과 부서별 역할 분담은 별첨 1 참조. 각 부서는 매월 말 진척도를 보고하며,
        주관 부서는 이를 종합하여 분기별 운영위원회에 안건으로 상정한다.
      </p>

      <div style={{
        marginTop:24, padding:'10px 14px', background: dark?'rgba(95,180,179,.06)':'#fbf7eb',
        borderLeft: `2px solid ${dark?'#5fb4b3':'#c9b878'}`, fontSize:12.5,
        color: dark?'#bdb8a6':'#5a5547',
      }}>
        ※ 본 계획은 임원회의 심의를 거쳐 확정되며, 시행 중 조정이 필요한 경우 변경 절차를 따른다.
      </div>
    </div>
  );
}
window.Paper = Paper;

function cellH(dark){
  return {
    padding:'8px 10px', textAlign:'left', fontWeight:600, fontSize:12,
    borderBottom:`1px solid ${dark?'#3a3a44':'#d6cfbf'}`,
    borderTop:`1px solid ${dark?'#3a3a44':'#d6cfbf'}`,
    color: dark? '#dad6c8':'#3a3833',
  };
}
function cell(dark){
  return {
    padding:'7px 10px', borderBottom:`1px solid ${dark?'#2c2c34':'#ece5d4'}`, fontSize:12.5,
  };
}
window.cellH = cellH; window.cell = cell;

function ModeButton({t, active, onClick, icon, label, sub}){
  return (
    <button onClick={onClick} style={{
      flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:1,
      padding:'6px 6px 7px', border:'none', borderRadius:5, cursor:'pointer',
      background: active? t.paper : 'transparent',
      color: active? t.text : t.textMuted,
      boxShadow: active? '0 1px 2px rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.04)' : 'none',
      fontFamily:'inherit',
    }}>
      <span style={{display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600}}>
        {icon}{label}
      </span>
      <span style={{fontSize:10.5, color: active? t.textMuted : t.textSubtle, letterSpacing:'-0.005em'}}>{sub}</span>
    </button>
  );
}
window.ModeButton = ModeButton;

function Tab({t, active, onClick, children}){
  return (
    <button onClick={onClick} style={{
      padding:'10px 0', marginRight:18, border:'none', background:'transparent',
      color: active? t.text : t.textMuted, fontWeight: active?600:500, fontSize:12.5,
      cursor:'pointer', borderBottom:`2px solid ${active? t.accent : 'transparent'}`,
      marginBottom:-1, fontFamily:'inherit',
    }}>{children}</button>
  );
}
window.Tab = Tab;

function ProviderMenu({t, current, onPick}){
  const opts = [
    {name:'Claude Sonnet 4.6', sub:'Anthropic · 권장'},
    {name:'GPT-4o', sub:'OpenAI'},
    {name:'Gemini 1.5 Pro', sub:'Google'},
    {name:'Llama 3.1 70B', sub:'Ollama (로컬)'},
  ];
  return (
    <div style={{
      position:'absolute', top:42, left:14, zIndex:10,
      background:t.paper, border:`1px solid ${t.borderStrong}`, borderRadius:7,
      boxShadow:'0 8px 24px rgba(0,0,0,.18)', padding:4, width:240,
    }}>
      {opts.map(o=>(
        <button key={o.name} onClick={()=>onPick(o.name)} style={{
          display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderRadius:5,
          width:'100%', border:'none', background: o.name===current? t.selected:'transparent',
          color:t.text, cursor:'pointer', textAlign:'left', fontFamily:'inherit',
        }}>
          <Ic.Sparkle s={12}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:12.5, fontWeight:500}}>{o.name}</div>
            <div style={{fontSize:10.5, color:t.textSubtle}}>{o.sub}</div>
          </div>
          {o.name===current && <Ic.Check s={12}/>}
        </button>
      ))}
    </div>
  );
}
window.ProviderMenu = ProviderMenu;

function Message({m, t, dark, diffStatus, onAccept, onReject}){
  const isUser = m.role==='user';
  if (isUser) {
    return (
      <div style={{display:'flex', justifyContent:'flex-end'}}>
        <div style={{
          maxWidth:'85%', background:t.accent, color:'#fff', padding:'7px 11px',
          borderRadius:'10px 10px 2px 10px', fontSize:12.5, lineHeight:1.5,
        }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start', gap:6}}>
      <div style={{
        maxWidth:'92%', background:dark?'#23232a':'#f1ecdf', color:t.text,
        padding:'8px 11px', borderRadius:'10px 10px 10px 2px', fontSize:12.5, lineHeight:1.55,
      }}>{renderMd(m.text)}</div>
      {m.diff && (
        <DiffCard t={t} dark={dark} status={diffStatus} onAccept={onAccept} onReject={onReject}/>
      )}
    </div>
  );
}
window.Message = Message;

function renderMd(text){
  // very tiny **bold** support
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p,i)=> p.startsWith('**')
    ? <strong key={i} style={{fontWeight:600}}>{p.slice(2,-2)}</strong>
    : <React.Fragment key={i}>{p}</React.Fragment>);
}
window.renderMd = renderMd;

function DiffCard({t, dark, status, onAccept, onReject}){
  const applied = status==='accepted';
  const rejected = status==='rejected';
  const dim = applied || rejected;
  return (
    <div style={{
      width:'100%', background:t.paper, border:`1px solid ${t.border}`, borderRadius:8,
      overflow:'hidden', opacity: dim? 0.65 : 1, transition:'opacity .2s',
    }}>
      <div style={{
        padding:'8px 11px', borderBottom:`1px solid ${t.border}`,
        display:'flex', alignItems:'center', gap:8, fontSize:11.5,
      }}>
        <Ic.Pencil s={12}/>
        <span style={{fontWeight:600, color:t.text}}>단락 2 수정 제안</span>
        <span style={{color:t.textSubtle}}>·</span>
        <span style={{color:t.textMuted, fontSize:11}}>3페이지</span>
        <div style={{flex:1}}/>
        {applied && <span style={{
          fontSize:10.5, padding:'2px 7px', borderRadius:10,
          background:dark?'rgba(123,185,139,.18)':'#e3efdf', color:t.success, fontWeight:600,
        }}>적용됨</span>}
        {rejected && <span style={{
          fontSize:10.5, padding:'2px 7px', borderRadius:10,
          background:dark?'rgba(217,122,114,.15)':'#f5e3e1', color:t.danger, fontWeight:600,
        }}>거절됨</span>}
      </div>
      <div style={{padding:'8px 0', fontFamily:'ui-monospace, "SF Mono", Menlo, monospace', fontSize:11.5, lineHeight:1.6}}>
        <DiffLine t={t} dark={dark} kind="del">
          본 사업계획은 디지털 전환에 <Inline kind="del" dark={dark}>발맞추기 위해서</Inline> 만들어졌고요.
        </DiffLine>
        <DiffLine t={t} dark={dark} kind="add">
          본 사업계획은 디지털 전환에 <Inline kind="add" dark={dark}>대응하기 위하여</Inline> 수립되었다.
        </DiffLine>
      </div>
      <div style={{padding:'2px 11px 8px'}}>
        <button style={{
          fontSize:11, color:t.textMuted, background:'transparent', border:'none',
          cursor:'pointer', display:'flex', alignItems:'center', gap:4, padding:'3px 0',
          fontFamily:'inherit',
        }}>
          <Ic.Chevron s={10} dir="right"/>
          변경 이유
        </button>
      </div>
      <div style={{
        padding:'8px 11px', background:dark?'#1d1d22':'#faf7ee',
        borderTop:`1px solid ${t.border}`, display:'flex', gap:6,
      }}>
        <button onClick={onAccept} disabled={dim} style={{
          padding:'5px 11px', borderRadius:5, border:'none',
          background: dim? (dark?'#2a2a32':'#e3ddd0') : t.accent,
          color: dim? t.textSubtle : '#fff', fontWeight:600, fontSize:11.5,
          cursor: dim? 'default' : 'pointer', display:'flex', alignItems:'center', gap:4,
          fontFamily:'inherit',
        }}>
          <Ic.Check s={11}/> Accept
        </button>
        <button onClick={onReject} disabled={dim} style={{
          padding:'5px 11px', borderRadius:5, border:'none', background:'transparent',
          color: dim? t.textSubtle : t.textMuted, fontSize:11.5,
          cursor: dim? 'default' : 'pointer', fontFamily:'inherit',
        }}>Reject</button>
        <div style={{flex:1}}/>
        <button style={{
          padding:'5px 9px', borderRadius:5, border:'none', background:'transparent',
          color:t.textMuted, fontSize:11.5, cursor:'pointer', fontFamily:'inherit',
          display:'flex', alignItems:'center', gap:4,
        }}>
          <Ic.Eye s={12}/> 에디터에서 보기
        </button>
      </div>
    </div>
  );
}
window.DiffCard = DiffCard;

function DiffLine({t, dark, kind, children}){
  const bg = kind==='del'
    ? (dark?'rgba(217,122,114,.10)':'#fbeae8')
    : (dark?'rgba(123,185,139,.10)':'#e8f3e3');
  const sym = kind==='del'? '−' : '+';
  const symColor = kind==='del'? t.danger : t.success;
  return (
    <div style={{display:'flex', background:bg, padding:'3px 11px'}}>
      <span style={{width:12, color:symColor, fontWeight:700, flexShrink:0}}>{sym}</span>
      <span style={{flex:1}}>{children}</span>
    </div>
  );
}
function Inline({kind, dark, children}){
  const bg = kind==='del'
    ? (dark?'rgba(217,122,114,.30)':'#f5c4be')
    : (dark?'rgba(123,185,139,.30)':'#bce4ad');
  return <span style={{background:bg, padding:'1px 2px', borderRadius:2}}>{children}</span>;
}
window.DiffLine = DiffLine; window.Inline = Inline;

function HistoryList({t}){
  const items = [
    { title:'사업계획서 격식체 정리', last:'단락 2 수정 적용됨', time:'10분 전', count:14 },
    { title:'표 합계 굵게 + 배경 강조', last:'2개의 변경사항이 적용되었습니다', time:'1시간 전', count:6 },
    { title:'요약 추출 및 초록 작성', last:'초록 480자 / 요약 3문단', time:'어제', count:9 },
    { title:'영문 번역 초안', last:'4개 단락 번역 완료', time:'어제', count:11 },
    { title:'표지 양식 제안', last:'3가지 옵션 제시', time:'4월 24일', count:5 },
    { title:'문서 톤 점검', last:'5개 위치에 톤 불일치 표시', time:'4월 22일', count:8 },
  ];
  return (
    <div style={{flex:1, overflow:'auto', padding:'8px 10px'}}>
      {items.map((it,i)=>(
        <div key={i} style={{
          padding:'10px 12px', marginBottom:4, borderRadius:7, cursor:'pointer',
          background: i===0? t.selected : 'transparent',
        }}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
            <span style={{
              width:6, height:6, borderRadius:6, background:i<2? t.accent : t.textSubtle,
            }}/>
            <span style={{fontSize:12.5, fontWeight:600, color:t.text, flex:1, minWidth:0,
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.title}</span>
            <span style={{fontSize:10.5, color:t.textSubtle}}>{it.time}</span>
          </div>
          <div style={{
            fontSize:11.5, color:t.textMuted, lineHeight:1.4,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          }}>{it.last}</div>
          <div style={{fontSize:10.5, color:t.textSubtle, marginTop:4, display:'flex', gap:10}}>
            <span>메시지 {it.count}개</span>
          </div>
        </div>
      ))}
    </div>
  );
}
window.HistoryList = HistoryList;

window.MainScreen = MainScreen;
window.T = T;
