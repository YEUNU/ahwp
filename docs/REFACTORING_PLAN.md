# Refactoring Plan

ahwp 0.3.6 시점 codebase 리팩토링 청사진. **목표는 동작 변경 0** — 사용자 영향 없이 유지보수성과 안전성만 끌어올린다. 신규 기능 작업과 분리해서 별도 phase 로 진행 (`refactor/*` 브랜치).

## 진행 상황

- ✅ **R1.0** (commit `8fa0a67`, 2026-05-03) — pure utils 추출.
  `parsePageDimensions` + `relocateExcerpt` → `utils/`. 단위 테스트 12개
  추가 (3 → 15). StudioViewer.tsx -72 라인 (9610 → 9538). 회귀 0.
- ✅ **R1.1** (2026-05-03) — `useDocumentLifecycle` 추출.
  doc-load effect (~150 라인) → `hooks/useDocumentLifecycle.ts` (312 라인,
  타입 인터페이스 포함). caller 가 ref + setter 를 opts 로 명시 주입 —
  closure 캡처 0. StudioViewer.tsx -140 라인 (9538 → 9398). lint /
  typecheck clean, unit 15/15, studio e2e 11/11 회귀 0.
- ⏳ **R1.2** — `useUndoHistory` 추출. 다음 세션 시작점.

---

## 0. 측량 (현재 상태)

```
                                LOC    hooks  try/catch
src/features/studio/StudioViewer.tsx   9610   172     193   ← 절대 비대
src/features/chat/ChatPanel.tsx         2396    95      19
src/app/AppShell.tsx                    1545    76       6
shared/ai-tools.ts                      1965    —       —   (data-heavy)
```

- e2e: 272 케이스 (studio 213 + chat 57 + about 1 + 1 skipped) — 회귀 가드 충분
- lint: 4 warnings (모두 `react-hooks/exhaustive-deps`, 의도적)
- 단위 테스트: 3 (App.test.tsx — 골격만)
- `Record<string, unknown>` 사용: 62회 (lib JSON props 우회)
- Cell + Path branches: `*InCell` / `*ByPath` 33 호출, 분기 3개 그룹에 흩어져 있음

---

## 1. 목표 / 비목표

### 목표 (priority order)

1. **거대 파일 분해** — 한 파일 9600 라인은 인지 부하 + IDE 성능 + git blame 모두 손해. 도메인 / lifecycle / 책임 단위로 나눈다.
2. **테스트 가능성** — pure logic 을 React 컴포넌트에서 분리하면 단위 테스트가 가능해진다 (현재는 e2e 만으로 모든 검증).
3. **타입 안전성** — `Record<string, unknown>` 을 lib 응답 형태에 맞춰 narrowing.
4. **에러 처리 일관성** — 193개의 `try { ... } catch { console.warn(...) }` 패턴을 helper 로 일원화.
5. **InCell / ByPath 분기 통합** — 지금은 같은 op 에 대해 2~3개 lib API 를 if 분기로 부르는 코드가 흩어져 있음. helper 로 추상화.

### 비목표

- 동작 변경 / 새 기능 / 새 의존성 추가
- 외부 contract (`ViewerHandle`, `__studioDebug`, IPC channels, MenuAction) 깨기
- 단일 PR 로 모든 걸 처리 — 너무 큼. 단계별 PR
- 리팩토링하면서 이름 모두 깔끔히 영문화 (한국어 주석은 valid 자산)
- 100% test coverage

---

## 2. 단계별 계획

### Phase R1 — StudioViewer 분해 (~3 PR, 1주)

**목표**: 9610 라인 → 메인 컴포넌트 ≤ 2000 라인 + 도메인별 hooks/utils.

**분할 단위**:

| 신규 파일                                                 | 책임                                                           | 이전 lines |
| --------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| `src/features/studio/StudioViewer.tsx`                    | render + 상위 wiring                                           | ~2000      |
| `src/features/studio/hooks/useDocumentLifecycle.ts`       | 파일 load / save / dirty / WASM 초기화                         | ~600       |
| `src/features/studio/hooks/useSelectionModel.ts`          | caret / selection / drag start/end / shift+click / autoScroll  | ~1200      |
| `src/features/studio/hooks/useCellDrag.ts`                | cell-drag / cell-block highlight / sticky mode / discontiguous | ~900       |
| `src/features/studio/hooks/useFindReplace.ts`             | Find/Replace UI + IR                                           | ~400       |
| `src/features/studio/hooks/useUndoHistory.ts`             | snapshot stack + group undo                                    | ~300       |
| `src/features/studio/hooks/useKeyboardShortcuts.ts`       | F3/F5/F7/F8 + Tab nav + Alt+L/T + ⌘ shortcuts                  | ~800       |
| `src/features/studio/hooks/useImperativeHandleBuilder.ts` | `ViewerHandle` 객체 빌드 (ir\* + 기존 메서드)                  | ~600       |
| `src/features/studio/render/PaperPage.tsx`                | 단일 페이지 SVG + selection rect / cursor / highlight overlays | ~400       |
| `src/features/studio/utils/coords.ts`                     | hitTest / coord math / clamp                                   | ~200       |
| `src/features/studio/utils/lib-call.ts`                   | lib API thin wrapper + try/catch helper                        | ~150       |

**경계 규칙**:

- 각 hook 은 의존하는 ref 를 인자로 받음 (`docRef`, `caretRef`, etc.) — 글로벌 closure 캡처 0
- 각 hook 은 상위에서 호출하는 setter (`setSelection`, `setCellBlockHighlights`) 도 인자로 받음
- React state 는 메인 컴포넌트에 머물고, hook 은 ref 와 dispatch 함수만 받아 mutate

**위험 / 대응**:

- 위험 — closure 캡처 변화로 stale ref 버그
- 대응 — 한 PR 당 hook 1개 추출 + 전체 e2e 통과 확인 후 다음 진행. 추출 직후 commit/push

### Phase R2 — ChatPanel 분해 (~2 PR, 3일)

**목표**: 2396 → ≤ 800 라인 + 도메인별 모듈.

**분할 단위**:

| 신규 파일                                   | 책임                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `src/features/chat/ChatPanel.tsx`           | render + 상위 wiring                                                 |
| `src/features/chat/hooks/useAgentLoop.ts`   | tool-use 누적 + dispatcher + tool-result 메시지 + 재귀 fireChat      |
| `src/features/chat/hooks/useChatHistory.ts` | sqlite 통신 + auto-title 요약 (chunk 31)                             |
| `src/features/chat/hooks/useExcerpts.ts`    | 발췌 칩 + 멀티 문서 ref + verifyExcerpt                              |
| `src/features/chat/system-prompt.ts`        | `SYSTEM_PROMPT_DOC_CONTEXT` + `SYSTEM_PROMPT_AGENT_GUIDE` + builders |
| `src/features/chat/MessageBubble.tsx`       | 단일 메시지 렌더 (현재 inline `Message` 함수 분리)                   |

### Phase R3 — AppShell 분해 (~2 PR, 3일)

**목표**: 1545 → ≤ 700 라인.

**분할 단위**:

| 신규 파일                         | 책임                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/AppShell.tsx`            | layout + 상위 orchestrator                                                                                                        |
| `src/app/hooks/useTabManager.ts`  | 탭 open/close/reorder/pin + 세션 복원                                                                                             |
| `src/app/hooks/useMenuActions.ts` | `view:about` / `view:settings` 등 30+ MenuAction dispatch                                                                         |
| `src/app/hooks/useSaveFlow.ts`    | save/save-as + .bak / draft autosave                                                                                              |
| `src/app/dialogs/DialogHub.tsx`   | About / Settings / PageSetup / HF / Bookmark / Footnote / StyleManager / 등 10+ 다이얼로그의 mount + open state. 현재 모두 인라인 |

### Phase R4 — shared/ai-tools 분해 (~1 PR, 1일)

**목표**: 1965 → 카테고리별 파일.

**분할 단위**:

```
shared/ai-tools/
  index.ts            -- AHWP_TOOL_NAMES (집합) + AhwpToolName + parseToolBlock + getAhwpToolCatalog
  types.ts            -- AhwpToolArgs / AhwpToolCall / AhwpToolResult / AhwpPreflightItem / AhwpToolDescriptor
  validate.ts         -- validateToolCall + validateArgs switch
  catalog/
    body.ts           -- A: insertText/deleteRange/insertParagraph/...
    format.ts         -- B: applyHtml/applyAlignment/applyCharFormat/...
    table.ts          -- C: createTable/insertTableRow/.../evaluateTableFormula
    media.ts          -- D: setPictureProperties/setShapeProperties/...
    page.ts           -- E: insertPageBreak/setColumnDef/setPageHide
    headfoot.ts       -- F: setHeaderFooterText/applyHfTemplate/...
    misc.ts           -- G: addBookmark/insertFootnote/createNamedStyle
    read.ts           -- H: getDocumentOutline/getStyleAt/...
  helpers.ts          -- nonNegInts / byteLen / isObj / HEX_COLOR_RE / 등
```

각 카테고리는 export `<NAME>_DESCRIPTORS: AhwpToolDescriptor[]` + `<NAME>_VALIDATORS: Record<string, ValidatorFn>` 형태로. `index.ts` 가 union + flatten.

### Phase R5 — 타입 narrow + 에러 helper (~1 PR, 1일)

#### 5-A. 타입 narrow

`src/features/studio/lib-types.ts` 신설 — lib JSON 응답 형식을 명시적으로:

```ts
export interface RhwpCharProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeThrough?: boolean;
  size_hu?: number;
  color?: number;
  shadeColor?: number;
  name?: string;
  // ...
}

export interface RhwpParaProps {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: number;
  lineSpacingType?: 'Percent' | 'Fixed' | 'AtLeast';
  // ...
}

export interface RhwpCellInfo {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  // ...
}
```

`Record<string, unknown>` 사용 62회 → 카테고리별 5~10개 narrow type 으로 ~80% 대체.

#### 5-B. lib-call helper

`src/features/studio/utils/lib-call.ts`:

```ts
/** Wrap a lib IR call: returns ok/null on throw, logs warn. Replaces 193개의
 *  반복되는 try { doc.X(...); refreshAfterMutation(); return true; } catch { ... return false } */
export function safeIrCall<T>(label: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    console.warn(`[studio] ${label}:`, err);
    return null;
  }
}
```

`ir*` 메서드 28개 모두 동일 패턴 — 제거 가능한 boilerplate ~600 라인.

### Phase R6 — Cell/Path 분기 통합 (~1 PR, 0.5일)

`src/features/studio/utils/cell-path.ts`:

```ts
/**
 * Choose between regular `*InCell` and `*InCellByPath` lib variant
 * based on cell.path depth. Top-level (path.length===1) → InCell;
 * nested (≥2) → ByPath. 33 호출 분기 그룹 3개를 단일 helper 로.
 */
export function callCellOp<T>(
  doc: HwpDocument,
  cell: CellRef,
  inCellFn: (sec, ppara, ctrl, ci, cp, ...) => T,
  byPathFn: (sec, ppara, pathJson, ...) => T,
  ...args: unknown[]
): T {
  if (cell.path && cell.path.length > 1) {
    return byPathFn(cell.sectionIndex, cell.parentParaIndex, JSON.stringify(cell.path), ...args);
  }
  return inCellFn(cell.sectionIndex, cell.parentParaIndex, cell.controlIndex, cell.cellIndex, cell.cellParaIndex, ...args);
}
```

---

## 3. 각 Phase 별 검증 게이트

PR 머지 전 모두 통과 필수:

- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 신규 warnings 0 (기존 4개는 그대로 OK)
- [ ] `npm test` — 단위 통과
- [ ] `npm run e2e` — studio 213 + chat 57 + about 1 (각 phase 후 케이스 추가 가능)
- [ ] `npm run format:check` — 청정
- [ ] 라이브 smoke 적어도 1회 — Gemini sentinel + Ollama sentinel
- [ ] 수동 dogfood 30분 — 회귀 케이스 가까이 두고 (셀 드래그 / Find/Replace / Save round-trip)
- [ ] CHANGELOG `### Refactored` 섹션 1줄

---

## 4. 진행 순서 (의존성 + 위험 가중)

```
R1.1 useDocumentLifecycle    가장 안전, 격리됨
   ↓
R1.2 useUndoHistory          read-only 상태, 격리
   ↓
R1.3 useFindReplace          UI 결합 적음
   ↓
R1.4 useKeyboardShortcuts    이벤트 핸들러 — 범위 명확
   ↓
R1.5 useSelectionModel       복잡 — drag/caret/auto-scroll 얽힘 (3차 wave 다층 fix 회귀 점검)
   ↓
R1.6 useCellDrag             가장 복잡 — 0.2.89~0.2.92 수정 모두 회귀 가드 필수
   ↓
R1.7 PaperPage / coords      render layer
   ↓
R1.8 useImperativeHandleBuilder  마지막에 — 다른 hook 들이 안정된 후 ViewerHandle 빌드
====== R1 완료 마일스톤 ======
   ↓
R5.A lib-types.ts            R1 완료 후 narrow type 적용 시점 자연
   ↓
R5.B safeIrCall helper       boilerplate 제거 — large diff 지만 mechanical
   ↓
R6 cell-path helper          R5 위에 얹음
   ↓
R2 ChatPanel
   ↓
R3 AppShell
   ↓
R4 ai-tools 분해
```

전체: 약 **2~3주** (full-time, 단계 사이 1~2일 dogfood 포함).

---

## 5. 후속 — 측정 + retrospective

각 phase 끝나면 같은 측량 반복:

- LOC / hook count / try-catch density
- 빌드 시간 (vite build)
- IDE 응답 시간 (체감)
- e2e 시간 (parallel 4 워커)

목표 수치:

```
                                      Before    After (target)
StudioViewer.tsx                       9610      ≤ 2000
ChatPanel.tsx                          2396      ≤ 800
AppShell.tsx                           1545      ≤ 700
shared/ai-tools.ts (단일)               1965      ≤ 500 (index)
Record<string, unknown> usages           62        ≤ 15
try/catch in StudioViewer               193        ≤ 50
hook count in StudioViewer              172        분산 (각 hook ≤ 30)
```

---

## 6. 결정 박제

- **새 패키지 도입 안 함** — `recoil`/`zustand`/`jotai` 같은 외부 state lib 도입 안 함. React useState/useRef 가 충분.
- **클래스 컴포넌트 안 씀** — 함수형 + hooks 패턴 유지
- **ViewerHandle imperative API 유지** — 외부 contract 깨면 e2e 156개 다 손봐야 함
- **`__studioDebug` 글로벌 유지** — e2e 의존성. 신규 메서드만 추가하지 변경 없음
- **한국어 주석 유지** — 자산. 영문화는 별도 결정 필요
- **테스트 작성 의무 없음** — pure logic 추출 후 단위 테스트 유혹이 있을 거지만 e2e 가 충분하면 추가 안 함 (test debt 만들지 말기)

---

## 7. 시작하지 말아야 할 것 (지금은)

- React 19 / Tailwind 4 / Electron 41 메이저 업그레이드 — 별도 phase
- WASM 직접 코드 변경 — `@rhwp/core` 외부 라이브러리
- IPC channel 이름 변경 — preload + main + renderer 3중 동기화 부담
- store JSON 스키마 변경 — `recent.json`, `session.json`, `provider-config.json` 등 — migration 필요

---

## 8. Phase 별 PR 템플릿

```markdown
## refactor(R1.<n>): <hook name> 추출

### 변경

- StudioViewer.tsx 의 `<concern>` 책임을 `src/features/studio/hooks/<file>.ts` 로 이동
- 인자 / 반환 / 의존 ref 명시적
- StudioViewer.tsx 라인: <before> → <after>

### 검증

- typecheck / lint / format:check 청정
- e2e: studio <count> + chat <count> + about <count> = <total> 통과 / 1 skipped
- 라이브 smoke: gemini sentinel <s>s

### 회귀 가드

- (해당 hook 의 동작 검증하는 e2e 케이스 ID 또는 케이스 추가)
```
