// WelcomeScreen.jsx — empty state
function WelcomeScreen({ initialDark=false }) {
  const [dark, setDark] = React.useState(initialDark);
  const [hover, setHover] = React.useState(null);
  const [drag, setDrag] = React.useState(false);
  const t = dark ? T.dark : T.light;

  const recents = [
    { name:'2024년 사업계획서.hwpx', date:'오늘 · 14:23', preview:'본 사업계획은 디지털 전환…', accent:'#2b6a6b'},
    { name:'제안서_초안_v3.hwpx', date:'오늘 · 11:08', preview:'귀사의 무궁한 발전을 기원합니다…', accent:'#a8423b'},
    { name:'회의록_4월정기.hwpx', date:'어제', preview:'1. 일시 및 장소…', accent:'#8a6a2a'},
    { name:'인사규정 개정안.hwp', date:'어제', preview:'제3장 임용 및 승진…', accent:'#4a5a8a', legacy:true},
    { name:'품질관리 매뉴얼.hwpx', date:'4월 24일', preview:'본 매뉴얼은 ISO 9001…', accent:'#3f7a4d'},
    { name:'연구개발 보고서.hwpx', date:'4월 22일', preview:'연구 개요 및 목적…', accent:'#7a3f6a'},
  ];

  return (
    <div data-screen-label="02 Welcome" style={{
      width:'100%', height:'100%', background:t.bg, color:t.text,
      fontFamily:'Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
      fontSize:13, display:'flex', flexDirection:'column', overflow:'hidden', borderRadius:8,
    }}>
      {/* Titlebar */}
      <div style={{
        height:36, background:t.chrome, borderBottom:`1px solid ${t.border}`,
        display:'flex', alignItems:'center', paddingLeft:78, paddingRight:10, gap:12, fontSize:12,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Logo dark={dark}/>
          <span style={{fontWeight:600}}>ahwp</span>
        </div>
        <div style={{width:1, height:14, background:t.border}}/>
        <span style={{color:t.textSubtle}}>열린 문서 없음</span>
        <div style={{flex:1}}/>
        <button onClick={()=>setDark(!dark)} style={iconBtn(t)}>{dark?<Ic.Sun s={14}/>:<Ic.Moon s={14}/>}</button>
        <button style={iconBtn(t)}><Ic.Settings s={14}/></button>
      </div>

      <div style={{flex:1, display:'flex', minHeight:0}}>
        {/* sidebar (slim, file list still visible per spec) */}
        <div style={{width:260, background:t.panel, borderRight:`1px solid ${t.border}`, padding:'12px', flexShrink:0}}>
          <div style={{display:'flex', gap:6, marginBottom:14}}>
            <button style={{
              flex:1, height:30, background:t.accent, color:'#fff', border:'none', borderRadius:6,
              fontSize:12.5, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', gap:5, fontFamily:'inherit',
            }}><Ic.Plus s={13}/> 새 문서</button>
            <button style={{
              flex:1, height:30, background:'transparent', color:t.text,
              border:`1px solid ${t.borderStrong}`, borderRadius:6, fontSize:12.5,
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
              fontFamily:'inherit',
            }}><Ic.Folder s={13}/> 파일 열기</button>
          </div>
          <div style={{fontSize:11, fontWeight:600, color:t.textMuted, textTransform:'uppercase',
            letterSpacing:'0.06em', padding:'4px 2px 8px'}}>최근 파일</div>
          {recents.map((f,i)=>(
            <div key={i} style={{
              display:'flex', gap:8, padding:'7px 8px', borderRadius:6, alignItems:'center',
              cursor:'pointer',
            }}>
              <div style={{color:f.legacy? '#b08a3a':t.textMuted, display:'flex'}}><Ic.File s={14}/></div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12.5, color:t.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{f.name}</div>
                <div style={{fontSize:10.5, color:t.textSubtle, marginTop:1}}>{f.date}</div>
              </div>
            </div>
          ))}
        </div>

        {/* center welcome */}
        <div style={{flex:1, overflow:'auto', minWidth:0}}>
          <div style={{maxWidth:920, margin:'0 auto', padding:'56px 48px 48px'}}>
            <div style={{marginBottom:36}}>
              <div style={{fontSize:11.5, color:t.textSubtle, letterSpacing:'0.18em', textTransform:'uppercase', marginBottom:10}}>WELCOME</div>
              <h1 style={{fontSize:30, fontWeight:700, margin:'0 0 8px', letterSpacing:'-0.025em'}}>
                안녕하세요, 김지원님.
              </h1>
              <p style={{margin:0, fontSize:14, color:t.textMuted, lineHeight:1.6, maxWidth:560}}>
                새 문서로 시작하거나, 기존 한글 문서를 열어 AI와 함께 작업해 보세요.
                <span style={{color:t.textSubtle}}> .hwp 와 .hwpx 모두 지원합니다.</span>
              </p>
            </div>

            {/* Two big cards */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:40}}>
              <div onMouseEnter={()=>setHover('blank')} onMouseLeave={()=>setHover(null)} style={{
                padding:'22px 22px 20px', background:t.paper, borderRadius:10,
                border:`1px solid ${hover==='blank'? t.accent : t.border}`,
                cursor:'pointer', transition:'all .15s', position:'relative',
                boxShadow: hover==='blank' ? '0 4px 16px rgba(43,106,107,.10)' : 'none',
              }}>
                <div style={{
                  width:38, height:38, borderRadius:8, background:t.accentSoft,
                  color:t.accentText, display:'flex', alignItems:'center', justifyContent:'center',
                  marginBottom:14,
                }}><Ic.Doc s={20}/></div>
                <div style={{fontSize:15, fontWeight:600, marginBottom:4, letterSpacing:'-0.01em'}}>빈 문서로 시작</div>
                <div style={{fontSize:12.5, color:t.textMuted, lineHeight:1.55}}>
                  0부터 작성하거나 AI에게 양식을 맡기세요. 빈 문서에서도 채팅이 바로 작동합니다.
                </div>
                <div style={{
                  position:'absolute', top:14, right:14, fontSize:10.5, color:t.textSubtle,
                  fontFamily:'ui-monospace, monospace', padding:'2px 6px',
                  border:`1px solid ${t.border}`, borderRadius:4,
                }}>⌘N</div>
              </div>

              <div
                onMouseEnter={()=>setHover('open')} onMouseLeave={()=>setHover(null)}
                onDragOver={e=>{e.preventDefault(); setDrag(true);}}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{e.preventDefault(); setDrag(false);}}
                style={{
                  padding:'22px 22px 20px', background:drag? t.accentSoft : t.paper, borderRadius:10,
                  border:`${drag?'2px':'1px'} dashed ${drag? t.accent : (hover==='open'? t.borderStrong : t.border)}`,
                  cursor:'pointer', transition:'all .15s', position:'relative',
                }}>
                <div style={{
                  width:38, height:38, borderRadius:8, background:dark?'#2a2a32':'#f1ecdf',
                  color:t.text, display:'flex', alignItems:'center', justifyContent:'center',
                  marginBottom:14,
                }}><Ic.Upload s={20}/></div>
                <div style={{fontSize:15, fontWeight:600, marginBottom:4, letterSpacing:'-0.01em'}}>
                  파일 열기 {drag && <span style={{color:t.accent}}>· 놓아 주세요</span>}
                </div>
                <div style={{fontSize:12.5, color:t.textMuted, lineHeight:1.55}}>
                  .hwp 또는 .hwpx 파일을 선택하거나, 이 영역에 끌어다 놓으세요.
                </div>
                <div style={{
                  position:'absolute', top:14, right:14, fontSize:10.5, color:t.textSubtle,
                  fontFamily:'ui-monospace, monospace', padding:'2px 6px',
                  border:`1px solid ${t.border}`, borderRadius:4,
                }}>⌘O</div>
              </div>
            </div>

            {/* Recent grid */}
            <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
              <h2 style={{fontSize:14, fontWeight:600, margin:0, letterSpacing:'-0.01em'}}>최근 작업한 문서</h2>
              <button style={{
                background:'transparent', border:'none', color:t.textMuted, fontSize:12,
                cursor:'pointer', fontFamily:'inherit',
              }}>전체 보기 →</button>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
              {recents.map((f,i)=>(
                <div key={i} style={{
                  background:t.paper, border:`1px solid ${t.border}`, borderRadius:8,
                  overflow:'hidden', cursor:'pointer', transition:'all .12s',
                }}>
                  <div style={{
                    height:88, background:dark?'#15151a':'#f8f5ec',
                    borderBottom:`1px solid ${t.border}`, position:'relative', overflow:'hidden',
                  }}>
                    <div style={{
                      position:'absolute', left:14, top:14, right:14, height:5, borderRadius:1,
                      background: f.accent, opacity:.85,
                    }}/>
                    <div style={{position:'absolute', left:14, top:25, width:'52%', height:3, background:dark?'#3a3a44':'#e3ddd0'}}/>
                    <div style={{position:'absolute', left:14, top:33, width:'78%', height:3, background:dark?'#2c2c34':'#ece5d4'}}/>
                    <div style={{position:'absolute', left:14, top:41, width:'68%', height:3, background:dark?'#2c2c34':'#ece5d4'}}/>
                    <div style={{position:'absolute', left:14, top:54, width:'40%', height:3, background:dark?'#2c2c34':'#ece5d4'}}/>
                    <div style={{position:'absolute', left:14, top:62, width:'60%', height:3, background:dark?'#2c2c34':'#ece5d4'}}/>
                    {f.legacy && <div style={{
                      position:'absolute', top:8, right:8, fontSize:9.5, fontWeight:600,
                      padding:'2px 6px', background:'#b08a3a', color:'#fff', borderRadius:3,
                    }}>HWP</div>}
                  </div>
                  <div style={{padding:'10px 12px 11px'}}>
                    <div style={{fontSize:12.5, fontWeight:600, color:t.text,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', letterSpacing:'-0.005em'}}>
                      {f.name}
                    </div>
                    <div style={{fontSize:10.5, color:t.textSubtle, marginTop:2,
                      display:'flex', justifyContent:'space-between'}}>
                      <span>{f.date}</span>
                      <span style={{color:t.textMuted, fontSize:10}}>● ● ●</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop:32, padding:'12px 14px', display:'flex', alignItems:'center', gap:10,
              background:dark?'rgba(95,180,179,.06)':'#fbf7eb',
              border:`1px solid ${dark?'rgba(95,180,179,.15)':'#ede4cc'}`,
              borderRadius:8, fontSize:12, color:t.textMuted, lineHeight:1.5,
            }}>
              <Ic.Sparkle s={14}/>
              <span><strong style={{color:t.text, fontWeight:600}}>팁:</strong> 빈 문서에서 채팅에 “이번 분기 매출 보고서 양식”을 요청하면 AI가 표지·목차·표를 한 번에 만들어 줍니다.</span>
            </div>
          </div>
        </div>

        {/* right chat panel (kept, but in idle state) */}
        <div style={{
          width:380, background:t.panel, borderLeft:`1px solid ${t.border}`,
          display:'flex', flexDirection:'column', flexShrink:0,
        }}>
          <div style={{padding:'12px 14px 10px'}}>
            <div style={{display:'flex', padding:3, background:dark?'#121215':'#e8e3d4', borderRadius:7, gap:2}}>
              <ModeButton t={t} active onClick={()=>{}} icon={<Ic.Hand s={13}/>} label="Manual" sub="제안 → 승인"/>
              <ModeButton t={t} active={false} onClick={()=>{}} icon={<Ic.Robot s={13}/>} label="Agent" sub="자동 실행"/>
            </div>
          </div>
          <div style={{padding:'0 14px', display:'flex', borderBottom:`1px solid ${t.border}`}}>
            <Tab t={t} active>채팅</Tab>
            <Tab t={t} active={false}>히스토리</Tab>
          </div>
          <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', padding:'24px', textAlign:'center', gap:10}}>
            <div style={{
              width:44, height:44, borderRadius:10, background:t.accentSoft, color:t.accentText,
              display:'flex', alignItems:'center', justifyContent:'center',
            }}><Ic.Sparkle s={20}/></div>
            <div style={{fontSize:13, fontWeight:600, color:t.text}}>AI 채팅이 준비되었습니다</div>
            <div style={{fontSize:12, color:t.textMuted, lineHeight:1.55, maxWidth:240}}>
              문서를 열거나 새로 만들면 채팅을 시작할 수 있습니다. 빈 문서에서도 양식을 요청할 수 있어요.
            </div>
            <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:6, width:'100%', maxWidth:280}}>
              {['이번 분기 매출 보고서 양식 만들어줘',
                '회의록 표준 양식으로 빈 문서 시작',
                '계약서 표지 만들기'].map(s=>(
                <button key={s} style={{
                  textAlign:'left', padding:'8px 11px', fontSize:11.5, color:t.textMuted,
                  background:dark?'#15151a':'#fff', border:`1px solid ${t.border}`,
                  borderRadius:6, cursor:'pointer', fontFamily:'inherit',
                }}>{s}</button>
              ))}
            </div>
          </div>
          <div style={{padding:'10px 12px 12px'}}>
            <div style={{
              border:`1px solid ${t.border}`, borderRadius:8, background:dark?'#15151a':'#fff',
              padding:'8px 10px', display:'flex', alignItems:'center', gap:8,
              opacity:.55,
            }}>
              <span style={{flex:1, fontSize:12, color:t.textSubtle}}>먼저 문서를 여세요…</span>
              <button style={{
                width:26, height:26, borderRadius:6, border:'none', background:dark?'#2a2a32':'#d8d2c1',
                color:t.textSubtle, cursor:'default', display:'flex', alignItems:'center', justifyContent:'center',
              }}><Ic.Send s={13}/></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.WelcomeScreen = WelcomeScreen;
