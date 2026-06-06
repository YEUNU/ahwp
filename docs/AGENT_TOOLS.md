# Agent Tool Catalog Reference

Phase 3 Agent 모드의 도구 카탈로그. **`shared/ai-tools.ts`의 `AHWP_TOOL_NAMES`** 가 단일 진실 원천이고 이 문서는 사람이 읽기 쉬운 reference.

---

## 사용 흐름 요약

1. **Manual 모드** (chunk 19): AI가 응답에 ` ```ahwp-tools``` ` JSON 블록을 작성하면 사용자가 "도구 실행" 버튼 클릭
2. **Agent 모드** (chunks 37~41): AI가 provider native tool-use API 로 직접 호출 → 자동 dispatch + 묶음 undo

두 모드 모두 같은 카탈로그(`shared/ai-tools.ts`) + 같은 validator(`validateToolCall`) + 같은 dispatcher(`src/features/chat/tools.ts`) 를 공유. 보안/일관성 양쪽 이익.

---

## 안전성 가드

- **whitelist only** — `AHWP_TOOL_NAMES` 외 호출 거부 (`unknown_tool`)
- **schema validate** — 모든 args 는 dispatch 전 `validateToolCall` (`shared/ai-tool-validate.ts` — defineTool 레지스트리의 per-tool validator) 통과 (`ok: false` 면 거절)
- **sandbox** — 대부분 viewer IR 호출만. 외부 세계 도구(`webFetch` / `webSearch` / `runCommand` / `runAgent`)는 별도 게이트·허용목록 + 자체 cap 으로 분리 (`runCommand` 는 기본 OFF + allowlist)
- **부분 성공 모델** — 한 op 실패해도 다음 op 계속 (Agent turn 자체는 안 멈춤)
- **묶음 undo** — `runTools` 가 `beginUndoGroup` / `endUndoGroup` bracket → ⌘Z 1회로 turn 전체 롤백
- **op 상한** — 블록당 50, Agent turn cap 기본 50 (사용자 조정 가능, hard cap 200)

---

## 카탈로그 (75 tools — 55 write + 20 read)

> 권위 소스는 `shared/ai-tools-defined/*.ts` (defineTool) 이며 `shared/ai-tools.ts` 의
> `AHWP_TOOL_NAMES`(75) + `READONLY_TOOL_NAMES`(20) 가 단일 화이트리스트. 아래 A–H 표는
> 초기(0.3.x) 스냅샷이라 다음 ~19개가 빠져 있다 — 셀 쓰기(`insertTextInCell` / `replaceTextInCell` /
> `fillFormCells`), 읽기(`getDocumentSummary` / `getColumnDef` / `getFootnoteAtCursor` /
> `getEmptyFormFields` / `getPageSvg`), 수식·각주(`insertEquation` / `deleteFootnote` /
> `deleteEquationControl`), 워크스페이스·교차문서(`searchWorkspaceOutlines` / `readParagraphByPath` /
> `switchTargetDoc`), 외부·에이전트(`webFetch` / `webSearch` / `runCommand` / `runAgent` / `updatePlan`).

### A. 본문 편집 — 텍스트/단락 primitives (5)

| 이름              | 설명                                                            |
| ----------------- | --------------------------------------------------------------- |
| `insertText`      | 특정 위치 (sectionIdx, paragraphIdx, charOffset) 에 텍스트 삽입 |
| `deleteRange`     | paragraph/offset 범위 텍스트 삭제 (단락 across 가능)            |
| `insertParagraph` | paragraphIdx 위치에 새 단락 삽입 (분리)                         |
| `deleteParagraph` | 단락 통째 삭제 (앞 단락에 합쳐짐)                               |
| `mergeParagraph`  | 이 단락을 다음 단락과 합치기                                    |

**예 — "안녕" 을 첫 단락 시작에 삽입**:

```json
{
  "tool": "insertText",
  "args": {
    "sectionIdx": 0,
    "paragraphIdx": 0,
    "charOffset": 0,
    "text": "안녕"
  }
}
```

### B. 글자/단락 서식 (5 + applyHtml 합 6)

| 이름               | 설명                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| `applyHtml`        | HTML 조각 적용 (caret). 한꺼번에 여러 단락/표/스타일 변경. sledgehammer                 |
| `applyAlignment`   | 정렬 변경 (left/center/right/justify). selection 또는 caret 단락                        |
| `applyFontSize`    | 글자 크기 (pt) 변경                                                                     |
| `applyTextColor`   | 글자 색 (#RRGGBB) 변경                                                                  |
| `toggleCharFormat` | 진하게/기울임/밑줄 토글 (bold/italic/underline)                                         |
| `applyCharFormat`  | **통합 char format** — props 객체로 폰트/색/취소선/첨자/밑줄종류 등 한 호출             |
| `applyParaProps`   | **통합 para props** — alignment/lineSpacing/indent/spacingBefore-After/marginLeft-Right |
| `applyStyle`       | 명명된 스타일 (id) 적용                                                                 |

**`applyCharFormat` props 키** (lib applyCharFormat props_json):

- `bold`, `italic`, `underline` (boolean)
- `strikeThrough`, `subscript`, `superscript` (boolean)
- `name` (font family string), `size_hu` (HWPUNIT, pt × 100)
- `color`, `shadeColor` (#RRGGBB int)
- `underlineLine`, `outline`, `shadow`, `emboss`, `engrave` (lib enum/bool)

**`applyParaProps` props 키**:

- `alignment` ('left' | 'center' | 'right' | 'justify')
- `lineSpacing` (percent of single line, 100 = 1.0)
- `lineSpacingType` ('Percent' | 'Fixed' | 'AtLeast')
- `spacingBefore`, `spacingAfter` (HWPUNIT)
- `marginLeft`, `marginRight`, `indent` (HWPUNIT, indent: + 첫줄 / − hanging)

**예 — 굵게 + 빨간색 한 호출**:

```json
{
  "tool": "applyCharFormat",
  "args": {
    "sectionIdx": 0,
    "paragraphIdx": 5,
    "startOffset": 0,
    "endOffset": 10,
    "props": { "bold": true, "color": 16711680 }
  }
}
```

### C. 표 구조 (12)

| 이름                   | 설명                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `createTable`          | 특정 위치에 N×M 표 생성 (행/열 1~100/50)                                      |
| `insertTableRow`       | 행 1개 삽입 (below: true=아래 / false=위)                                     |
| `insertTableColumn`    | 열 1개 삽입 (right: true=오른쪽 / false=왼쪽)                                 |
| `deleteTableRow`       | 행 1개 제거                                                                   |
| `deleteTableColumn`    | 열 1개 제거                                                                   |
| `mergeTableCells`      | (startRow, startCol)~(endRow, endCol) 사각 영역 셀 병합                       |
| `splitTableCellInto`   | 셀 1개를 nRows × mCols 로 분할                                                |
| `unmergeCell`          | 병합된 셀 unmerge                                                             |
| `setTableProperties`   | 표 전체 속성 (props lib JSON)                                                 |
| `setCellProperties`    | 셀 1개 속성 (props lib JSON, 셀 배경색은 KNOWN_ISSUES L-006 으로 스타일 경유) |
| `evaluateTableFormula` | HWP 수식 평가 (=SUM(A1:A5), =A1\*B2). writeResult=true 면 결과 셀에 작성      |
| `deleteTableControl`   | 표 컨트롤 통째 삭제                                                           |
| `applyCellStyle`       | (B 카테고리에도 해당) 명명된 스타일을 셀에 적용                               |

### D. 이미지/도형 (6 + 기존 createRectShape 합 7)

| 이름                   | 설명                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `createRectShape`      | 사각 도형 컨트롤 삽입 (caret). width/height HWPUNIT         |
| `setPictureProperties` | 이미지 속성 (width/height/treatAsChar 등)                   |
| `deletePictureControl` | 이미지 컨트롤 삭제                                          |
| `setShapeProperties`   | 도형 속성 (props lib JSON)                                  |
| `deleteShapeControl`   | 도형 컨트롤 삭제                                            |
| `changeShapeZOrder`    | Z 순서 변경 (top/bottom/forward/backward)                   |
| `insertPicture`        | 이미지 삽입 (base64 PNG/JPEG/GIF/BMP). width/height HWPUNIT |

### E. 페이지/섹션 (5 + applyPageDef 합 6)

| 이름                | 설명                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `applyPageDef`      | 페이지 설정 (margin/orientation/size 등). props lib pageDef JSON             |
| `insertPageBreak`   | 페이지 나누기 삽입                                                           |
| `insertColumnBreak` | 단 나누기 삽입 (다단 layout 시)                                              |
| `setColumnDef`      | 섹션 다단 정의 (count 1~10, type 0=Newspaper/1=BalancedNewspaper/2=Parallel) |
| `setSectionDef`     | 섹션 정의 변경 (props lib SectionDef JSON)                                   |
| `setPageHide`       | 페이지의 머리말/꼬리말/테두리/배경/페이지번호 숨김 토글                      |

### F. 머리/꼬리말 (3 + setHeaderFooterText 합 4)

| 이름                  | 설명                                                   |
| --------------------- | ------------------------------------------------------ |
| `setHeaderFooterText` | 머리/꼬리말 텍스트 1번에 설정 (빈 문자열 = 제거)       |
| `applyHfTemplate`     | 머리/꼬리말 템플릿 적용 (templateId lib enum)          |
| `createHeaderFooter`  | 빈 머리/꼬리말 슬롯 생성 (applyTo 0=both/1=odd/2=even) |
| `deleteHeaderFooter`  | 머리/꼬리말 슬롯 통째 삭제                             |

### G. 책갈피 / 각주 / 스타일 (5)

| 이름               | 설명                                                            |
| ------------------ | --------------------------------------------------------------- |
| `addBookmark`      | 현재 caret에 책갈피 추가                                        |
| `deleteBookmark`   | 좌표 (sectionIdx, paragraphIdx, controlIdx) 의 책갈피 삭제      |
| `insertFootnote`   | 현재 caret에 각주 삽입 + 본문 텍스트                            |
| `createNamedStyle` | 빈 명명 스타일 셸 추가 (이름만, shape 파라미터는 rhwp 0.8 대기) |

### H. Read tools — 능동 검사 / 양식 매칭 (chunk 51, 9 tools)

mutation 0. Agent 가 turn 안에서 능동적으로 문서 상태를 검사 → 양식
매칭 / 위치 결정 / 본문 검색 등에 사용. 결과는 다음 turn 의 tool_result
메시지에 JSON 직렬화 (4096B cap) 되어 회신.

| 이름                  | 반환                                             | 용도                                                  |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `getDocumentOutline`  | `{paragraphIndex, level, text}[]` 제목 단락 목록 | 문서 구조 파악 / 어디 들어갈지 결정                   |
| `getStyleListJson`    | `{id, name, englishName}[]` 사용 가능 스타일     | applyStyle 매칭할 styleId 카탈로그                    |
| `getStyleAt`          | `{styleId, charShape, paraShape, ...}`           | 특정 단락의 활성 styleId + 상세                       |
| `getCharPropertiesAt` | `{name, size_hu, color, bold, italic, ...}`      | 좌표 위치의 글자 서식 (matching applyCharFormat 입력) |
| `getParaPropertiesAt` | `{alignment, lineSpacing, indent, spacing, ...}` | 단락 서식 (matching applyParaProps 입력)              |
| `getTextRange`        | string (4096B cap, trim)                         | 본문 인용 / 근거 추출                                 |
| `getCaretPosition`    | `{sectionIndex, paragraphIndex, charOffset}`     | 현재 caret 좌표 (사용자 의도 위치)                    |
| `findInDocument`      | `{sectionIdx, paragraphIdx, charOffset}[]`       | 키워드 검색 (case-sensitive, max 200, query 1024B)    |
| `getCellInfo`         | `{row, col, rowSpan, colSpan, ...}`              | 셀 메타 (병합 상태 검증)                              |

**핵심 시나리오 — "내 주장 X 추가" (사용자 막연 요청)**:

```
1. getCaretPosition → {paragraphIndex:5, charOffset:42, ...}
2. getStyleAt(0, 5)  → {styleId:0, name:"바탕글", paraShape:{...}}
3. getParaPropertiesAt(0, 5) → {alignment:"justify", lineSpacing:160, ...}
4. (LLM 추론: 인접 양식 그대로 사용 결정)
5. insertParagraph(0, 6) → 새 단락 6
6. insertText(0, 6, 0, "내 주장: ...") → 텍스트 삽입
7. applyStyle(0, 6, 0) → "바탕글" 스타일 적용
8. applyParaProps({alignment:"justify", lineSpacing:160}) → 양식 매칭
```

총 8 호출 (cap 10 안). 묶음 undo 1회로 전체 롤백.

**우선순위**:

1. **`applyStyle`** (named style id) — 같은 양식 재사용 가독성 / 회귀 안전성 best
2. **`applyParaProps` / `applyCharFormat`** — props 직접 (named style 매칭 안 될 때)
3. **`applyHtml`** — sledgehammer (여러 단락 한꺼번에 변경 / Manual 모드 호환)

---

## Agent 호출 시 제약/주의사항

### 좌표 시스템

모든 좌표는 **0-indexed** (sectionIdx=0 이 첫 섹션, paragraphIdx=0 이 첫 단락 등). 단위:

- **char offset**: 0-indexed character position
- **HWPUNIT**: 1mm ≈ 28.35 HWPUNIT, 1pt ≈ 100 HWPUNIT (size_hu)
- **color**: int (#RRGGBB → `R << 16 | G << 8 | B`)

### selection vs caret

- `applyCharFormat` 은 명시적 (paragraphIdx, startOffset, endOffset) 받음 — selection 없어도 작동
- `applyParaProps`, `applyAlignment`, `applyFontSize`, `applyTextColor`, `toggleCharFormat` — 활성 selection 또는 caret 단락에 적용 (`BridgeIrHelper` 가 iframe 내부 rhwp-studio 의 `WasmBridge` 로 라우팅)

### lib 한계 / KNOWN_ISSUES

- **L-006** (부분 해결): 셀 배경색 직접 setter 없음 — `applyCellStyle` 로 스타일 경유. 0.7.14 의 `updateStyle` / `updateStyleShapes` 로 named style 사후 update 가능
- **L-008** (부분 해결): 0.7.14 가 `getShapeBBox` 추가 — 도형/이미지 bbox 획득 가능 (generic `getControlBBox` 는 아직 부재)
- `createNamedStyle` 빈 셸 한계는 0.7.14 `updateStyle` / `updateStyleShapes` 로 해소

---

## 신규 도구 추가 절차 (0.7.4+ — defineTool)

1. 해당 카테고리 파일 `shared/ai-tools-defined/<category>.ts` 에 `defineTool({...})` 항목 추가 — JSON Schema + `validate` + `readonly`/mode 메타를 한 곳에 co-located
2. 그 모듈의 named export + `shared/ai-tools-defined/index.ts` 의 수집에 포함
3. `shared/ai-tools.ts` 의 `AHWP_TOOL_NAMES` 에 이름 추가 (read-only 면 `READONLY_TOOL_NAMES` 에도)
4. `AhwpToolArgs` 인터페이스에 args 타입 추가
5. `src/features/chat/tools.ts` 의 `runOne` switch 에 dispatch 케이스 추가 — 디스패처가 `BridgeIrHelper` 로 iframe 내부 rhwp-studio 의 `WasmBridge` 를 호출 (구 self-mounted `StudioViewer`/`ViewerHandle` 아님)
6. e2e 회귀 가드 추가 (`tests/e2e/chat-*.spec.ts` 또는 fake provider TOOL: 모드)

> 0.7.3 까지의 `TOOL_DESCRIPTORS` 배열 + `validateArgs` switch 는 0.7.4 에서 완전 제거됨
> (schema 만 추가하고 validator 누락하는 drift 회귀 방지). `shared/edit-protocol.ts` 도 없음 —
> diff/patch 스키마는 `shared/ai-patches.ts`, 도구 정의는 defineTool 레지스트리가 단일 source.

---

## 통계 (0.7.50 기준)

- 총 도구: **75개** = write 55 + read 20 (`AHWP_TOOL_NAMES` 75 / `READONLY_TOOL_NAMES` 20)
- 카테고리 파일 (`shared/ai-tools-defined/`): format / cell / table / shape / page / read / web / bash / agent
- 한컴 한글 lib (`@rhwp/core` 0.7.14) 의 주요 mutation API 광범위 커버
- 능동 검사 (read) 20개로 Agent 가 양식 매칭 / 위치 결정 / 인용 탐색 / 시각 검증(`getPageSvg`) 가능
- 외부·에이전트 도구: `webFetch`/`webSearch` (0.7.7), `runCommand` (0.7.9 bash, 기본 OFF), `runAgent` 서브에이전트 (0.7.11), `updatePlan` (0.7.29)
