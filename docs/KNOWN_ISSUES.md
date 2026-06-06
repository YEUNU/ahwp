# Known Issues

업스트림 의존성·플랫폼·라이브러리 한계로 우리 측에서 즉시 해결 못 하는 알려진 이슈. 우회/회피 정책 + 해결 조건 명시.

각 항목에는:

- **상태**: 영향 정도와 우회 적용 여부
- **재현/검증**: 가능하면 자동화된 게이트 또는 진단 스크립트
- **해결 조건**: 어떤 외부 변화가 있어야 풀리는지
- **우회**: 현재 우리 측 처리

---

## L-001 — `@rhwp/core` HWPX 라운드트립이 이미지 IR 깨뜨림

**상태**: 우회 적용. 캐노니컬 포맷을 HWPX → HWP로 전환 (2026-04-30)

**증상**: `HwpDocument(input).exportHwpx()` 결과를 다시 `new HwpDocument(...)`에 넣고 `renderPageSvg(n)`을 호출하면 image 태그가 0개. zip 안에 `BinData/*` 바이너리는 보존되지만 doc IR이 다음 로드 시 그 BinData를 못 찾음.

**검증**: `scripts/check-image-pipeline.mjs`

| 시나리오                                | 페이지 | 이미지             |
| --------------------------------------- | ------ | ------------------ |
| A. HWP 직접 → render                    | 40     | 25 ✅              |
| B. HWP → `exportHwpx` → reload → render | 53     | **0** ❌           |
| C. (B)의 HWPX zip 내부 BinData 참조     | —      | 46개 (들어있긴 함) |
| D. HWP → `exportHwp` → reload → render  | 40     | 25 ✅              |

**우회**: 저장 경로를 `exportHwp` (HWP/CFB)로 통일. 자동 라우팅 `.hwpx → .hwp`. `save-as` 다이얼로그 HWPX 옵션 제거. 자동화된 회귀 게이트: `tests/e2e/file-roundtrip.spec.ts` (저장 라운드트립 + `.hwpx → .hwp` 라우팅 검증). 0.7.14 에서도 여전히 재현됨

**해결 조건**: `@rhwp/core` 라이브러리가 HWPX 라운드트립에서 BinData 참조를 보존하도록 fix. 그때 `normalizeToHwp` → `normalizeToHwpx` 되돌리고 dedup-friendly HWPX 캐노니컬로 복귀

**관련 파일**: `electron/hwp/converter.ts`, `electron/ipc/file.ts`, `docs/ARCHITECTURE.md` §B

---

## ✅ L-002 (Resolved) — `@rhwp/editor` 외부 iframe 의존

**상태**: 2026-04-30 — chunk 6에서 완전 제거. iframe·CSP `frame-src`·`@rhwp/editor` 패키지·localStorage flag 모두 삭제

> **이후 변경 (v0.5.0)**: 자체 마운트 `StudioViewer` 자체가 은퇴하고 편집기는 vendored `vendor/rhwp/rhwp-studio` iframe (`ahwp-studio://`)로 전환됨. 아래 언급되는 `src/features/studio/`·`StudioViewer`는 더 이상 존재하지 않으며, `ViewerHandle` 타입은 현재 `src/features/chat/viewer-handle-types.ts`에 위치.

**해결 방식**:

- `src/features/editor/RhwpViewer.tsx` 삭제 + 빈 디렉토리 제거
- `src/features/studio/types.ts`에 `ViewerHandle` 타입 신설 (legacy 컴포넌트와의 결합 끊기)
- `AppShell`이 `StudioViewer` 직접 사용. `readStudioFlag` / `useStudio` / `ViewerComponent` 토글 제거
- `index.html` CSP에서 `frame-src https://edwardkim.github.io` 제거 — 외부 의존 0
- `npm uninstall @rhwp/editor`
- e2e의 `localStorage.setItem('ahwp:use-studio', '1')` 제거 (의미 없어짐)

**얻은 것**:

- 인터넷 필요 없음 (오프라인 OK) — README "local-first" 약속 충족
- 단축키 충돌 해결 (이전 SecurityError 사라짐)
- 라이브러리 quirks 누적 종결 (10초 timeout, loadFile 응답 미도달, d.ts 거짓말 등 모두 무관)
- 외부 호스팅 가용성 의존 종결

검증: e2e 26/26, 회귀 없음.

---

## ✅ L-003 (Resolved) — 한글 IME (composition) 입력

**상태**: chunk 4-C에서 해결 (2026-04-30)

**해결 방식**: `compositionstart` / `compositionend` 이벤트 핸들러 추가. `keydown` 핸들러는 `e.nativeEvent.isComposing` (또는 `keyCode === 229`)이면 무시 — IME가 조합 중인 키를 가로챔. `compositionend.data`에 최종 조합 문자열이 들어오면 `HwpDocument.insertText`로 삽입. (v0.5.0 이후 IME 처리는 rhwp-studio iframe 내부에서 담당.)

**남은 작업**: composition **중간**의 시각 피드백(언더라인 등) 부재. 사용자가 한자 후보를 보거나 자모 진행을 즉각 보지는 못함. 조합 완료 후 한 번에 삽입됨 — 기능적 OK, UX는 보통

---

## L-004 — 한컴오피스 픽셀 정합성 100% 보장 X

**상태**: `@rhwp/core` 측 한계로 영구. 베스트 에포트

**증상**: 사용자의 자동 보정 경고가 그 예 — "lineseg가 문단당 1개 (한컴 textRun reflow 의존)" 등 HWPX 스펙(OWPML)이 모든 레이아웃 정보를 명시하지 않고 일부 reflow를 reader에 위임. 한컴은 자체 알고리즘 비공개. `@rhwp/core`는 베스트 에포트로 추정

**영향 영역** (우리 viewer ↔ 한컴오피스 비교):

- 줄바꿈 / 페이지 분할: 차이 가능성 **높음**
- 한컴 전용 폰트 (함초롬돋움 등): OS 폰트 부재 시 fallback **높음**
- 수식 렌더링: 차이 가능성 **중간**
- 복잡한 표·병합 셀: 미묘한 차이 가능 **중간 → 높음** (다중 행/열 병합이 있는 양식 표에서 column width 추정이 어긋나 우측 narrow column 의 텍스트가 잘리거나 행 높이가 불균형하게 보임. lib 가 Canvas 를 직접 그려 우리에게 넘기므로 우리 쪽 fix 불가. clipping 자체는 라이브러리 한계지만 hover tooltip 우회는 적용됨 — Phase 6 follow-up (`getPageTextLayout` 기반 transparent `<div title="...">` per-run overlay) 으로 SVG `<text><title>` 시절 동등한 수준 회복)
- 차트·SmartArt: core 부분 지원 **높음**

**우리 자체 일관성은 보장**: 우리 viewer === HOP === rhwp-studio (같은 엔진). 우리 안에서 "보고 → 저장 → 다시 봐도 동일"은 OK. 한컴오피스로 다시 열거나 인쇄 시 픽셀 동일 보장은 X

**우회**: 사용 시나리오 안내 — 보기·검색·간단 편집은 OK. 한컴 작업 결과를 한컴에서 다시 픽셀 동일하게 봐야 한다면 부적합

**해결 조건**: `@rhwp/core` 자체의 정확도 향상 (라이브러리 0.7.x 활발히 개발 중)

---

## L-005 — Visual snapshot CI Linux baseline 부재

**상태**: 마이너. 게이트 소실 (자체 마운트 StudioViewer 은퇴와 함께 spec 삭제됨)

**증상**: 과거 `tests/e2e/studio-viewer.spec.ts`의 visual snapshot 테스트가 darwin baseline만 commit됨. CI(Linux ubuntu-latest)에서 visual 파트 skip. 해당 spec은 self-mounted StudioViewer 제거 시 삭제됐고, `tests/e2e/studio-viewer.spec.ts-snapshots/` 디렉토리만 orphan으로 남아 있음

**우회**: 게이트 자체가 없음 (구 spec의 `test.skip(process.platform !== 'darwin', ...)` 패턴은 더 이상 적용되지 않음)

**해결 조건**: rhwp-studio iframe 기준으로 visual snapshot 게이트를 다시 깔 경우 Linux 환경에서 `--update-snapshots` 1회 실행 후 baseline commit + 한글 폰트 결정성 확인. 그 전까지 orphan snapshot 디렉토리는 정리 대상

**관련 파일**: `tests/e2e/studio-viewer.spec.ts-snapshots/` (orphan)

---

## 종료된 이슈 (참고)

### ✅ Resolved — `@rhwp/editor` `Refused to compile WebAssembly`

CSP `script-src 'self'`가 WASM 컴파일 차단. `'wasm-unsafe-eval'` 추가로 해결 (chunk 2). 좁은 권한이라 `'unsafe-eval'`보다 안전.

### ✅ Resolved — `HwpViewer` 생성자가 `HwpDocument` consume

WASM 패닉 `null pointer passed to rust`로 표면화. `HwpViewer` 사용 폐기, `HwpDocument` 자체에 `pageCount`/`renderPageSvg`/`renderPageHtml` 모두 있어 viewer 인스턴스 불필요 (chunk 4-A).

---

## L-006 — 셀 배경색 / 테두리 직접 설정 API 부재 (부분 해결)

**상태**: 부분 해결. 해결 조건 (b) 가 0.7.14 에서 전달됨, (a) 는 여전히 대기 중

**증상**: `@rhwp/core` 0.7.14의 `setCellProperties`는 `paddingLeft/Right/Top/Bottom`, `verticalAlign`, `textDirection`, `isHeader`, `width`, `height`만 허용. 셀 배경색·테두리는 여전히 이 props 셋에 포함 안 됨 (`backgroundColor` / `border*` 키 미노출). 노출되는 셀 색깔 API는 `applyCellStyle(sec, parent_para, ctrl, cell, cell_para, style_id)` 단 한 가지로, 미리 정의된 named style의 id를 받음.

**검증**: 회귀 게이트였던 `tests/e2e/studio-table-props.spec.ts`는 self-mounted StudioViewer 제거 시 삭제됨 — rhwp-studio iframe 기준 셀 props round-trip 게이트로 다시 깔아야 함. `@rhwp/core` 0.7.14 `rhwp.d.ts` 검토 결과 `setCellProperties` JSON 키에 `*Color` / `*Background` 일체 미노출

**해결 조건**: 라이브러리에 (a) `setCellProperties` JSON 키 확장(`backgroundColor`, `borderTop/Right/Bottom/Left` 등). ~~(b) named style의 char/para shape를 사후 update할 수 있는 `updateStyle` API~~ → **0.7.14에서 `updateStyle(style_id, json)` + `updateStyleShapes(style_id, char_mods_json, para_mods_json)` 추가되어 createStyle 빈 셸 한계 해소됨**. 남은 건 (a) 직접 셀 set API뿐

**우회**: 직접 셀 배경/테두리 set API는 아직 보류. ① 0.7.14의 `updateStyle` / `updateStyleShapes`로 named style에 색깔/테두리 shape를 사후 주입 → ② 해당 style id를 `applyCellStyle`로 셀에 적용하는 워크플로우 가능. 또는 사용자 HWP 문서 안에 이미 있는 색깔 style을 `getStyleListJson`으로 찾아 `applyCellStyle`. (a) 직접 setter는 라이브러리 update 시 전환

---

## ✅ L-007 (해결됨) — 셀 안 그림 삽입 API 부재

**상태**: 해결됨 — `@rhwp/core` 0.7.14

**원래 증상**: 0.7.9까지는 본문 caret용 `insertPicture(sec, para, charOffset, imageData, ...)`만 노출하고 셀 좌표를 받는 동등 API가 없어, 셀 caret 컨텍스트에서 호출해도 그림이 본문에 삽입됨

**해결**: 0.7.14가 `insertPicture`에 `cell_path_json` 인자를 추가 — `insertPicture(sec, para, charOffset, cell_path_json, imageData, ...)` (rhwp.d.ts). `cell_path_json`에 `[{"controlIndex","cellIndex","cellParaIndex"}, ...]` 경로를 주면 셀 안에 직접 floating picture로 삽입. 추가로 셀 전용 그림 속성 API `getCellPicturePropertiesByPath` / `setCellPicturePropertiesByPath` / `deleteCellPictureControlByPath`도 노출. 본문-삽입-후-드래그 우회 불필요

---

## L-008 — 이미지/도형 통합 bbox API 부재 (selection highlight 제약)

**상태**: 부분 해결 — `@rhwp/core` 0.7.14가 `getShapeBBox` 추가. `docs/SELECTION_UX.md` Phase C 참고

**증상**: 0.7.9까지는 표용 `getTableBBox(sec, parentPara, controlIdx)` → `{pageIndex, x, y, width, height}` 만 통합 bbox API로 publish. 이미지·도형 컨트롤은 `getShapeProperties` / `getPictureProperties` 등 종류별 호출이 `width`/`height`만 반환하고 **페이지 좌표(pageIndex/x/y) 미포함**이라, 0.2.74의 control highlight가 표만 동작했음. **0.7.14 업데이트**: `getShapeBBox(sec, parentPara, controlIdx)` (rhwp.d.ts)가 추가되어 도형·이미지도 페이지 좌표 bbox 획득 가능 — 도형/이미지 highlight 구현 가능. 잔여: 모든 control 타입을 한 번에 cover하는 generic `getControlBBox`는 아직 부재 (타입별 호출 분기 필요)

**검증**: `node_modules/@rhwp/core/rhwp.d.ts` 1차 grep (2026-05-02 0.2.74 작성 시) + 2차 재검증 (Phase C 작업 진입 시 0.2.80 직후) — `getPictureProperties` / `getShapeProperties` 모두 `{width, height, ...}`만 반환, 페이지 좌표 부재 확정

**해결 조건**: 라이브러리에 통합 control bbox API 추가 — 후보 시그니처 `getControlBBox(sec, parentPara, controlIdx) → {pageIndex, x, y, width, height}` (표/이미지/도형/수식 등 모든 control 타입 cover)

**우회**: 0.2.74의 `selectedControlBboxes` 인프라는 그대로. control hit 감지 시 `getTableBBox` 시도하고 실패하면 무음 skip (이미지·도형은 highlight 없음). 사용자 보고 시 본 이슈 ID로 박제
