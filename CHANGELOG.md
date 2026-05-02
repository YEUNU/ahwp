# Changelog

이 파일은 ahwp의 사용자 영향 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/) 을 따릅니다.

## [Unreleased]

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
