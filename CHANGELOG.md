# Changelog

이 파일은 ahwp의 사용자 영향 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/) 을 따릅니다.

## [Unreleased]

### Added — 2차 UX 라운드 chunks 56~ (0.2.56~)

- **chunk 56 — AI 우클릭 메뉴 (0.2.56)**: body selection 우클릭 → "다듬기 / 요약 / 영어 번역 / 격식체 / 평어" 메뉴. 클릭 시 `ChatPanel.prefillAndSend()`로 즉시 chat 턴 발사 (선택 텍스트를 prompt 템플릿에 inline). ChatPanel을 forwardRef + `ChatPanelHandle` 신설
- **chunk 60 — 검색 in 폴더 (⌘⇧F, 0.2.60)**: 폴더 트리 영역을 `SearchPanel`로 토글 + `folder:search-text` IPC. main에서 root walk + `@rhwp/core`로 IR 텍스트 추출 + grep (depth 5 / 200 파일 / 5MB / 50 hits 상한). 결과 클릭 시 `openTab` + `viewer.scrollToParagraph` 점프
- **chunk 59 — PDF 내보내기 (0.2.61)**: `file:export-pdf` IPC + 메뉴 + ⌘K. main에서 hidden BrowserWindow에 HTML 셸(@page 25mm + Pretendard) load → `webContents.printToPDF`로 Chrome PDF 백엔드 활용. 사용자 선택 경로에 atomic write
- **chunk 58 — 목차 사이드바 (⌘⇧O, 0.2.61)**: `viewer.getOutline()` — 단락 styleId를 styleList에서 "제목 N" / "Heading N"로 매칭, level 추출. `OutlineSidebar` 컴포넌트가 viewer 옆에 토글 + 클릭 시 scrollToParagraph
- **chunk 57 — AI inline diff (0.2.61)**: `viewer.snapshotParagraphs()` + `markChangedParagraphsSince(before)`. AppShell의 applyHtml/runTools가 before/after로 bracket. 변경된 단락 좌측에 amber 3px 막대 + animate-pulse + 15s 후 페이드

### Added — Phase B-1: 한글 호환 F3 본문 block 단축키 (0.2.78)

- 본문 caret 시 F3 연속 입력 (600ms 윈도우):
  - F3 1× — block 시작 모드 진입 (v1 no-op, Shift+arrow와 동등)
  - F3 2× — 현재 단어 선택 (= 더블클릭)
  - F3 3× — 현재 단락 선택 (= 트리플클릭)
  - F3 4× — 문서 전체 선택 (= ⌘A)
- 셀 안 caret이면 F3 fall-through (한글 reflex와 동일 — 셀에선 F5/F7/F8을 사용).
- F3 외 다른 키 누르면 카운터 리셋.
- ⌘A / 더블·트리플 클릭이 이미 동일 효과를 주지만 한글 reflex 사용자 호환 편의용.
- 기준: [한글 표 단축키 일람](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm) — "F3을 두 번 누르면 그 낱말이 블록으로 설정됩니다. 세 번 누르면 그 문단이..."

### Added — Phase B-3: 표 navigation 단축키 (0.2.77)

- **Tab** (셀 안) — 다음 셀로 caret 이동. row-major 순회 (행 끝이면 다음 행 첫 셀).
- **Shift+Tab** (셀 안) — 이전 셀로 caret 이동.
- **Alt+화살표** (셀 안) — row/col 단위 셀 이동. rowSpan/colSpan 고려해 병합 셀도 정확히 진입. 표 경계 밖이면 no-op.
- **Shift+ESC** (셀 안) — 표 빠져나가기. caret을 표가 속한 단락 바로 다음 본문 단락 시작으로 (없으면 같은 단락 끝).
- 셀 안 caret이 아니면 Tab은 fall-through (본문 탭 동작 유지).
- Ctrl+Tab (셀 안 탭 문자 삽입)는 후속 (라이브러리에 cell-aware tab insert API 확인 필요).
- 기준: [한글 표 단축키 일람](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm)

### Added — Phase B-2: 한글 호환 셀/행/열 block 단축키 (0.2.76)

- **F5** (또는 Mac `⌘⌥B`) — 현재 셀 block. 600ms 안에 연속 입력 시 누름 횟수 카운트, 3회 누르면 표 전체 block (`F5×3`).
- **F7** (또는 Mac `⌘⌥C`) — 칸(열) 전체 block. 현재 셀이 속한 열 전체.
- **F8** (또는 Mac `⌘⌥R`) — 줄(행) 전체 block. 현재 셀이 속한 행 전체.
- **`⌘⌥T`** — 표 전체 block (Mac에서 F5×3 직접 진입용 단축키).
- 셀 안 caret이 아니면 모두 no-op (한글과 동일).
- rowSpan/colSpan 고려한 cell intersection 검사로 병합 셀 정확히 처리.
- 단축키 입력 즉시 `cellBlockHighlights`에 cell bbox 채워서 시각화. selectionRectsByPage / selectedControlBboxes는 비움.
- F5×2 확장 모드(arrow로 셀 단위 확장)는 별도 commit (Phase B-2.5)로 미룸.
- 기준: [한글 표 단축키 일람](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm)

### Added — Phase A: 셀 경계 넘는 multi-cell drag block (0.2.75)

- 셀 안에서 드래그를 시작해 다른 셀로 진입하면 한컴 한글 reference대로 char-level 모드에서 cell-block 모드로 자동 전환. 통과한 모든 셀(rectangular row/col 범위)이 하이라이트됨.
- `getTableCellBboxes`로 표의 모든 셀 좌표 + row/col/span 받아서 anchor 셀 ~ focus 셀의 bounding rectangle 안에 들어오는 셀을 필터. rowSpan/colSpan 고려한 intersection 검사.
- 새 state `cellBlockHighlights`. cell-block 모드 진입 시 char-level rect는 비우고 cell bbox로만 표시. 같은 셀로 돌아오면 다시 char-level.
- 다른 표 또는 본문으로 이탈하면 focus freeze (cross-table drag는 v2).
- ESC / mouseup-empty / 새 mousedown 시 정리.
- 기준: [한컴 한글 표 셀 블록](https://help.hancom.com/hoffice/multi/ko_kr/hwp/table/table%28cell%29.htm) — "마우스가 지나간 셀이 모두 셀 블록으로 설정됩니다"
- Follow-up: F5/F7/F8 단축키 (Phase B-2), 표 navigation 단축키 (Phase B-3).

### Added — control(표) 영역 highlight 시각화 (0.2.74)

- 0.2.72에서 드래그가 control 위 통과 시 그 control이 속한 본문 단락이 selection에 포함되도록 처리했지만 시각적으로 control 자체는 highlight 안 됐음. 이제 표 bounding box를 selection 색상(`bg-primary/25`)으로 오버레이해서 표 자체도 "선택된" 것처럼 보이게 함.
- 구현: `applyPointerToSelection`이 control hit을 감지해 focus를 부모 단락 경계로 점프시킨 직후, `getTableBBox`로 표의 페이지 좌표를 받아 `selectedControlBboxes` state에 추가. mousedown 본문 시 / Esc / mouseup-empty 시 자동 클리어.
- 한계: v1은 표만 처리 (이미지/도형은 라이브러리가 통합 bbox API publish 후 추가 예정). 또한 사용자가 마우스를 빠르게 움직여 control 영역 위 hit이 1번도 발생하지 않으면 logically 포함된 control이라도 highlight 누락 가능 — 추후 paragraph 범위 enumeration으로 보강.

### Added — 셀 안 글자 드래그 selection v1 (0.2.73)

- 표 셀 내부에서 글자 드래그로 부분 선택 가능 (mousedown 위치 → 같은 셀 내 다른 위치로 mouseup). 같은 셀 + 같은 cellParaIndex 안에서만 동작 — 셀 경계를 넘으면 focus freeze (cross-cell drag는 v2).
- selection state에 `cell` 필드(`parentParaIndex`/`controlIndex`/`cellIndex`/`cellParaIndex`) 추가. `refreshSelectionRects`가 anchor/focus 둘 다 같은 cell 컨텍스트면 `getSelectionRectsInCell` 경로 사용, 아니면 기존 본문 `getSelectionRects` 경로.
- `cellDragRef`로 드래그 모드 추적. mousedown 셀 분기에서 anchor=focus 셀 caret으로 selection 초기화 후 drag listener 부착. 셀에서 시작한 더블/트리플 클릭은 비활성 (word/paragraph in-cell은 후속).
- 다음 commit에서 control 영역 highlight 시각화 추가 예정 (드래그가 표/이미지/도형 위 통과 시 그 객체 자체에도 selection 색상 표시).

### Changed — 드래그 시 표/이미지/도형 영역 통째로 선택 (0.2.72)

- 기존(0.2.69): 본문 드래그 selection이 control(표·이미지·도형) 위를 통과할 때 focus update를 freeze (=control 영역만 selection에서 제외) — 단순 보호 동작이라 사용자가 "object를 포함시키려면 어떻게?"라는 케이스 미해결.
- 변경: control 위를 통과할 때 focus를 그 control의 `parentParaIndex` (object가 anchor된 본문 단락)의 경계로 점프시켜 selection이 단락 전체를 포함하도록 처리. 방향에 따라:
  - 드래그가 object 아래로 진행 (anchor가 object 위) → focus = parentPara 끝
  - 드래그가 object 위로 진행 (anchor가 object 아래) → focus = parentPara 시작
- 결과: 표/이미지/도형 위를 드래그로 가로지르면 그 object를 품은 단락 전체가 selection에 포함됨. 드래그가 표 안에서 시작하는 케이스는 여전히 비활성 (cell selection v2).

### Fixed — wrapped paragraph 두 번째 줄 selection rect 누락 (0.2.71)

- 한 단락이 줄바꿈으로 두 줄 이상이 될 때, drag selection이 그 단락을 가로지르면 **중간 줄(wrap된 두 번째 줄)이 selection으로 highlight되지 않는** 현상.
- 진단: `getSelectionRects`가 반환한 rect들의 DOM 좌표 (`y`, `width`, `height`)를 dump해 보니 wrapped 두 번째 줄용 rect가 **첫 번째 줄과 같은 y**에 그려져서 시각적으로 겹쳐짐. 결과적으로 두 번째 줄 자리는 비어 보임.
- 근본 원인: `@rhwp/core` 0.7.9의 `getSelectionRects`가 wrapped continuation 줄의 y 좌표를 첫 줄과 동일하게 반환하는 라이브러리 버그.
- 수정: `refreshSelectionRects`에서 동일 페이지 내 같은 `y`를 가진 rect들을 검출해 두 번째부터 자기 height만큼 누적 shift. 라이브러리 fix 전 임시 workaround. 본문에서 인라인 control이 한 줄을 분할하는 케이스(드뭄)에선 false positive 가능 — 발생 시 재평가.

### Fixed — 드래그 시 페이지 전체 highlight + ESC 선택 해제 (0.2.70)

- **진짜 근본 원인** — 드래그할 때 보이던 "페이지 전체가 파란색으로 highlight" 현상은 우리 IR-level selection이 아니라 **네이티브 브라우저 selection**이 SVG `<text>` 요소 위에서 동시에 발생한 것. 우리 `handlePageMouseDown` 핸들러는 IR overlay rect로 자체 selection을 그리는데, 페이지 paper div에 `select-none`이 없어서 브라우저의 기본 텍스트 선택이 같이 진행됨. 결과: 우리 IR selection은 작은데 native가 페이지 전체를 잡아 "거대한 highlight" 시각 효과
- 모든 증상 설명: trace 상의 IR state는 정상(작음)인데 visual은 와이드 / ESC 안 먹힘 (native selection은 ESC로 해제 안 됨) / 표는 안 잡힘 (표는 별도 control이라 native text selection 대상 외)
- 수정: 페이지 paper div에 `select-none` Tailwind 클래스 추가. 네이티브 브라우저 selection 비활성화. 우리 IR selection은 `handlePageMouseDown` + `selectionRectsByPage` overlay로 단독 운영. Cmd+A/C/V는 menu 라우팅으로 IR handle에 연결돼 있어 영향 없음
- ESC 핸들러 보강 — 기존엔 `draggingRef.current` 가드로 인해 mouseup 이후엔 ESC가 no-op이었음. 드래그 종료 후에도 selection이 있으면 ESC로 해제되도록 분기 추가

### Fixed — 드래그가 표 위 통과 시 selection 점프 (0.2.69)

- **진짜 근본 원인** — 사용자가 보고한 "빈칸 들어가면 그 아래 전체 선택" 현상의 진짜 트리거는 빈 행간이 아니라 **표(table)** 였음. 본문에서 시작한 drag selection 도중 마우스가 표를 통과할 때, IR의 `hitTest`가 셀 내부 좌표를 반환 (`controlIndex`/`cellIndex`/`cellParaIndex`/`parentParaIndex` 채워서 옴). 그런데 `paragraphIndex`는 이때 **셀 안에서의 단락 인덱스**(cell-local)이고 섹션 단위가 아님. `applyPointerToSelection`이 이걸 그대로 섹션 단위로 써서 focus가 섹션 para 0(문서 맨 처음)으로 점프 → selection이 [para 0 ~ anchor]로 펼쳐짐 → 시각적으로 "위→아래 드래그한 것처럼" 보임 (anchor가 본문 아래쪽인 경우)
- 80px whitespace-jump 가드(0.2.68)로는 못 잡음 — 셀의 cursorRect는 실제 mouse Y 와 가깝게 위치하므로 (diff 8~45px) 문턱 미달
- 수정: `moveResult.controlIndex !== undefined`면 셀 내부 hit이므로 drag focus update를 skip. `handlePageMouseDown`이 이미 셀 내부 클릭은 drag 자체를 비활성화하므로, drag 중 셀 통과 케이스만 추가 가드한 셈. 셀 안↔밖 drag selection은 v2 (현재는 셀 진입 시 마지막 본문 focus 유지)

### Fixed — 드래그 빈칸 가드 진짜 작동시킴 (0.2.68)

- 0.2.67의 whitespace-jump 가드가 실제로는 **빈칸에서 그대로 점프**했음. 근본 원인: `hitTest`의 공식 반환은 `{sectionIndex, paragraphIndex, charOffset}`만 보장하고 `cursorRect`는 선택적 — 빈칸을 클릭하면 IR이 가장 가까운 텍스트 위치로 `paragraphIndex`/`charOffset`만 스냅하고 `cursorRect`는 빠진 채 반환할 때가 있음. 가드의 `if (moveResult.cursorRect)` 조건이 false가 되어 통째로 스킵돼서 focus가 IR 스냅 결과(섹션 끝 등)로 그대로 점프
- `cursorRect`가 없으면 `getCursorRect(s, p, c)`로 직접 조회해 항상 가드가 작동하게 변경. 추가로 결과 rect가 입력 페이지가 아닌 **다른 페이지**에 있을 수 있어서 (`resultRect.pageIndex`), `pageRefsRef.current[resultRect.pageIndex]`로 올바른 페이지 element의 `pageRect.top`을 사용해 client-Y 변환

### Added — 앱 아이콘 적용 + 드래그 빈칸 가드 (0.2.67)

- **앱 아이콘** — `build/icon.png` (1024px)을 electron-builder 패키징 default로 등록 (mac .icns / win .ico / linux .png 자동 변환). `public/icon.svg` + `favicon-{16,32}.png`를 `index.html`에 link → renderer favicon. TitleBar의 "한" 그라디언트 div를 `<img src="/icon.svg">`로 교체. style_example/icons에서 가져옴
- **드래그 빈칸 가드 (1차 시도)** — `applyPointerToSelection`에 whitespace-jump 검사 추가. IR의 `hitTest`가 단락 사이/페이지 여백 같은 빈 영역에서 멀리 떨어진 단락 끝(혹은 섹션 끝)으로 snap해 selection이 "그 아래 전체"로 점프하던 문제. hit 결과 `cursorRect.y`가 실제 cursor y에서 80px 이상 떨어지면 update를 거절하고 last-known focus 유지. **다만 이 시점에는 `cursorRect` 누락 케이스를 못 막음 → 0.2.68에서 보강**

### Fixed — UX 다듬기 4건 (0.2.66)

- **컨텍스트 메뉴 외부 클릭 시 닫힘** — `CellContextMenu` / `AiCommandMenu` / `SlashMenu`의 outside-mousedown 리스너가 `setTimeout(0)` race로 첫 클릭을 놓치는 케이스. 100ms timestamp guard + capture phase 등록으로 교체. trigger 직후의 ghost 이벤트는 무시, 이후 모든 외부 클릭이 메뉴 닫힘
- **드래그 영역 자연스럽게** — `applyPointerToSelection`이 페이지 사이 갭/페이지 외부에서 stale 위치에 머물던 문제. cursor가 어떤 페이지에도 안 닿으면 가장 가까운 페이지로 Y-거리 nearest fallback + 좌표 clamp(±1px). PDF/Word 표준처럼 페이지 끝까지 자연스럽게 확장
- **선택 영역 서식 read-back** — `refreshActiveFormat`이 selection focus end(드래그 끝점)를 읽어 toolbar에 "선택 직후 자리"의 format이 표시되던 문제. selection 활성 시 startOffset+1 (선택의 첫 글자 trailing 위치)에서 읽도록 변경 — Word/Pages 컨벤션 ("Bold 누르면 이 글자에 적용됨")
- **셀 안 caret 안전 폴백** — IR이 `getCharPropertiesAtInCell` getter를 노출하지 않아 셀에서 body 좌표로 읽으면 부정확. 셀이면 read-back 자체를 skip하고 last-known activeFormat 유지

### Added — 3차 UX 라운드 chunks 61~65 (0.2.65)

- **chunk 61 — 룰러 토글**: `--paper` 위에 cm-tick 가로 룰러. View 메뉴 + ⌘K. localStorage `ahwp:show-ruler` 영속
- **chunk 64 — 슬래시 명령**: 빈 body 단락에서 `/` → SlashMenu (제목 1/2/3 + 글머리/번호 + 페이지 나누기). 자체 fuzzy filter + ↑↓ Enter Esc + outside-click. styleList 매칭 후 `applyParagraphStyle` / `toggleList` / `insertPageBreak` 호출
- **chunk 62 — 버전 히스토리**: 명시적 저장마다 `userData/versions/<sha1(path):16>/<ISO>.hwp` 자동 작성 (FIFO 50). 새 IPC 3종 (`file:create-version` / `list-versions` / `read-version`). `VersionHistoryDialog`로 시간순 목록 + 복원 (정식 path에 file.save로 라우트해 `.bak` 자동 생성)
- **chunk 63 — 한국어 맞춤법 검사**: **도입 안 함**. 자체 lightweight rule-based (검출률 한계) vs `hanspell` npm (다음/부산대 외부 endpoint, 3년 stale, deprecated `request` 의존) 모두 부적합. 사용자가 정확도 필요시 chunk 56 selection AI 메뉴 / 일반 채팅으로 요청. 박제: ROADMAP의 "의사결정 박제" 섹션
- **chunk 65 — 다중 창**: `app:new-window` IPC + `AhwpApi.newWindow()` + 메뉴 "파일 → 새 창" (⌘⇧N). main의 `mainWindow` 싱글톤을 active-focused-window 라우팅으로 변경. 메뉴는 `BrowserWindow.getFocusedWindow()` 우선 → 마지막 창 → mainWindow 폴백

### Added — 1차 UX 라운드 chunks 50~55: 명령 팔레트 / 카운터 / 자동 저장 / 단축키 / 다크 종이 / 탭 고정 (0.2.55)

"최고의 문서 수정 프로그램" 격차 분석 후 사용자 가치 큰 6개를 한 묶음으로:

- **chunk 50 — 명령 팔레트 (⌘K)** — 메뉴 액션 + 열린 탭 + 단축키를 한 입력에서 fuzzy search로. 외부 라이브러리 없이 자체 scorer (~80줄). 탭 / 명령 / 최근 카테고리별 색상 배지. 키보드만으로 모든 기능 호출 가능 (↑↓ Enter Esc)
- **chunk 51 — status bar 카운터** — 단어 / 글자 수를 status bar에 항상 표시. dirty 변경 시 200ms debounce로 IR walk (1k 단락 < 5ms). 한국어 어절 카운트 패턴
- **chunk 52 — 자동 저장 (60s 간격 .draft)** — dirty 탭마다 매 분 `<path>.ahwp-draft` 사이드카에 atomic write. 다음 실행에 sidecar가 있으면 "복구하시겠습니까?" confirm. 명시적 저장 시 draft 자동 삭제. file:new temp 파일은 제외
- **chunk 53 — 단축키 치트시트 (⌘/)** — 6개 카테고리 (파일 / 편집 / 서식 / 캐럿·선택 / 네비 / 표·셀)로 정리한 read-only dialog. ⌘K와 동시에 알면 새 사용자 학습 곡선 ↓
- **chunk 54 — 다크 모드 본문 종이 흰색 유지** — `--paper` CSS 변수 신설. 다크 chrome / 본문 페이지는 항상 white. IR의 SVG 텍스트 색상이 hard-coded라 다크 페이지면 본문이 사라지는 문제 회피
- **chunk 55 — 탭 고정 (📌)** — 우클릭 메뉴 "탭 고정" / "고정 해제". 고정 탭은 아이콘 + 좌측으로 자동 정렬 + closeOthers / closeRight bulk close에서 보호. 닫기 시도하면 명시적 confirm

회귀 e2e 5건 (`tests/e2e/round-1-ux.spec.ts`): ⌘K palette 검색 / status bar 카운터 / saveDraft IPC contract / ⌘/ cheatsheet / page paper white in light mode.

다음 라운드 (0.2.60 예정): chunks 56-60 — AI 우클릭 메뉴 / AI inline diff / 목차 사이드바 / PDF 미리보기 / 검색 in 폴더.

### Changed — chunk 49: `ollama` provider 슬롯 제거 → `custom` 통합 (0.2.49)

`Ollama (self-hosted)` provider 슬롯을 별도로 두지 않고 `custom` (OpenAI 호환)으로 통합. 자체 호스팅 Ollama 사용자는 `custom` provider에 base URL `http://localhost:11434/v1`을 입력해 동일하게 사용 가능:

- **이유** — Ollama는 OpenAI 호환 `/v1` shim을 제공하므로 별도 어댑터가 그냥 dead surface area였음. vLLM / LM Studio / on-prem LLM 게이트웨이도 같은 카테고리라 한 슬롯으로 묶는 게 자연스러움
- **`ProviderId` union** — `'ollama'` 제거. `'openai' | 'anthropic' | 'google' | 'nvidia' | 'custom'`
- **`PROVIDERS` 메타** — `ollama` row 제거. `custom` row 유지 (requiresBaseUrl=true)
- **문서 일괄 갱신** — README, CLAUDE.md, ARCHITECTURE / AI_INTEGRATION / TECH_STACK / ROADMAP / PROGRESS 모두 `ollama` 언급을 `custom (OpenAI 호환)` 통합 표기로 교체
- **불변** — 기존 OpenAI / NIM 어댑터 + chunk 48 listModels / 24h 캐시 / datalist UI 그대로

### Added — chunk 48: provider 모델 동적 fetch + 24h 캐시 (0.2.48)

각 provider의 사용 가능한 모델을 API에서 직접 불러와 ChatPanel 모델 입력에 datalist autocomplete으로 노출:

- **Provider 인터페이스 확장** — `Provider.listModels(opts)` optional 메서드 추가. OpenAI는 `GET /v1/models`, NIM은 OpenAI 호환 `/v1/models`(델리게이트), fake은 deterministic 카탈로그 + `BAD-key` 거절 분기
- **24h 디스크 캐시** — `userData/model-cache.json`에 provider별 `{fetchedAt, models}` 영속. `ai:list-models(force?)` IPC가 fresh(<24h)면 캐시 즉시 반환, 아니면 refetch 후 캐시 갱신, refetch 실패 + 캐시 있음이면 `stale-cache`, 둘 다 없음이면 `error`. 새 IPC `ai:clear-models-cache(providerId)`로 수동 무효화
- **ChatPanel UI** — 기존 모델 텍스트 입력은 그대로 유지(자유 입력 우선). 옆에 `<datalist>`로 fetch 결과 autocomplete + 새로고침 버튼(상태에 따라 `↻` / `⟳` / `⚠`). 버튼 title에 사유 노출. provider 변경 + 키 false→true 전이 시 자동 fetch
- **폴백 정책** — listModels 실패는 provider를 비활성화하지 않음. dropdown만 비고 자유 입력은 살아있어 chat은 정상 작동. 사용자에게는 ⚠ 배지 + 툴팁으로 "확인 불가" 상태 노출

회귀 e2e 5건(`tests/e2e/chat-model-list.spec.ts`): listModels ok / error / stale-cache 3가지 IPC 응답 검증 + 새로고침 버튼 상태 + datalist option 노출.

대상 범위: OpenAI / NVIDIA NIM (현재 활성). Anthropic은 Phase 2-B 키 잠금 해제와 함께 추후. Ollama는 별도 어댑터 작성 필요(GET /api/tags) — 후속.

### Added — Phase 2 마무리: chunks 29 / 30 / 34 / 35 (0.2.47)

Phase 2의 잔여 4개 청크를 일괄 완료:

- **청크 29 — AI 변경 되돌리기 토스트** — `applyHtml` / `runTools` 성공 후 "되돌리기" 버튼이 "✓ 적용됨" / "✓ 적용됨 (N/M)" 옆에 함께 노출. 15초 동안 유지되다가 자동 사라짐. 클릭 시 chunk 27의 묶음 undo로 AI 턴 전체를 한 번에 롤백 (도구 N개를 한 응답에서 실행해도 1회 클릭으로 모두 복원). `ViewerHandle.canUndo()` 신설로 undo 가능 여부 검사
- **청크 30 — 채팅 히스토리 인라인 이름 변경** — 📚 popover의 conversation 행에 ✎ 버튼 + 더블클릭 진입. input swap → Enter 저장 (`chatHistory.rename` IPC) / Esc 취소 / blur 시 자동 커밋. 낙관적 로컬 갱신 + IPC 실패 시 SQLite 원본 재조회로 롤백
- **청크 34 — 표 수식 다시 계산** — 셀 우클릭 메뉴에 "수식 다시 계산…" 추가. `TableFormulaDialog`로 수식 입력(`=SUM(A1:A5)`, `=A1+B2*3` 등) → "미리 보기"(write_result=false)로 결과 확인 → "셀에 적용"(write_result=true)으로 셀에 결과 텍스트 작성. `ViewerHandle.evaluateTableFormula(sec, parentPara, ctrl, row, col, formula, writeResult)` 위임
- **청크 35 — 머리말/꼬리말 다중 라인 + 페이지 템플릿** — `HeaderFooterDialog`의 단일 라인 Input을 4행 textarea로 교체. 페이지 템플릿 토글 추가 — 양쪽(applyTo=0) / 홀수(=1) / 짝수(=2) 각각 독립 슬롯으로 IR에 저장. `setHeaderFooterText` 내부에서 `\n` 감지 시 `splitParagraphInHeaderFooter` 호출로 라인별 단락 분리

회귀 e2e 5건(`tests/e2e/phase2-finale.spec.ts`): 머리말 다중 라인 round-trip + 홀/짝 슬롯 독립 + 셀 우클릭 메뉴 "수식 다시 계산…" 노출 + 되돌리기 버튼이 alignment를 right→default로 롤백 + 인라인 rename input swap.

이 4개 청크 마무리로 Phase 2의 사용자-facing 작업은 모두 종료. 후속 잔여(deferred): chunk 31(자동 title summary, AI call 복잡), chunk 32(셀 selection v4, 대형), chunk 33(도형 라인/곡선/그룹, rhwp 0.8 대기), chunk 36(스타일 char/para shape 캡처, rhwp 0.8 대기). Phase 2-G(provider tool-use API 정식 통합 / docId-aware 라우팅 / 다중 턴 자동 실행)는 Phase 3 진입과 병행.

### Added — P0/P1 편집 UX 보강 (visual line nav · shift+click · auto-scroll · Esc-cancel · 저장 보호)

오늘 fix한 UX 회귀 3건과 같은 클래스의 잔여 디테일을 한 묶음으로 보강:

- **ArrowUp / ArrowDown 시각 라인 nav** — `cursorRect` (page-local x/y/height)와 `hitTest`를 조합해 현재 라인의 ±lineHeight × 1.4 위치에서 동일 x의 offset을 찾아 이동. 페이지 경계를 넘어가면 인접 페이지로 자동 전환. Shift 확장도 동일 패턴
- **Shift+클릭 selection 확장** — 기존 selection이 있으면 anchor를 보존하고 focus만 클릭 위치로, 없으면 직전 caret을 anchor로 사용. Word/한컴/PDF 표준 동작
- **드래그 자동 스크롤** — 드래그 중 cursor가 scroll container 위/아래 36px 이내로 들어오면 거리에 비례한 속도(최대 24px/frame)로 `requestAnimationFrame` 루프로 스크롤. 마우스 정지 상태에서도 끝부분에 머물면 계속 스크롤 + selection 확장. PDF reader 표준
- **Esc로 드래그 취소** — 드래그 중 Esc → window 리스너 detach + auto-scroll rAF cancel + 드래그 시작 직전 selection 상태로 롤백
- **`commitCaretMove` 헬퍼** — `handleKeyDown` 내부 6곳에 반복되던 "caretRef 갱신 / shift extend / cursor·toolbar 갱신" 패턴을 하나의 useCallback으로 묶음. 향후 Page Up/Down에 caret 동행 같은 nav 추가 시 동일 helper 재사용. P2-1 keymap dispatch table 분할은 별도 청크로 박제

### Added — 저장 안전망 (`.bak` 백업 + HWPX 라우팅 알림 + 외부 변경 감지)

- **`.bak` 사이드카** — `file:save` / `file:save-as`가 기존 파일을 덮어쓰기 직전 `<target>.bak` 복사본을 한 번 작성. 같은 경로의 후속 저장은 기존 `.bak`를 그대로 둠 (= 편집 세션 시작 직전 상태가 보존됨). 새 파일은 백업 생략. `FileOpenResult.backupPath`로 결과에 노출. 작성 실패는 non-fatal
- **HWPX 자동 라우팅 알림** — 사용자가 `.hwpx`로 저장 요청 시 `@rhwp/core` 라이브러리 한계로 `.hwp`로 자동 라우팅되어 왔지만 무음이었음. `FileOpenResult.routedFrom`에 원래 요청 경로를 실어 보내고, AppShell에서 상단 노란 banner (`data-testid="app-notice"`)로 5초간 표시 + 직접 닫기 버튼
- **외부 파일 변경 감지** — 새 IPC `file:watch-paths(paths[])` + `file:external-change` 이벤트. AppShell이 열린 탭 path 목록을 main에 전달, main에서 단일 chokidar 인스턴스로 watch. 외부 변경 시 (a) 탭 dirty=false면 viewer key bump으로 자동 reload + info 토스트, (b) dirty=true면 warn 토스트로 알림 (덮어쓰기 시 외부 변경분 손실 경고). 우리 자신의 저장은 1.5초 suppression window로 self-loop 방지

### Added — 일반 알림 banner (`<AppShell>` notice slot)

- 작은 status banner를 TitleBar 아래에 가변 슬롯으로 추가 (`info` / `warn` 두 톤). 5초 자동 dismiss + 수동 ✕ 버튼. 향후 다른 비치명 안내(저장 충돌, 권한 거절 등)에서 재사용

### Fixed — UX 회귀 3건 (caret 상태 동기화 / 드래그 / Ctrl+A)

리팩토링 라운드 중 발견된 편집 UX 회귀 3건을 한 묶음으로 수정. 모두 `StudioViewer.tsx`의 `handleKeyDown` + page mouse 핸들러 경로 단일 변경:

- **캐럿 이동 시 툴바 pressed-state 미반영** — 화살표 / Home / End / Cmd+화살표(단어 단위) 캐럿 이동에서 `caretRef`만 갱신하고 `refreshActiveFormat()` 호출이 빠져 있었음. Bold 글자 옆 plain 글자로 캐럿을 옮겨도 Bold 버튼이 계속 눌린 상태로 남았음. 모든 nav 분기에 `refreshActiveFormat()` 추가 (마우스 클릭은 이미 호출 중)
- **드래그 selection이 페이지 경계에서 끊김** — 페이지 div의 `onMouseLeave={handlePageMouseUp}`이 cursor가 페이지를 벗어나는 즉시 드래그를 종료시키고 있었음 (PDF 드래그처럼 일관된 동작 X). 드래그 시 `document` 레벨 mousemove / mouseup 리스너를 `handlePageMouseDown`에서 attach해 페이지 사이 갭·외부 chrome·바깥쪽 mouseup까지 살아남도록 수정. 페이지별 mouseMove/mouseUp/mouseLeave 핸들러는 제거 (window 리스너로 일원화)
- **Ctrl+A가 프로그램 전체 선택** — 키 핸들러에 'a' 분기가 없어 브라우저 기본 selectAll로 빠져 toolbar / sidebar / status bar까지 파랗게 칠해졌음. `Cmd/Ctrl+A` 분기 추가 — 활성 섹션 전체(0번 단락 0번 offset → 마지막 단락 끝)를 IR selection으로 만들고 `preventDefault()`. 추가로 페이지 mousedown 시 `scrollRef.focus({preventScroll:true})`를 호출해 툴바 버튼 클릭 후에도 후속 키 입력이 viewer 핸들러로 들어오도록 보강

회귀 방지 e2e 5종 추가 (`tests/e2e/studio-ux-fixes.spec.ts`): 화살표 nav 후 activeFormat / aria-pressed 검증, Cmd+A 후 IR selection 범위 + 브라우저 selection 비검증, 페이지 외부 mouseup 후 드래그 상태 정상 종료 검증, 페이지 내 드래그 commit 검증.

### Added — Phase 2 청크 38~42: IR-only 기능 UI 노출

이전 라운드에서 IR + ViewerHandle만 구현되고 사용자 UI가 없었던 기능 5종을 일괄 UI로 노출:

- **청크 38: 표/셀 속성 다이얼로그** — 셀 우클릭 메뉴에 "셀 속성…" / "표 속성…" 추가. padding (mm 단위), 셀 간격, 매 페이지 머리행 반복(표), 세로 정렬 / 머리 셀 지정(셀)
- **청크 39: 그림 속성 다이얼로그** — 메뉴 "보기 → 그림 속성…" 진입. `enumeratePictures`로 문서 내 그림 목록 픽커 + 너비/높이 (mm) + 글자처럼 취급 + 삭제 버튼
- **청크 40: 컨트롤 클립보드 단축키** — 메뉴 "편집 → 컨트롤로 복사 / 컨트롤로 붙여넣기" + ⌘⇧C / ⌘⇧V 단축키. 셀 안 캐럿이면 부모 표를 복사, 본문 캐럿이면 같은 단락의 첫 컨트롤(그림/도형/표)을 복사
- **청크 41: HTML 내보내기 메뉴** — "파일 → HTML로 내보내기…" + 새 IPC `file:export-html`. 활성 문서의 본문(첫 1000문단)을 미니멀 `<!DOCTYPE html>` 셸로 감싸서 사용자가 선택한 .html 경로에 저장
- **청크 42: 셀 스타일 적용 우클릭 메뉴** — 셀 우클릭 메뉴에 "스타일 적용…" 추가. `getStyleListJson`으로 명명된 스타일 리스트 → 라디오 선택 → `applyCellStyle`. 셀 배경색·테두리는 라이브러리 한계(KNOWN_ISSUES L-006)로 미리 만든 스타일을 통해서만 적용 가능 — 다이얼로그 설명에 명시

### Changed — UI/UX 1차 리뉴얼 (style_example 기반)

- **워밍 페이퍼 / 잉크 팔레트** — `--background`(off-white #f6f4ef) / `--card`(#fbfaf6) / `--popover`(#ffffff 종이) / `--primary`(deep teal-ink #2b6a6b) / `--muted`(#efece5 chrome) / 다크 모드는 #17171a 베이스 + bright teal #5fb4b3 액센트. 기존 shadcn 토큰 이름은 유지하면서 HSL 값만 교체 — 컴포넌트 레이어 영향 없음
- **커스텀 36px 타이틀바** — macOS는 `hiddenInset`로 신호등 영역만 남기고 OS 타이틀 숨김. Win/Linux는 OS chrome 완전 제거 후 렌더러 측에서 paint. "한" 그라디언트 로고 + ahwp 워드마크 + 활성 파일 basename + dirty dot + 다크 토글 + 설정 버튼. 드래그 영역(`-webkit-app-region: drag`)
- **웰컴 화면 리뉴얼** — 빈 상태에서 "안녕하세요." 인사 + ⌘N "빈 문서로 시작" 카드 + ⌘O "파일 열기" 카드(드래그앤드롭) + 최근 파일 3-col 그리드(종이 미리보기 + HWP 배지 + 상대 시간). 기존 testid (`welcome-new-doc` / `welcome-open`) 유지 — e2e 호환
- **타이포그래피** — 기본 13px / -0.005em letter-spacing. Pretendard 우선, Apple SD Gothic Neo / Malgun Gothic / Noto Sans KR 폴백
- 기존 12px 상단 헤더(편집기 위 ahwp + ThemeToggle) 제거 — 타이틀바가 그 역할 흡수

### Added — Phase 1 잔여 마무리 (탭 DnD + 컨텍스트 메뉴 / temp 정리)

- **탭 드래그 재배치** — 탭 strip에서 탭을 잡아 다른 위치로 드래그. HTML5 native drag (`text/x-ahwp-tab` MIME)
- **탭 우클릭 컨텍스트 메뉴** — 닫기 / 다른 탭 모두 닫기 / 오른쪽 탭 모두 닫기 / 경로 복사 / 파일 관리자에서 보기. dirty 탭이 포함되면 confirm 프롬프트로 데이터 보호. Escape / 외부 클릭으로 메뉴 닫힘
- **temp 파일 자동 정리** — `file:new`로 만들어진 `userData/temp/new-*.hwp` 스크래치 파일을 앱 종료 시 자동 삭제 (will-quit 훅)

### Added — Phase 2 청크 26: 채팅 히스토리 (better-sqlite3 영속)

- **모든 대화 자동 저장 + 다시 열기** — ChatPanel 헤더에 📚 (대화 목록) + ➕ (새 대화) 버튼. 첫 메시지 보낼 때 자동으로 conversation row 생성, 사용자/어시스턴트 메시지 모두 SQLite에 append
- 📚 누르면 활성 문서 기준의 저장된 대화 목록 표시 (최근 업데이트 순). 클릭하면 메시지 복원, × 누르면 영구 삭제
- 활성 문서가 바뀌면 그 문서의 conversation 목록만 보임 — 문서별로 채팅 분리
- DB 위치: `userData/chat-history.db` (WAL 모드, FK cascade로 conversation 삭제 시 messages 자동 삭제). 스키마 마이그레이션은 `PRAGMA user_version` 기반 — 컬럼 추가 시 v2 블록 추가
- IPC: `chat-history:list/get/create/append/rename/delete`. 평소 운영은 `create` → `append(user)` → 스트림 → `append(assistant)` 흐름. 실패는 console.warn으로 fallthrough — 채팅 흐름 차단 안 함
- electron-builder `asarUnpack`에 `better-sqlite3` 등록, vite externalize 추가, electron-rebuild로 native 모듈 빌드

### Added — Phase 2 청크 28: 멀티 문단 발췌 (span anchor 모델)

- **여러 문단에 걸친 selection도 그대로 첨부 가능** — 청크 20·22의 발췌 첨부는 단일 문단으로 한정됐었음. 이제 첫 문단 [startOffset → 끝], 중간 문단 전체, 마지막 문단 [0 → endOffset]을 `\n`으로 묶어 캡처
- `TextRange` 타입 갱신: `paragraphIndex` → `startParagraphIndex` + `endParagraphIndex` (마이그레이션 필요한 외부 코드 없음 — shared/ai-excerpt.ts 외 사용처 없음)
- send-time stale 검증도 다중 문단 anchor를 read-back. 자동 재바인딩 (relocateExcerpt)은 단일 문단 hit만 시도 — 다중 문단은 stale-missing으로 graceful degrade. 사용자가 다시 선택하면 됨
- 칩 라벨이 `¶3..7` 형식으로 span 표시. 시스템 프롬프트의 `[발췌]` 블록 anchor도 동일

### Added — Phase 2 청크 27: 묶음 Undo (AI-applied 턴 한 번에 되돌리기)

- **AI가 한 응답에 여러 op를 실행해도 ⌘Z 한 번에 모두 되돌림** — `runTools`가 `beginUndoGroup` / `endUndoGroup` 브래킷 안에서 N개 op를 실행하므로 사용자에게는 단 하나의 undo 엔트리로 보임
- 직접 편집(타이핑/Backspace 등)은 기존대로 op마다 독립 snapshot. 그룹은 AI dispatcher가 명시적으로 시작·종료할 때만 활성
- 그룹 카운터 방식이라 nested begin/end도 안전. finally로 보장되어 op throw 시에도 group이 정상 종료

### Added — Phase 2 청크 25: 컨트롤 클립보드 (`copyControl` / `pasteControl`)

- 표·도형·이미지 같은 컨트롤 객체를 IR 내부 클립보드에 복사·붙여넣기. 텍스트 클립보드와 분리된 채널 (기존 `copy` / `paste`는 텍스트만)
- ViewerHandle에 `copyControl(sec, para, controlIdx)` / `pasteControlAt(sec, para, charOffset)` 추가
- 향후 표 단위 복사·붙여넣기 단축키, 컨트롤 우클릭 메뉴 통합의 IR 토대

### Added — Phase 2 청크 24: 그림 속성 IR (`getPictureProperties` / `setPictureProperties` / `deletePictureControl`)

- 이미지 컨트롤의 너비·높이·`treatAsChar` 등의 속성을 read/write로 노출. ViewerHandle에 `getPictureProps` / `setPictureProps` / `deletePictureControl` 추가
- 향후 그림 크기 조정 다이얼로그·드래그 리사이즈 UI의 IR 토대. AI 에이전트가 컨트롤 인덱스를 알 때 직접 사용 가능 (ahwp-tools에 추가는 controlIdx 발견 도구가 마련된 후)

### Added — Phase 2 청크 23: 셀 스타일 적용 (`applyCellStyle` IR + ahwp-tools)

- 미리 정의된 named style을 셀에 적용하는 IR + 도구 추가. AI는 `getStyleListJson`으로 색깔 있는 style을 찾아 `applyCellStyle`로 셀에 입힐 수 있음
- **셀 배경색·테두리 직접 setter는 라이브러리 미지원** — `@rhwp/core` 0.7.9의 `setCellProperties`는 padding/spacing/verticalAlign/isHeader만 받음. 직접 색깔 설정은 KNOWN_ISSUES L-006로 박제하고 lib 업스트림 대기
- ahwp-tools 화이트리스트에 `applyCellStyle({sectionIdx, parentParaIdx, controlIdx, cellIdx, cellParaIdx, styleId})` 추가

### Added — Phase 2 청크 22: HTML5 drag UX (StudioViewer selection → ChatPanel)

- **선택 영역을 챗봇으로 드래그** — StudioViewer의 selection rect가 `draggable="true"`가 되어 채팅 입력 폼에 끌어다 놓으면 칩으로 즉시 승격됨. `application/x-ahwp-excerpt` 커스텀 MIME에 `{docPath, anchor, text}`를 직렬화하고 `text/plain`으로 폴백 (외부 앱에 끌면 일반 텍스트로 떨어짐). 청크 20의 버튼 캡처 경로와 동일한 데이터 모델 사용
- 드래그 중 selection rect 커서가 grab/grabbing으로 전환

### Added — Phase 2 청크 21: 멀티 문서 컨텍스트 (target / reference 칩)

- **두 개 이상 탭이 열려 있을 때 다른 문서를 참조 컨텍스트로 추가** — ChatPanel 입력 폼 위 새 칩 행에 활성 탭(🎯 target, 잠김) + 다른 열린 탭(📚 reference, 체크박스). reference에 체크하면 그 문서의 첫 20문단 outline이 시스템 프롬프트의 `[참조 문서]:` 블록으로 주입됨
- "B의 뉘앙스로 A 다듬어줘" 같은 cross-document 요청을 단일 턴에 표현 가능. reference는 읽기 전용으로 명시 — 시스템 프롬프트가 모델에 변경은 활성 문서(target)에만 적용하라고 강제
- 변경 적용 (` ```html``` ` / ` ```ahwp-tools``` `) 은 활성 viewer로만 dispatch되므로 reference 손상 위험 없음 (single-target dispatch 패턴)
- 비활성 탭의 outline은 mount된 viewer에서 직접 읽음 — 추가 마운트·파일 I/O 비용 없음
- NVIDIA NIM `qwen/qwen3.5-122b-a10b`로 라이브 검증 (`nvidia-live.spec.ts` chunk 21 — 모델이 reference doc의 단어를 응답에 인용해 `[참조 문서]` 블록이 도달함을 증명)

### Added — Phase 2 청크 20: 발췌 첨부 (`ExcerptAttachment` + `[발췌]:` 시스템 블록)

- **사용자가 선택한 영역만 AI에 첨부** — 입력 폼 위 `📌 발췌 첨부` 버튼으로 활성 StudioViewer 선택을 칩으로 캡처. 칩이 하나라도 있으면 청크 18의 통째 문서 HTML 대신 `[발췌]:` 블록(번호 + 경로 + anchor + 텍스트)이 시스템 프롬프트에 주입됨 → 토큰 사용량↓, anchor 정확도↑
- 칩은 fresh / stale-relocated(자동 재바인딩, 앰버) / stale-missing(빨강·전송 차단) 3가지 상태. 보낸 시점 IR을 다시 읽어 hash 비교 → 일치 안 하면 문서 전체 1회 스캔(1000문단 상한)으로 같은 텍스트 찾아 anchor 자동 갱신
- 긴 발췌(2000자 초과) ⚠️ 토큰 경고 표시. 하드 캡 16KB
- HTML5 drag-and-drop UX는 SVG selection 모델 침투를 피해 청크 22로 분리 — 데이터 모델·칩 UX·stale check은 이번 청크에 모두 포함
- NVIDIA NIM `qwen/qwen3.5-122b-a10b`로 라이브 검증 (`nvidia-live.spec.ts` chunk 20 — 발췌 sentinel 단어가 응답에 인용되어 `[발췌]` 블록이 모델에 도달함을 증명)

### Added — Phase 2 청크 19: Manual 모드 도구 디스패치 (`ahwp-tools` JSON 블록)

- **AI가 한컴 컨트롤 객체를 직접 다룸** — 청크 18의 ` ```html``` ` 라운드트립이 다루지 못하는 각주·머리말·책갈피·페이지 설정·스타일·도형을 별도 JSON 블록으로 명령
- 어시스턴트 응답에 ` ```ahwp-tools\n{"ops": [...]}\n``` ` 블록 감지 → ops 미리보기 → **"도구 실행"** 버튼 → 화이트리스트 IR 호출 순차 실행. 결과 토스트 (`✓ 적용됨 (5/6)`)
- 11개 tool 카탈로그: `applyHtml` / `applyAlignment` / `applyFontSize` / `applyTextColor` / `toggleCharFormat` / `insertFootnote` / `addBookmark` / `setHeaderFooterText` / `applyPageDef` / `createNamedStyle` / `createRectShape`. `shared/ai-tools.ts`에 합집합 타입 + 인자 검증기로 박제
- **보안** — 화이트리스트 enforcement (등록되지 않은 tool 즉시 거절), `eval` 일체 사용 안 함 (명시적 switch 분기), 사용자 명시 액션(버튼 클릭) 후에만 실행, ops 상한 50개, 시크릿/파일/셸 접근 카탈로그에서 제외
- 시스템 프롬프트가 HTML과 tool의 분리 기준을 명시 — 흐르는 글자·문단 양식 = `applyHtml`, 컨트롤 객체 = 별도 tool
- **provider tool-use API 바인딩은 Phase 3 Agent 모드로 보류** — 청크 19는 응답-텍스트 기반 결정론적 디스패처

### Added — Phase 2 청크 18: HTML 내보내기/붙이기 + ChatPanel 문서 컨텍스트

- **AI 문서 양식 라운드트립** — 채팅 입력란 위에 `📎 현재 문서를 컨텍스트로 첨부` 토글. 활성 시 문서 본문(첫 50문단)을 HTML로 변환해 system 메시지로 자동 첨부
- 어시스턴트 응답에 `\`\`\`html\`\`\`` 블록이 있으면 메시지 하단에 **"문서에 적용"** 버튼 노출 → 클릭 한 번으로 정렬·줄간격·들여쓰기·문단간격·글자 서식이 IR에 반영됨
- 시스템 프롬프트가 한컴 한글 양식 표준(보고서·정렬·간격)을 인라인 스타일 가이드와 함께 명시 — AI가 양식을 보존한 변경분을 안정적으로 작성
- IR 분해 layer: `pasteHtml`은 글자 단위 스타일은 보존하지만 문단 단위(`text-align`/`margin`/`line-height`/`text-indent`)는 무시. `applyHtmlAtCaret`이 DOM walk로 누락분을 `applyParaFormat`으로 다시 적용
- ViewerHandle: `applyHtmlAtCaret(html)` / `exportDocumentHtml(maxParagraphs?)` 신설
- **NVIDIA NIM `meta/llama-3.1-70b-instruct`로 라이브 검증** (e2e `nvidia-live.spec.ts` chunk 18 round-trip — `NVAPI_KEY` 환경 변수 게이트)

### Added — Phase 2 청크 15: 사각형 도형 (MVP)

- 메뉴 "보기 → 사각형 도형…" 또는 `insert:shape` IPC로 다이얼로그 진입
- 너비·높이 (mm) + "글자처럼 취급" 토글로 캐럿 위치에 사각형 도형 삽입
- `createShapeControl` / `getShapeProperties` / `setShapeProperties` / `deleteShapeControl` / `changeShapeZOrder` IR API 직접 위임
- **라인 / 곡선 / 화살표 / 도형 그룹은 후속 청크로 보류** (라이브러리가 createShapeControl JSON에 shape-type 미노출)

### Added — Phase 2 청크 17: 표 / 셀 속성 (padding / spacing / verticalAlign)

- `getTableProperties` / `setTableProperties` / `getCellProperties` / `setCellProperties` IR API 직접 위임
- **현재는 `__studioDebug` + ViewerHandle 노출만** — UI 다이얼로그(셀 우클릭 v4)는 후속
- 셀 배경색·테두리는 별도 `applyCellStyle` 메커니즘 — 후속

### Added — Phase 2 청크 16: 수식 미리보기

- 메뉴 "보기 → 수식 미리보기…" 또는 `insert:equation` IPC로 다이얼로그 진입
- 한컴 수식 script textarea + 라이브 SVG 미리보기 (`renderEquationPreview` IR)
- **본문 삽입은 후속 청크** (라이브러리에 명시적 createEquation 없음)

### Added — Phase 2 청크 14: 스타일 관리 (add / rename / delete)

- 메뉴 "보기 → 스타일 관리…" 또는 `view:style-manager` IPC로 다이얼로그 진입
- 스타일 목록 (id, 이름, 영문명) + 새 스타일 추가 폼 + 인라인 이름 변경 (Enter/Esc/blur) + 삭제 버튼
- id 0 (바탕글) 삭제는 비활성 — 모든 문단의 fallback 타깃이라 dangle 위험
- `createStyle` / `updateStyle` / `deleteStyle` / `getStyleList` IR API 직접 위임
- **스타일에 char/para shape 캡처는 후속 청크로 보류** — 현재는 빈 셸만 생성

### Added — Phase 2 청크 13: 각주 삽입 (MVP)

- 메뉴 "보기 → 각주…" 또는 `insert:footnote` IPC로 다이얼로그 진입
- 현재 커서 위치에 각주 삽입 + 본문 텍스트 한 번에 (단일 라인 MVP)
- `insertFootnote` / `insertTextInFootnote` / `getFootnoteInfo` IR API 직접 위임
- IR 실패(라이브러리 panic 등) 시 다이얼로그 내부 banner로 surface — 닫으면 자동 클리어
- **알려진 한계** — `createBlankDocument` 기반 빈 문서엔 footnote 영역이 정의 안 되어 라이브러리가 panic. 실제 .hwp/.hwpx 파일은 정상 작동
- **각주 안 caret 편집 모델 + 다중 라인 본문은 후속 청크로 보류**

### Added — Phase 2 청크 12: 책갈피 (add / list / rename / delete)

- 메뉴 "보기 → 책갈피…" 또는 `insert:bookmark` IPC로 다이얼로그 진입
- 현재 커서 위치에 이름 붙여 책갈피로 저장 (이름 input + "추가" 버튼)
- 저장된 책갈피 목록 — 각 행에 `§{sec} · ¶{para} · @{charPos}` 위치 + 삭제 휴지통
- `addBookmark` / `getBookmarks` / `renameBookmark` / `deleteBookmark` IR API 직접 위임
- **점프 기능(책갈피 클릭 → caret + scroll)은 후속 청크로 보류**

### Added — Phase 2 청크 11: 머리말 / 꼬리말 (MVP)

- 메뉴 "보기 → 머리말 / 꼬리말…" 또는 `insert:header-footer` IPC로 다이얼로그 진입
- 머리말 / 꼬리말 라디오 토글, 단일 라인 텍스트 입력, 모든 페이지에 적용 (applyTo=0)
- 적용 / 제거 / 취소 버튼. 빈 값 적용 = 슬롯 제거
- `createHeaderFooter` / `insertTextInHeaderFooter` / `getHeaderFooter` / `deleteHeaderFooter` IR API 직접 위임. 덮어쓰기 시 drop & recreate으로 append 방지
- **다중 라인 / 페이지 템플릿(홀수만/짝수만/첫 페이지)은 후속 청크로 보류**

### Added — Phase 2 청크 10: 페이지 설정 (용지 / 방향 / 여백)

- 메뉴 "보기 → 페이지 설정…" 또는 `view:page-setup` IPC로 다이얼로그 진입
- 용지 5종 preset: A4 / A5 / B5 / Letter / Legal + 사용자 정의 (mm 단위 직접 입력)
- 가로 방향 토글, 4 여백 (위·아래·좌·우, mm 단위)
- `setPageDef` / `getPageDef` IR API 직접 위임. mm ↔ HWPUNIT 변환 (1mm = 283.5)
- 적용 시 IR 자동 re-paginate

### Added — Phase 2 청크 9: 셀 합치기 / 나누기 / 병합 해제

- 표 셀 우클릭 메뉴에 4개 신규 항목: **오른쪽 셀과 병합 / 아래 셀과 병합 / 셀 나누기 (2×2) / 병합 해제**. 마지막 행/열에서는 해당 병합 항목 자동 비활성화
- `mergeTableCells` / `splitTableCell` / `splitTableCellInto` IR API 직접 위임 — 합치기는 logical span(rowCount/colCount 유지, cellCount 감소), 분할은 IR 메타 기반 복원

### Added — Phase 2 청크 8: 줄 간격 / 들여쓰기 / 문단 간격 + 하단 status bar

- **하단 status bar** — 한컴 한글 패턴으로 분리. 상단 툴바엔 편집 서식(B/I/U·정렬·폰트·스타일)만, 하단에 undo/redo/zoom(축소·100%·확대·너비맞춤)/dirty/페이지 인디케이터
- **줄 간격** — 확장 toolbar에 셀렉터 (1.0 / 1.15 / 1.5 / 2.0 / 3.0). `applyParaFormat({lineSpacing})` IR 위임
- **들여쓰기 / 내어쓰기** — 두 버튼. `getParaPropertiesAt`로 현재 `marginLeft` 읽어 ±1cm(5670 HWPUNIT) 적용, 0에서 floor
- **문단 간격** — 셀렉터 (없음 / 위 0.5 / 위 1.0 / 위·아래 1.0). `spacingBefore` / `spacingAfter` HWPUNIT

### Added — Phase 2 청크 7: 찾아 바꾸기 (⌘H)

- **찾아 바꾸기** — `Cmd/Ctrl+H` 또는 메뉴 "편집 → 바꾸기…"로 Find bar 확장. 검색어 + 치환어 + "바꾸기" / "모두 바꾸기" 버튼 + 결과 피드백 ("3건 바꿈"). `@rhwp/core`의 `replaceOne` / `replaceAll`에 직접 위임 (case-insensitive). 빈 치환 = 매치 삭제. Enter/Shift+Enter on 치환 input → 단일/모두 바꾸기

### Changed — E2E 인프라

- `examples/` 디렉토리를 git 추적으로 전환. 사용자 .hwp 3개(5.1MB) 커밋. CI/새 클론에서 11 BIG_FIXTURE skip 자동 활성화 → 신규 컨트리뷰터 셋업 단순화
- `playwright.config.ts`에 `retries: 1` 추가. 4 워커 병렬 race(folder-ops DnD / state 전파)는 재시도로 자동 흡수, 진짜 회귀는 두 번 모두 실패해야 카운트되어 마스킹 없음

### Changed — 의존성

- `@rhwp/core` 0.7.8 → 0.7.9 (backward-compatible patch). 신규 메서드 4개: `insertParagraph` / `deleteParagraph` (문단-단위 IR 조작) + `renderPageCanvasLegacy` / `renderPageToCanvasLegacy` (레거시 Canvas 경로 — 즉시 활용 안 함). 시그니처 변경/제거 없음

### Added — paragraph IR ops 게이트 (Phase 3·2-E 대비)

- `__studioDebug.insertParagraph(sec, idx)` / `deleteParagraph(sec, idx)` 노출. 향후 Agent tool 화이트리스트 / Manual diff 흐름에서 안전하게 wire되도록 회귀 게이트 사전 설치 (UI 노출은 Enter/Backspace로 이미 커버되므로 보류)
- e2e 2 케이스 추가 (insertParagraph 인덱스 추가 + deleteParagraph 시프트)

### Added — Phase 2 청크 6: 메시지 액션 (2-C 완료)

- assistant bubble hover 시 액션 툴바 노출 — **복사 / 재생성 / 삭제**. user bubble은 **복사**만
- 복사 직후 1.5초간 ✓ 아이콘으로 시각 피드백
- 재생성 = 같은 user 메시지에 대한 새 응답으로 assistant bubble 갈아치움 (history 보존)
- 삭제 = 단일 메시지만 제거 (preceding user 보존)
- 스트리밍 중엔 모든 액션 툴바 숨김 (race 방지)

### Changed — E2E BIG_FIXTURE 교체

- `studio-bigdoc.spec.ts` / `studio-pagenav.spec.ts`의 fixture를 `(참고)(양식) ★'25년 ... 보고서 서식자료_260127_01.hwp` (57페이지)로 변경. 기존 ~144페이지 `.hwpx`에 의존하던 11 케이스 skip 모두 활성화. 어설션을 fixture-agnostic 하한으로 일반화 (page≥20, find match≥1)
- e2e 결과: 12 skip → **1 skip** (남은 1개는 `nvidia-live` env 게이트)

### Added — Phase 2 청크 5: 채팅 마크다운 + 코드 syntax highlight

- **assistant 메시지 마크다운 렌더링** — `react-markdown` + `remark-gfm` (테이블, 취소선, 작업 리스트, 자동 링크). user 메시지는 plain text 유지(입력 그대로 표시 — 마크다운 깜짝 변환 X)
- **코드 블록 syntax highlight** — `react-syntax-highlighter` PrismLight + 14개 언어 (ts/tsx/js/jsx/py/rust/sql/json/bash/yaml/css/markdown 외). 다크/라이트 테마에 따라 `oneDark`/`oneLight` 자동 매칭
- 외부 링크는 새 탭 + `rel=noreferrer noopener`로 강제 (Electron 렌더러 보안 일관성)
- 번들 영향: renderer 345 kB → 639 kB (gzip 97 → 185 kB)

### Added — Phase 2 청크 4: Settings 모달 + 연결 테스트

- **Settings 모달** (shadcn dialog) — `Cmd/Ctrl+,` 또는 채팅 패널의 "설정 열기" 버튼으로 진입. provider별 row: 라벨 + password 입력 + 저장/연결 테스트/삭제 버튼 + 인라인 결과 메시지. 어댑터가 구현된 OpenAI / NVIDIA NIM만 노출
- **연결 테스트** (`ai:ping` IPC) — 입력란에 타이핑한 transient 키 또는 저장된 키로 provider.ping 호출. 15s 타임아웃. 성공 시 ✓ 연결 정상 / 실패 시 에러 메시지 인라인 표시
- ChatPanel의 키 없을 때 안내가 "DevTools에서 secrets.set..." → "설정 열기" 버튼으로 단순화. UI만으로 BYOK 흐름 완결
- shadcn UI 추가: `Dialog`, `Input` (수동 셋업, `@radix-ui/react-dialog` 도입)

### Added — Phase 2 청크 3: NVIDIA NIM + provider/model 셀렉터 + chat e2e

- **NVIDIA NIM 어댑터** — OpenAI 호환 엔드포인트(`https://integrate.api.nvidia.com/v1`)를 OpenAI 어댑터에 baseUrl만 override해서 위임. SSE 형식 100% 호환 라이브 검증 통과(`meta/llama-3.1-8b-instruct` 1.5s 응답). 자체 호스팅 NIM은 `opts.baseUrl`로 덮어쓰기
- **Provider/Model 셀렉터** — ChatPanel 상단에 provider `<select>` (OpenAI / NVIDIA NIM) + model `<input>` (자유 입력). 두 값 모두 localStorage에 영속, provider별 모델 별도 저장. 키 보유 indicator(●/○) 즉시 갱신
- **Chat e2e 10 케이스** — `tests/e2e/chat.spec.ts`. fake provider(env-gated `AHWP_E2E_FAKE_AI=1`)로 ECHO/ERROR/SLOW 시나리오 + secrets IPC 라운드트립 + 셀렉터 영속 검증. 네트워크 호출 0
- **NVIDIA NIM live smoke** — `tests/e2e/nvidia-live.spec.ts`. `NVAPI_KEY` env 있을 때만 실행 (CI 자동 skip)
- Playwright 4 워커 병렬화 — 132s → 55s (2.4×, 10코어 머신)

### Fixed — chat 스트리밍 race condition (production 영향)

- React 18 자동 배칭 환경에서 `setMessages(prev => …)` updater 실행이 지연될 때, 그 사이 도달한 `done` 이벤트가 `assistantIdRef`를 비워버려 큐된 모든 text-delta가 드롭되던 race. 빠른 SSE 응답에서 첫 글자만 보이고 멈추는 증상으로 발현. id를 listener 진입 시점에 eagerly capture하도록 수정

### Added — Phase 2 토대: BYOK + OpenAI 채팅 (스트리밍)

- 우측 패널이 placeholder에서 **채팅 패널**로 전환 — 메시지 리스트 + textarea + 전송/중단 버튼. Enter 전송, Shift+Enter 줄바꿈, IME composition 가드. 스트리밍 중 중단(abort)이 main의 AbortController까지 전파
- **OpenAI 어댑터** (스트리밍 SSE) — 기본 `gpt-4o-mini`. base URL override 지원. `done` 이벤트에 token usage 동봉
- **BYOK secrets 토대** — `safeStorage.encryptString` 기반 영속 (`userData/secrets.json`, mode 0o600). 평문 키는 main 프로세스에만 머무르며, renderer는 `has`/`list`만 노출 (`secrets.get`은 IPC 미공개). AI 요청은 main에서 secret을 합쳐 어댑터에 주입
- **`ai:chat` 스트리밍 IPC** — id 기반 채널, 인플라이트 `AbortController` 레지스트리, 종료성 보장 (모든 스트림은 정확히 한 번의 `done` 또는 `error`로 종료)
- **`Provider` 타입 계약** (`shared/ai.ts`) — `ProviderId` 6종 (OpenAI / Anthropic / Google / NVIDIA NIM / Ollama / Custom), `PROVIDERS` 메타 (requiresApiKey / requiresBaseUrl), `ChatRequest` / `ChatStreamEvent` / `Provider` 인터페이스. 나머지 4개 어댑터는 다음 청크들

> **사용 안내** — Settings UI는 다음 청크. 현재는 ChatPanel 상단 셀렉터에서 provider 선택 후, DevTools에서 `await window.api.secrets.set('openai', 'sk-...')` 또는 `secrets.set('nvidia', 'nvapi-...')` 실행 → 즉시 사용 가능

### Added — Phase 1-C 확장: 표 / 이미지 / 리스트 / 페이지 나누기 + 확장 툴바

- 표 — 8×8 hover grid TablePicker로 삽입. 셀 편집 v1~v3:
  - v1: 셀 클릭 → 타이핑 → 백스페이스 (`*InCell` IR 경로로 라우팅)
  - v2: Tab / Shift+Tab 셀 사이 순회 (행우선) + 인-셀 B/I/U + 폰트 크기/색상/정렬
  - v3: 우클릭 컨텍스트 메뉴 — 위/아래 행 추가, 좌/우 열 추가, 행/열 삭제, 표 삭제
- 이미지 삽입 — 툴바 (2번째 행) "이미지 삽입" 버튼 또는 OS 파일 드래그. 자연 픽셀 크기 디코드 + HWPUNIT 변환 + 텍스트 영역 폭 (~16cm)으로 clamp
- 리스트 — 글머리 기호 / 번호 매기기 (selection-aware 토글)
- 페이지 나누기 — caret에 `insertPageBreak`. 페이지 카운트 자동 갱신
- 확장형 툴바 — 더보기 버튼으로 두 번째 행 토글 (리스트 / 페이지 나누기 / 표 / 이미지 / 보기 토글)
- 보기 토글 — 제어문자 표시 / 투명 테두리 표시
- 폴더 트리 단축키 (Finder / Explorer / VS Code 패리티) — ↑↓ 탐색, ←→ 접기·펼치기·점프, ⌘N 새 파일, ⌘⇧N 새 폴더, ⌘C·⌘X·⌘V 파일 복사·이동 (`folder:copy` IPC, 충돌 시 `" (1)"` 디스앰비귀에이션)

### Added — Phase 1-C: 자체 Studio viewer + `@rhwp/core` 직접 통합

- HWP/HWPX 뷰어 — **자체 Studio viewer** (`src/features/studio/`). 멀티 페이지 lazy SVG, 키보드/마우스/IME, 시각 커서, dirty 추적. (이전 `@rhwp/editor` iframe은 청크 6에서 제거)
- HWP → HWPX 자동 변환 (`electron/hwp/converter.ts`) — `@rhwp/core` (Rust+WASM 4.5MB) lazy init + `init_panic_hook` + `version()` 로깅. 동적 import로 ESM/CJS 호환성 처리
- 저장 IPC: `file:save` / `file:save-as` — `@rhwp/core` 라운드트립 정규화 + 매직바이트 기반 `.hwp` ↔ `.hwpx` 자동 라우팅 (KNOWN_ISSUES L-001 — 임베드 이미지 보존을 위해 canonical은 HWP)
- 워크스페이스 복원 — `userData/session.json`에 `lastFolderPath` + `lastActivePath` + `openTabPaths` 영속. 앱 재시작/새로고침 시 자동 복원
- 탭 시스템 — 다중 파일, dirty 점, X 닫기, ⌘W, 미들 클릭, openTabPaths 영속. 모든 탭은 `display:none`으로 mount 유지 (HwpDocument + undo 보존)
- 편집 기능 풀 — 텍스트 편집/IME, 선택 모델 (mouse drag / shift+arrow / 더블·트리플 클릭 / ⌘⇧Arrow), B/I/U + 문단 스타일 + 정렬 + 폰트 크기/색상, Undo/Redo (100 entry), Copy/Cut/Paste (시스템 클립보드 브리지), Find ⌘F (매치 하이라이트), 페이지 네비 (PageUp/Down, ⌘Home/End)
- Playwright Electron E2E — 134/134 (smoke + 폴더트리/ops/단축키 + 탭/스크롤 + 스튜디오 청크 1~12 + 표 셀 v1~v3 + 이미지 + 확장 툴바 + 144페이지 부하)

### Added — Phase 1-B: 파일 IPC + 최근 파일 + 드래그앤드롭

- 파일 열기 IPC — `file:open` (네이티브 다이얼로그, .hwp/.hwpx 필터) / `file:open-by-path` (DnD/recent용, 확장자+존재 검증)
- 최근 파일 영속 — `userData/recent.json`, LRU max 20, atomic write (tmp+rename), in-memory 캐시 + 직렬화된 쓰기 체인
- 좌측 패널: `FileList.tsx` 컴포넌트. 최근 파일 목록(파일명 + 상대 시간), 활성 파일 하이라이트, 드롭 zone 오버레이, 빈 상태 ⌘O 안내
- 드래그앤드롭 — Electron 32+에서 제거된 `File.path` 대신 `webUtils.getPathForFile`을 preload에서 노출

### Added — Phase 1-A: 레이아웃 + UI 토대

- 리사이저블 3-Pane (`AppShell.tsx`) — `react-resizable-panels` v2 (v4는 API 개명). 패널 비율 localStorage 영속
- shadcn/ui 수동 셋업 — `components.json`, `cn()` 헬퍼, 토큰 확장된 Tailwind, `:root`/`.dark` CSS 변수, Button 컴포넌트
- 라이트/다크/시스템 테마 토글 — `localStorage` 영속, `matchMedia('prefers-color-scheme: dark')` 구독
- 네이티브 앱 메뉴 (`electron/menu.ts`) — File / Edit / View / Window / Help (macOS 별도 앱 메뉴 포함). 파일·설정 액션은 `webContents.send('menu:action', ...)` 이벤트로 렌더러에 전달
- IPC: `MenuAction` 유니언 + `onMenuAction(handler)` 구독 API

### Added — AI 통합 설계 / 문서

- AI 백엔드 매트릭스에 NVIDIA NIM 추가 — OpenAI 호환 어댑터 경로 재사용 (호스티드 `integrate.api.nvidia.com` 또는 셀프호스트)
- 단일 API 웹검색 매트릭스 — OpenAI Responses `web_search` ✅ / Anthropic `web_search` server tool ✅ / Google `googleSearch` grounding ✅ / NVIDIA NIM·Ollama·커스텀 ❌ (외부 검색 서비스 필요)
- ARCHITECTURE.md SQLite 스키마에 `versions` 테이블 추가 — 풀 카피 + HWPX BLOB 방식. Phase 2 도입 예정

### Added — Phase 0: 부트스트랩

- Electron + Vite + React + TypeScript 프로젝트 셸
- 3-Pane 더미 레이아웃 (좌: 파일 placeholder / 중: 에디터 placeholder / 우: 챗봇 placeholder)
- Main ↔ Renderer IPC 핑·퐁 (`ipc:ping`)
- 보안 격리 (sandbox: true, contextIsolation: true, nodeIntegration: false)
- `shared/api.ts` — 메인↔렌더러 공유 IPC 타입 정의
- Tailwind CSS 3.4 셋업 (한글 폰트 폴백 포함)
- ESLint 10 flat config (typescript-eslint + react-hooks + react-refresh + prettier)
- Prettier 3.8 + .editorconfig
- Vitest 4 + Testing Library + jsdom (`App.test.tsx` 2 passing)
- Husky pre-commit + lint-staged
- electron-builder 설정 (mac dmg / win NSIS / linux AppImage·deb)
- GitHub Actions Release (`.github/workflows/release.yml`) — `v*` 태그 시 3 OS 매트릭스 빌드
- PR 템플릿 (`.github/PULL_REQUEST_TEMPLATE.md`)
- 진행 상황 문서 (`docs/PROGRESS.md`)
- `.gitignore`에 Electron 빌드 산출물 추가 (`dist`, `dist-electron`, `release`)

### Changed

- 패키지 매니저: pnpm → npm (corepack EPERM 이슈 회피)
- `tsconfig.json` `include`에 `vitest.setup.ts` 추가 — `@testing-library/jest-dom/vitest` 타입 augmentation 적용 (`toBeInTheDocument` TS2339 사전 존재 이슈)
- `tsconfig.node.json` `include`에 `tests`, `vitest.config.ts`, `playwright.config.ts` 추가
- `.gitignore`의 Python `lib/` 규칙을 루트 한정(`/lib/`)으로 변경 — `src/lib/`이 ignore되던 문제 해결
- 다이얼로그 필터 — `file:save-as`에서 HWP 옵션 제거. 항상 HWPX (`@rhwp/core` 정규화 결과 일치)
- 렌더러 측 매직바이트 라우팅 제거 — 서버가 `@rhwp/core`로 정규화 후 자동 보정. 단순화

### Removed

- 서버 측 `assertFormatMatchesPath` — `@rhwp/core` 정규화로 항상 HWPX 출력하므로 미스매치 발생 불가, 중복 검증 제거
- 우리 측 'unknown format' 사전 검증 — `HwpDocument` 생성자가 잘못된 입력에 throw, 중복 제거

### Performance

- `@rhwp/core` WASM 앱 부팅 시 pre-init (`main.tsx`) — 첫 파일 열기의 ~100~200ms 콜드 컴파일 stall 제거
- Off-viewport 페이지 unmount + lazy-render 통합 (단일 rAF-throttled 스크롤 핸들러) — 144페이지 문서 메모리 ~30MB → ~2MB (≤11 페이지 마운트). 페이지 SVG 캐시는 string으로 보존, 재진입은 DOM parse만 (WASM 재호출 X)
- Find paragraph 텍스트 캐시 — incremental 키 입력 cold 4ms → warm 0.3ms (10×~14× 가속, 144페이지 / 2656 문단 기준)
- Inactive-tab guard — `clientHeight === 0` 시 lazy-render bail (탭 스팸 시 N×6 페이지 렌더 회피)

### Infrastructure

- Playwright + Electron 도입 (`@playwright/test`) — `npm run e2e` / `npm run e2e:headed`
- CI 트리거를 PR-only로 축소 (`.github/workflows/ci.yml`) — solo 작업 단계 push 알림 노이즈 제거. 메이저 게이트는 PR과 `workflow_dispatch`로 유지. Node 22 LTS, `HUSKY=0` 안전망

### Notes

- 브랜치(`main`/`dev`) 분리는 메인테이너가 수동 적용 필요 — [CONTRIBUTING.md](CONTRIBUTING.md) "처음 셋업"
- AI 챗봇 / 멀티 provider 어댑터 / 채팅 히스토리는 Phase 2부터 도입
- better-sqlite3 도입은 Phase 2 (채팅 히스토리)와 같이 — 현재는 JSON 단일 파일 영속만
