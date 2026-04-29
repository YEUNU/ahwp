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

## L-002 — `@rhwp/editor` v0.7.8 외부 iframe 의존

**상태**: 마이그레이션 진행 중. 청크 6에서 `@rhwp/editor` 완전 제거 예정

**증상**: `@rhwp/editor` v0.7.8은 `https://edwardkim.github.io/rhwp/`를 iframe으로 임베드. 첫 로드 시 인터넷 필요(README의 "local-first" 약속과 충돌). 라이브러리 자체에 quirks 누적:

- `_request` postMessage 10초 하드코딩 타임아웃
- `loadFile`이 iframe 측 작업 완료 후에도 우리 promise까지 응답 미도달 (fire-and-forget으로 우회)
- `index.d.ts`가 `RhwpEditor` 클래스를 export 선언하지만 실제 .js는 `createEditor`만 export (런타임 깨짐)
- `loadFile`이 `Array.from(new Uint8Array(...))`로 큰 바이너리를 number array 변환 (메모리/성능 저하)

**우회**: `src/features/studio/StudioViewer.tsx` (자체 viewer, `@rhwp/core` 직접) 도입. `localStorage 'ahwp:use-studio'='1'`로 토글. 청크 6에서 iframe wrapper 제거 + CSP `frame-src` 제거 + 의존성 삭제

**해결 조건**: 자체 viewer가 모든 기능 커버 (현재 청크 4 진행). 또는 라이브러리가 외부 호스팅 의존 제거 (낮은 가능성)

**관련 파일**: `src/features/editor/RhwpViewer.tsx` (legacy), `src/features/studio/StudioViewer.tsx`, `index.html` (CSP), `docs/STUDIO_MIGRATION.md`

---

## L-003 — 한글 IME (composition) 입력 미지원

**상태**: chunk 4-B 진입 전 사전 명시. ASCII 입력만 우선 구현, IME는 별도 chunk

**증상**: `keydown` 이벤트만 처리하면 한글 조합 중간 상태(자모 결합 등)가 누락됨. macOS 한글 IME, Windows MS-IME 모두 영향. 입력은 가능하지만 일부 조합이 깨질 수 있음

**우회**: chunk 4-B는 ASCII 전용. 한글 입력은 별도 chunk에서 `compositionstart` / `compositionupdate` / `compositionend` 이벤트 처리 + 임시 placeholder 렌더 추가

**해결 조건**: 우리 구현. chunk 4-C 또는 별도 작업

**관련 파일**: `src/features/studio/StudioViewer.tsx` (chunk 4-B 진입 시점)

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
