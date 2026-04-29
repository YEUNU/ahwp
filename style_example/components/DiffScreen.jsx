// DiffScreen.jsx — Diff viewer variants (single + stacked)
function DiffScreen({ initialDark=false }) {
  const [dark, setDark] = React.useState(initialDark);
  const [single, setSingle] = React.useState({status:'pending', open:false});
  const [stack, setStack] = React.useState([
    {status:'pending'}, {status:'pending'}, {status:'pending'}
  ]);
  const t = dark ? T.dark : T.light;

  const setStackI = (i, patch) => setStack(s => s.map((x,j)=> j===i? {...x, ...patch} : x));
  const acceptAll = () => setStack(s => s.map(x => x.status==='pending'? {...x, status:'accepted'} : x));

  return (
    <div data-screen-label="04 Diff Viewer" style={{
      width:'100%', height:'100%', background:t.bg, color:t.text,
      fontFamily:'Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
      fontSize:13, display:'flex', flexDirection:'column', overflow:'hidden', borderRadius:8,
    }}>
      <div style={{
        height:36, background:t.chrome, borderBottom:`1px solid ${t.border}`,
        display:'flex', alignItems:'center', paddingLeft:78, paddingRight:10, gap:12, fontSize:12,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Logo dark={dark}/>
          <span style={{fontWeight:600}}>ahwp</span>
        </div>
        <div style={{width:1, height:14, background:t.border}}/>
        <span style={{color:t.textMuted}}>Diff 뷰어 — 컴포넌트 명세</span>
        <div style={{flex:1}}/>
        <button onClick={()=>setDark(!dark)} style={iconBtn(t)}>{dark?<Ic.Sun s={14}/>:<Ic.Moon s={14}/>}</button>
      </div>

      <div style={{flex:1, overflow:'auto', padding:'24px 28px 32px',
        display:'grid', gridTemplateColumns:'1fr 1fr', gap:28, alignContent:'start'}}>

        {/* LEFT — single card (3 states) */}
        <section>
          <SectionHeader t={t} num="A" title="단일 변경 제안" sub="기본 / 적용됨 / 거절됨 상태"/>
          <div style={{display:'flex', flexDirection:'column', gap:14}}>
            <DetailedDiffCard t={t} dark={dark} state="pending"
              onAccept={()=>{}} onReject={()=>{}} open={false}/>
            <DetailedDiffCard t={t} dark={dark} state="accepted" open={true}/>
            <DetailedDiffCard t={t} dark={dark} state="rejected" open={false} compact/>
          </div>
        </section>

        {/* RIGHT — stacked patches */}
        <section>
          <SectionHeader t={t} num="B" title="여러 변경 제안" sub="한 응답에 3개 패치 + 모두 Accept"/>
          <div style={{
            background: dark?'#1d1d22':'#f1ecdf', borderRadius:10, padding:12,
            border:`1px solid ${t.border}`,
          }}>
            <div style={{
              display:'flex', alignItems:'center', gap:10, padding:'4px 6px 12px',
            }}>
              <Ic.Sparkle s={14}/>
              <span style={{fontSize:12.5, fontWeight:600}}>3개 변경사항을 제안합니다</span>
              <span style={{fontSize:11, color:t.textMuted}}>
                · {stack.filter(x=>x.status==='accepted').length} 적용 / {stack.length} 총
              </span>
              <div style={{flex:1}}/>
              <button onClick={acceptAll} style={{
                padding:'5px 11px', borderRadius:5, border:'none', background:t.accent,
                color:'#fff', fontWeight:600, fontSize:11.5, cursor:'pointer',
                fontFamily:'inherit', display:'flex', alignItems:'center', gap:4,
              }}>
                <Ic.Check s={11}/> 모두 Accept
              </button>
            </div>

            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              <StackedPatch t={t} dark={dark} idx={1} title="제목 줄 강조 추가"
                location="1페이지, 제목" status={stack[0].status}
                deletion="2024년도 사업계획서"
                addition="2024년도 사업계획서 (안)"
                onAccept={()=>setStackI(0, {status:'accepted'})}
                onReject={()=>setStackI(0, {status:'rejected'})}/>
              <StackedPatch t={t} dark={dark} idx={2} title="단락 톤 통일"
                location="3페이지, 단락 2" status={stack[1].status}
                deletion="…디지털 전환에 발맞추기 위해서 만들어졌고요."
                addition="…디지털 전환에 대응하기 위하여 수립되었다."
                onAccept={()=>setStackI(1, {status:'accepted'})}
                onReject={()=>setStackI(1, {status:'rejected'})}/>
              <StackedPatch t={t} dark={dark} idx={3} title="표 합계 행 굵게"
                location="3페이지, 표 1" status={stack[2].status}
                deletion="합계  72,400"
                addition="**합계**  **72,400**" mono
                onAccept={()=>setStackI(2, {status:'accepted'})}
                onReject={()=>setStackI(2, {status:'rejected'})}/>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({t, num, title, sub}){
  return (
    <div style={{marginBottom:14, display:'flex', alignItems:'flex-start', gap:10}}>
      <div style={{
        width:22, height:22, borderRadius:6, background:t.accentSoft, color:t.accentText,
        display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:11,
        flexShrink:0,
      }}>{num}</div>
      <div>
        <div style={{fontSize:13, fontWeight:600, letterSpacing:'-0.01em'}}>{title}</div>
        <div style={{fontSize:11.5, color:t.textMuted, marginTop:1}}>{sub}</div>
      </div>
    </div>
  );
}

function DetailedDiffCard({t, dark, state, onAccept, onReject, open: initOpen=false, compact}){
  const [open, setOpen] = React.useState(initOpen);
  const dim = state!=='pending';
  return (
    <div style={{
      background:t.paper, border:`1px solid ${state==='accepted'?'transparent':t.border}`, borderRadius:8,
      overflow:'hidden', opacity: state==='rejected'? 0.65 : 1,
      boxShadow: state==='accepted'
        ? `0 0 0 1px ${dark?'rgba(123,185,139,.4)':'#3f7a4d'}, 0 1px 0 rgba(0,0,0,.02)` : 'none',
    }}>
      <div style={{
        padding:'10px 12px', borderBottom: !compact? `1px solid ${t.border}`:'none',
        display:'flex', alignItems:'center', gap:8,
      }}>
        <Ic.Pencil s={13}/>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontSize:12.5, fontWeight:600}}>단락 2 수정 제안</div>
          <div style={{fontSize:10.5, color:t.textMuted, marginTop:1, fontFamily:'ui-monospace, monospace'}}>
            3페이지 · 단락 2 · 23–47번째 글자
          </div>
        </div>
        {state==='accepted' && <span style={{
          fontSize:10.5, padding:'2.5px 8px', borderRadius:10, fontWeight:600,
          background:dark?'rgba(123,185,139,.18)':'#e3efdf', color:t.success,
          display:'flex', alignItems:'center', gap:4,
        }}><Ic.Check s={10}/> 적용됨</span>}
        {state==='rejected' && <span style={{
          fontSize:10.5, padding:'2.5px 8px', borderRadius:10, fontWeight:600,
          background:dark?'rgba(217,122,114,.15)':'#f5e3e1', color:t.danger,
        }}>거절됨</span>}
      </div>
      {!compact && (
        <>
          <div style={{padding:'10px 0', fontFamily:'ui-monospace, "SF Mono", Menlo, monospace', fontSize:12, lineHeight:1.7}}>
            <DiffLine t={t} dark={dark} kind="del">
              본 사업계획은 디지털 전환에 <Inline kind="del" dark={dark}>발맞추기 위해서</Inline> <Inline kind="del" dark={dark}>만들어졌고요</Inline>.
            </DiffLine>
            <DiffLine t={t} dark={dark} kind="add">
              본 사업계획은 디지털 전환에 <Inline kind="add" dark={dark}>대응하기 위하여</Inline> <Inline kind="add" dark={dark}>수립되었다</Inline>.
            </DiffLine>
          </div>
          <div style={{padding:'2px 12px 8px'}}>
            <button onClick={()=>setOpen(!open)} style={{
              fontSize:11.5, color:t.textMuted, background:'transparent', border:'none',
              cursor:'pointer', display:'flex', alignItems:'center', gap:5, padding:'4px 0',
              fontFamily:'inherit',
            }}>
              <Ic.Chevron s={10} dir={open? 'down' : 'right'}/>
              변경 이유
            </button>
            {open && (
              <div style={{
                marginTop:4, padding:'9px 11px', background:dark?'#15151a':'#faf7ee',
                border:`1px solid ${t.border}`, borderRadius:6, fontSize:11.5,
                color:t.textMuted, lineHeight:1.6,
              }}>
                <strong style={{color:t.text, fontWeight:600}}>구어체 → 격식체로 통일.</strong>{' '}
                ‘만들어졌고요’의 종결어미와 ‘발맞추기 위해서’의 연결어미가 보고서 톤과 어긋나
                ‘수립되었다’, ‘대응하기 위하여’로 교체했습니다. 의미는 동일하게 유지됩니다.
              </div>
            )}
          </div>
          <div style={{
            padding:'9px 12px', background:dark?'#15151a':'#faf7ee',
            borderTop:`1px solid ${t.border}`, display:'flex', gap:6, alignItems:'center',
          }}>
            <button onClick={onAccept} disabled={dim} style={{
              padding:'6px 13px', borderRadius:6, border:'none',
              background: dim? (dark?'#2a2a32':'#e3ddd0') : t.accent,
              color: dim? t.textSubtle : '#fff', fontWeight:600, fontSize:12,
              cursor: dim? 'default' : 'pointer', display:'flex', alignItems:'center', gap:5,
              fontFamily:'inherit',
            }}><Ic.Check s={12}/> Accept</button>
            <button onClick={onReject} disabled={dim} style={{
              padding:'6px 13px', borderRadius:6, border:'none', background:'transparent',
              color: dim? t.textSubtle : t.textMuted, fontSize:12,
              cursor: dim? 'default' : 'pointer', fontFamily:'inherit',
            }}>Reject</button>
            <div style={{flex:1}}/>
            <button style={{
              padding:'6px 10px', borderRadius:6, border:'none', background:'transparent',
              color:t.textMuted, fontSize:11.5, cursor:'pointer', fontFamily:'inherit',
              display:'flex', alignItems:'center', gap:5,
            }}><Ic.Eye s={12}/> 에디터에서 보기</button>
          </div>
        </>
      )}
    </div>
  );
}

function StackedPatch({t, dark, idx, title, location, status, deletion, addition, mono, onAccept, onReject}){
  const dim = status!=='pending';
  return (
    <div style={{
      background:t.paper, borderRadius:7, overflow:'hidden',
      border:`1px solid ${status==='accepted'? (dark?'rgba(123,185,139,.4)':'#9bd5a8') : t.border}`,
      opacity: status==='rejected'? 0.55 : 1, transition:'all .15s',
    }}>
      <div style={{
        padding:'8px 10px', display:'flex', alignItems:'center', gap:8,
        borderBottom:`1px solid ${t.border}`,
      }}>
        <span style={{
          width:18, height:18, borderRadius:4, fontSize:10.5, fontWeight:700,
          background:t.accentSoft, color:t.accentText,
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
        }}>{idx}</span>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontSize:12, fontWeight:600, lineHeight:1.3,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{title}</div>
          <div style={{fontSize:10.5, color:t.textSubtle, fontFamily:'ui-monospace, monospace', marginTop:1}}>{location}</div>
        </div>
        {status==='accepted' && <span style={{color:t.success, display:'flex'}}><Ic.Check s={13}/></span>}
      </div>
      <div style={{padding:'6px 0', fontFamily:'ui-monospace, "SF Mono", Menlo, monospace', fontSize:11, lineHeight:1.55}}>
        <DiffLine t={t} dark={dark} kind="del">{deletion}</DiffLine>
        <DiffLine t={t} dark={dark} kind="add">{addition}</DiffLine>
      </div>
      <div style={{
        padding:'6px 10px', display:'flex', gap:5, alignItems:'center',
        borderTop:`1px solid ${t.border}`, background:dark?'#15151a':'#faf7ee',
      }}>
        <button onClick={onAccept} disabled={dim} style={{
          padding:'4px 9px', borderRadius:4, border:'none',
          background: dim? 'transparent' : t.accent,
          color: dim? t.textSubtle : '#fff',
          fontWeight:600, fontSize:11, cursor: dim?'default':'pointer', fontFamily:'inherit',
        }}>Accept</button>
        <button onClick={onReject} disabled={dim} style={{
          padding:'4px 9px', borderRadius:4, border:'none', background:'transparent',
          color: dim? t.textSubtle : t.textMuted, fontSize:11,
          cursor: dim? 'default':'pointer', fontFamily:'inherit',
        }}>Reject</button>
        <div style={{flex:1}}/>
        <button style={{
          color:t.textSubtle, background:'transparent', border:'none', fontSize:11,
          cursor:'pointer', fontFamily:'inherit', padding:'4px 6px',
        }}>보기 →</button>
      </div>
    </div>
  );
}

window.DiffScreen = DiffScreen;
