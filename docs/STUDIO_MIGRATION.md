# Studio Migration

`@rhwp/editor` (외부 iframe 기반)을 폐기하고 `@rhwp/core` 직접 사용으로 전환하는 다단계 마이그레이션 ADR.

[golbin/hop](https://github.com/golbin/hop)의 `studio-host` 패턴을 참고하되, 우리는 Electron 단일 타겟이라 모노레포 분리는 보류 (아래 결정 1 참고).

## 동기

현재 `@rhwp/editor` v0.7.8은 `https://edwardkim.github.io/rhwp/`를 iframe으로 임베드하고 postMessage RPC로 통신. 운영상 누적된 quirks:

- 10초 하드코딩 RPC 타임아웃 (멀티 MB 파일 파싱 못 따라감)
- `loadFile`이 iframe 측 작업 완료 후에도 응답 미도달
- d.ts와 .js export 불일치 (런타임 깨짐 한 번 봤음)
- "자동 보정" 같은 studio 자체 동작이 export에 미반영 가능성
- 첫 로드 시 인터넷 필요 — README의 "local-first" 약속과 충돌
- 외부 호스팅 가용성 의존

`@rhwp/core` (Rust + WASM) 직접 사용 시:

- `HwpViewer.renderPageSvg/renderPageHtml`로 자체 렌더링
- `HwpDocument.applyXxx` 직접 호출 — Phase 3 AI Agent와 자연스럽게 연결
- 외부 iframe 없음, 100% 로컬, 라이브러리 quirks 직접 제어
- HOP가 검증한 패턴 (CanvasView + InputHandler + Toolbar 풀 에디터)

## 합의된 결정 (사용자 승인 — 2026-04-29)

| #   | 결정 사항                                                                                 | 이유                                                                     |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | **모노레포 X, 모놀리스 유지** — `src/features/studio/`로 자체 viewer 이주                 | Electron 단일 타겟. 패키지 분리 이득 적음. 향후 web/mobile 추가 시 split |
| 2   | **WASM lazy init in renderer** — 첫 file:open 시 로드                                     | 4.5MB. 앱 시작 시간 보호                                                 |
| 3   | **iframe viewer는 청크 6에서 일괄 제거** — 청크 2~5 동안 fallback 유지                    | 마이그레이션 도중 회귀 비교 가능. 사용자 플로우 깨지지 않음              |
| 4   | **편집 UI: 텍스트 우선 → 표 → 풀**                                                        | 풀 에디터는 별도 phase. 우선 텍스트 입력만                               |
| 5   | **studio 자산 호스팅은 청크 6에서 자동 해소** — iframe 자체가 사라지므로 별도 작업 불필요 | 단일 정리                                                                |

## 청크별 게이트

각 청크는 **자체로 동작 가능**해야 하고, **이전 청크의 e2e가 모두 통과**해야 다음으로 넘어감. PR마다 사용자 승인.

### 청크 1 — 기반 (현재)

산출물:

- 본 문서 (`docs/STUDIO_MIGRATION.md`)
- `src/lib/rhwp-core.ts` — 렌더러 측 lazy init 모듈. `version()` 호출까지 검증 (실제 렌더링 X)
- `tests/e2e/fixtures/blank.hwpx` — 작은 committable HWPX. CI/baseline 테스트 가능

E2E milestone: 비주얼 없음. 빌드/번들 + 기존 7 e2e 통과만 확인.

리스크 검증:

- Vite가 `@rhwp/core` (ESM + WASM)을 렌더러 번들로 정상 처리하는가
- WASM URL 해석 정상 동작
- 4.5MB가 dev 모드 / production 빌드 양쪽에서 다뤄지는가

### 청크 2 — 읽기 전용 viewer (POC)

산출물:

- `src/features/studio/StudioViewer.tsx` — `HwpViewer.renderPageSvg(0)`로 첫 페이지 렌더
- AppShell에 viewer 토글 (env flag로 iframe ↔ studio 전환 가능)

E2E:

- "studio viewer renders first page" — DOM에 SVG 마운트 확인
- **Visual snapshot baseline** — `page.screenshot()` 저장. 이후 청크들의 회귀 감지

### 청크 3 — 다중 페이지 + 스크롤 + 줌

산출물:

- 가상화된 스크롤 컨테이너 (보이는 페이지만 렌더)
- 줌 컨트롤 (50%/100%/맞춤)
- 페이지 N/M 표시

E2E:

- "renders all pages of fixture" — page count assertion
- "scroll moves through pages" — scroll into view + 비주얼
- "zoom changes scale" — getBoundingClientRect 비율

### 청크 4 — 입력/편집

산출물:

- InputHandler 등가물 (key/mouse → `HwpDocument.insertText`/`deleteText` 등)
- 커서/선택 렌더링
- dirty 추적 (변경 발생 시 헤더에 ● 표시)

E2E:

- "type text → exportHwpx contains text"
- "save round-trip preserves edits"
- "ctrl+z undoes last edit" (가능하면)

### 청크 5 — 툴바/메뉴 통합

산출물:

- 툴바 (Bold/Italic/Underline/Style 드롭다운)
- 메뉴 명령 → studio 명령 디스패처
- 단축키 (⌘B 등)

E2E:

- "bold button toggles selection bold" 비주얼
- "menu format → bold 동일 결과"

### 청크 6 — 정리

산출물:

- `RhwpViewer.tsx` (iframe wrapper) 삭제
- `@rhwp/editor` 패키지 의존성 제거
- `index.html` CSP `frame-src` 제거
- 라이브러리 quirks 패치 코드 제거

E2E:

- 기존 7 + 신규 청크 2~5의 모든 e2e 통과

## E2E 설계

### 4-layer 피라미드

```
                    ┌─ Visual snapshots (Playwright) ─┐  ← 폰트/레이아웃 회귀 잡음
              ┌─ Integration (Electron + Playwright) ──┐  ← 현재 7 + 신규 viewer 케이스
        ┌─ Component (vitest + Testing Library + 모킹) ─┐  ← 입력 핸들러, 툴바 단위
   ┌─ Unit (vitest, 순수 함수) ──────────────────────────┐
```

### Fixture 정책

- **`tests/e2e/fixtures/blank.hwpx`** (commit) — `@rhwp/core`로 빈 문서 생성. 수 KB. CI에서도 동작
- **`examples/*.hwp`** (gitignore) — 사용자 supplied 큰 fixture. stress test/visual regression. CI에서는 skip
- 새 fixture 추가 시 PR description에 출처 + 라이선스 명시

### 회귀 게이트

각 청크 PR에서:

1. **기존 7 e2e 통과** — 마이그레이션 도중에도 사용자 플로우 보호
2. **해당 청크 신규 e2e 통과**
3. **Visual snapshot diff 의도적 변경만** — 의도 외 픽셀 변경 시 PR 거부. `--update-snapshots`는 명시적 결정
4. **CI에서 fixture-based 테스트 통과** — Linux 폰트 환경 회귀 감지

### 리스크 & 완화

| 리스크                                  | 완화                                                          |
| --------------------------------------- | ------------------------------------------------------------- |
| WASM 4.5MB 첫 로드 지연                 | lazy init + 로딩 UI                                           |
| 렌더러 메모리 사용 (대용량 문서)        | 가상화 (청크 3) + free() 명시                                 |
| 한글 폰트 환경 차이 (CI Linux vs macOS) | CI 시스템 폰트 설치 또는 fixture에 폰트 번들                  |
| 셀렉션/커서 모델 신규 구현              | 청크 4부터 점진. HOP의 `engine/InputHandler` 참고             |
| 직렬화 결정성 (visual snapshot)         | 정규화 기반 — `@rhwp/core`가 결정적이라고 가정. 실측으로 확인 |
| 마이그레이션 중간에 사용자 차단         | 청크 6까지 iframe 폴백 유지. 결정 #3                          |
