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

**우회**: 저장 경로를 `exportHwp` (HWP/CFB)로 통일. 자동 라우팅 `.hwpx → .hwp`. `save-as` 다이얼로그 HWPX 옵션 제거. 자동화된 회귀 게이트: `tests/e2e/studio-edit.spec.ts → "edit + save + reopen preserves embedded images"`

**해결 조건**: `@rhwp/core` 라이브러리가 HWPX 라운드트립에서 BinData 참조를 보존하도록 fix. 그때 `normalizeToHwp` → `normalizeToHwpx` 되돌리고 dedup-friendly HWPX 캐노니컬로 복귀

**관련 파일**: `electron/hwp/converter.ts`, `electron/ipc/file.ts`, `docs/ARCHITECTURE.md` §B

---

## L-002 — `@rhwp/editor` v0.7.8 외부 iframe 의존 (기본 비활성화 + 청크 6에서 완전 제거)

**상태**: 2026-04-30 — **기본 비활성화**로 전환. localStorage `ahwp:use-studio` 기본값이 studio 모드. iframe 모드는 explicit `=0`으로만 유지 (회귀 비교용)

**증상**: `@rhwp/editor` v0.7.8은 `https://edwardkim.github.io/rhwp/`를 iframe으로 임베드. 첫 로드 시 인터넷 필요. 라이브러리 자체에 quirks 누적:

- `_request` postMessage 10초 하드코딩 타임아웃
- `loadFile`이 iframe 측 작업 완료 후에도 우리 promise까지 응답 미도달
- `index.d.ts`가 `RhwpEditor` 클래스를 export 선언하지만 실제 .js는 `createEditor`만 export
- `loadFile`이 `Array.from(new Uint8Array(...))`로 큰 바이너리를 number array 변환
- **단축키 충돌** — iframe이 ⌘S/⌘O 등을 자체 처리해 우리 메뉴 IPC를 가로챔. cross-origin이라 `showSaveFilePicker` 호출 시 `SecurityError: Cross origin sub frames aren't allowed to show a file picker` 발생, 폴백으로 download 다이얼로그가 떠 사용자에게 "다른 이름으로 저장이 기본"으로 보임 — 이게 default flip의 직접적 트리거

**우회 (현재)**: `src/features/studio/StudioViewer.tsx`가 default. iframe RhwpViewer 사용은 explicit `localStorage.setItem('ahwp:use-studio', '0')`로만

**해결 조건**: 청크 6에서 RhwpViewer + `@rhwp/editor` 패키지 완전 제거 + CSP `frame-src` 항목 삭제

**관련 파일**: `src/features/editor/RhwpViewer.tsx` (deprecated, 청크 6 삭제 예정), `src/features/studio/StudioViewer.tsx` (default), `src/app/AppShell.tsx::readStudioFlag`, `index.html` (CSP), `docs/STUDIO_MIGRATION.md`

---

## ✅ L-003 (Resolved) — 한글 IME (composition) 입력

**상태**: chunk 4-C에서 해결 (2026-04-30)

**해결 방식**: `compositionstart` / `compositionend` 이벤트 핸들러 추가. `keydown` 핸들러는 `e.nativeEvent.isComposing` (또는 `keyCode === 229`)이면 무시 — IME가 조합 중인 키를 가로챔. `compositionend.data`에 최종 조합 문자열이 들어오면 `HwpDocument.insertText`로 삽입. e2e용 `__studioDebug.injectComposedText(text)` 헬퍼로 검증 (Playwright는 실제 IME 시뮬레이션 X)

**남은 작업**: composition **중간**의 시각 피드백(언더라인 등) 부재. 사용자가 한자 후보를 보거나 자모 진행을 즉각 보지는 못함. 조합 완료 후 한 번에 삽입됨 — 기능적 OK, UX는 보통

---

## L-004 — 한컴오피스 픽셀 정합성 100% 보장 X

**상태**: `@rhwp/core` 측 한계로 영구. 베스트 에포트

**증상**: 사용자의 자동 보정 경고가 그 예 — "lineseg가 문단당 1개 (한컴 textRun reflow 의존)" 등 HWPX 스펙(OWPML)이 모든 레이아웃 정보를 명시하지 않고 일부 reflow를 reader에 위임. 한컴은 자체 알고리즘 비공개. `@rhwp/core`는 베스트 에포트로 추정

**영향 영역** (우리 viewer ↔ 한컴오피스 비교):

- 줄바꿈 / 페이지 분할: 차이 가능성 **높음**
- 한컴 전용 폰트 (함초롬돋움 등): OS 폰트 부재 시 fallback **높음**
- 수식 렌더링: 차이 가능성 **중간**
- 복잡한 표·병합 셀: 미묘한 차이 가능 **중간**
- 차트·SmartArt: core 부분 지원 **높음**

**우리 자체 일관성은 보장**: 우리 viewer === HOP === rhwp-studio (같은 엔진). 우리 안에서 "보고 → 저장 → 다시 봐도 동일"은 OK. 한컴오피스로 다시 열거나 인쇄 시 픽셀 동일 보장은 X

**우회**: 사용 시나리오 안내 — 보기·검색·간단 편집은 OK. 한컴 작업 결과를 한컴에서 다시 픽셀 동일하게 봐야 한다면 부적합

**해결 조건**: `@rhwp/core` 자체의 정확도 향상 (라이브러리 0.7.x 활발히 개발 중)

---

## L-005 — Visual snapshot CI Linux baseline 부재

**상태**: 마이너. 기능 회귀에는 영향 없음

**증상**: `tests/e2e/studio-viewer.spec.ts`의 visual snapshot 테스트가 darwin baseline만 commit됨. CI(Linux ubuntu-latest)에서 visual 파트 skip

**우회**: `test.skip(process.platform !== 'darwin', ...)`로 명시 skip

**해결 조건**: Linux 환경에서 `--update-snapshots` 1회 실행 후 baseline commit. CI 환경에서 한글 폰트 결정성 확인 필요. Phase 4 packaging 무렵에 정리

**관련 파일**: `tests/e2e/studio-viewer.spec.ts`, `tests/e2e/studio-viewer.spec.ts-snapshots/`

---

## 종료된 이슈 (참고)

### ✅ Resolved — `@rhwp/editor` `Refused to compile WebAssembly`

CSP `script-src 'self'`가 WASM 컴파일 차단. `'wasm-unsafe-eval'` 추가로 해결 (chunk 2). 좁은 권한이라 `'unsafe-eval'`보다 안전.

### ✅ Resolved — `HwpViewer` 생성자가 `HwpDocument` consume

WASM 패닉 `null pointer passed to rust`로 표면화. `HwpViewer` 사용 폐기, `HwpDocument` 자체에 `pageCount`/`renderPageSvg`/`renderPageHtml` 모두 있어 viewer 인스턴스 불필요 (chunk 4-A).
