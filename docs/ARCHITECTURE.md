# 아키텍처

> **STATUS (0.7.50 기준)**: 이 문서는 Phase 1/2 설계 기반이며 일부 구조가 이후 갱신됨 — 특히
> 편집기는 v0.5.0 에서 자체 마운트 `StudioViewer` 를 폐기하고 **vendored `rhwp-studio` iframe**
> (`ahwp-studio://` protocol) 으로 전환됐고, AI/IPC/스토리지 레이어도 구현으로 성숙함. 채널·스키마의
> 권위 소스는 **코드** (`electron/preload.ts`, `electron/store/*`, `shared/api.ts`) + `CLAUDE.md`.

## 개요

ahwp는 Electron 표준 2-프로세스 모델을 따릅니다.

- **Main Process** (Node.js): 파일 I/O, AI provider 호출(fetch), 채팅 히스토리 SQLite, 키체인(safeStorage), rhwp 코어 호출(저장 정규화)
- **Renderer Process** (Chromium): React UI, AI 채팅 UI, 그리고 편집기는 `vendor/rhwp/rhwp-studio` 를 `ahwp-studio://` 커스텀 protocol 로 임베드한 **iframe** (`src/features/rhwp-studio/RhwpEditor.tsx`). 렌더러가 `@rhwp/core` 를 직접 마운트하지 않음 — `src/lib/rhwp-core/` 에서 WASM init + `measureTextWidth` 만 수행

렌더러는 노드 통합 없이 격리되며, `preload.ts`의 `contextBridge`로 노출된 좁은 API만 사용합니다.

```
┌────────────────────────────────────────────────────────────┐
│                      Renderer (React)                      │
│  ┌──────────┐ ┌──────────────────┐ ┌─────────────────────┐ │
│  │ Folder   │ │ TabBar + Studio  │ │  Chat (History/     │ │
│  │ Tree     │ │ (rhwp/core)      │ │  Chat tabs, right)  │ │
│  └──────────┘ └──────────────────┘ └─────────────────────┘ │
│         ▲              ▲                       ▲           │
│         └──────────────┼───────────────────────┘           │
│                  window.api (contextBridge)                │
└─────────────────────────┬──────────────────────────────────┘
                          │ IPC (invoke / on)
┌─────────────────────────▼──────────────────────────────────┐
│                       Main (Node)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │  ipc/    │ │  hwp/    │ │  ai/     │ │  store/       │  │
│  │ handlers │ │ rhwp core│ │ adapters │ │ sqlite + safe │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│       │            │            │              │          │
│       ▼            ▼            ▼              ▼          │
│   filesystem    @rhwp/core   OpenAI/Gemini   keychain     │
│                  (저장 정규화) /custom        + SQLite     │
│                  iframe=편집기 (Anthropic 미구현)         │
└────────────────────────────────────────────────────────────┘
```

## 프로세스별 책임

### Main Process

| 모듈                                 | 역할                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main.ts`                   | `app.whenReady`, `BrowserWindow` 생성, 메뉴, watcher shutdown, 자동 업데이트                                                                                    |
| `electron/preload.ts`                | `contextBridge.exposeInMainWorld('api', {...})`                                                                                                                 |
| `electron/ipc/file.ts`               | 파일 새 문서 / 열기·저장 다이얼로그 / 라운드트립 정규화 / 임시 파일 라우팅                                                                                      |
| `electron/ipc/folder.ts`             | 폴더 pick/list/watch (chokidar) / create-file·folder / rename / trash / reveal                                                                                  |
| `electron/ipc/clipboard.ts`          | `clipboard:read-text` / `write-text` (Electron `clipboard` 모듈)                                                                                                |
| `electron/ipc/session.ts`            | `userData/session.json` get/set (lastFolderPath, lastActivePath, openTabPaths)                                                                                  |
| `electron/ipc/ai.ts`                 | 채팅 스트림 라우팅 (`ai:chat-start`→`ai:chat-event:<id>`/`ai:chat-abort`) + provider-config get/set + 모델 리스트. tool 실행은 **렌더러-로컬** (main 왕복 아님) |
| `electron/ipc/secrets.ts`            | API 키 `secrets:set/has/delete/list` (`safeStorage` → `userData/secrets.json`)                                                                                  |
| `electron/ipc/chat-history.ts`       | 대화·메시지 SQLite (`chat-history:list/get/create/append/replace-messages/rename/delete`)                                                                       |
| `electron/ipc/{web,bash,updater}.ts` | `web:fetch/search` (SSRF 가드), `bash:run` (allowlist), `updater:*`                                                                                             |
| `electron/hwp/converter.ts`          | `@rhwp/core` 동적 import + WASM lazy init + 라운드트립 정규화 + 빈 시드                                                                                         |
| `electron/hwp/blank-seed.ts`         | base64 임베드 blank.hwpx (`file:new`용)                                                                                                                         |
| `electron/store/recent.ts`           | `userData/recent.json` LRU max 20 (legacy — UI는 폴더 트리)                                                                                                     |
| `electron/store/secrets.ts`          | `safeStorage.encryptString` 래퍼 (Phase 2)                                                                                                                      |

### Renderer Process

| 모듈                                                                       | 역할                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/AppShell.tsx`                                                     | 3-Pane 레이아웃, 탭 상태(`tabsState`+`activeIndex`), 세션 복원, 메뉴 액션 라우팅                                                                                                                                                                              |
| `src/features/files/FolderTree.tsx`                                        | 폴더 트리(lazy expand, watcher 동기화) + 컨텍스트 메뉴 + 인라인 rename/new + DnD 이동 + F2/Delete                                                                                                                                                             |
| `src/features/rhwp-studio/RhwpEditor.tsx`                                  | rhwp-studio iframe 호스트 (`ahwp-studio://` 로드, RhwpBridge ready 대기, doc 교체는 `bridge.loadFile`). IR 호출은 `src/features/rhwp-studio/bridge-ir-helper.ts` (BridgeIrHelper → iframe WasmBridge) 경유. 활성 탭만 `__rhwpDebug` 점유 (`debug-surface.ts`) |
| `src/app/TabBar.tsx`                                                       | 파일별 탭 — dirty 점, X 닫기, 미들 클릭, ⌘W, pin/drag reorder/context menu                                                                                                                                                                                    |
| `src/features/chat/ChatPanel.tsx`                                          | 채팅 패널 — Plan/Agent, 메시지 스트림, Diff Viewer, 히스토리                                                                                                                                                                                                  |
| `src/features/chat/mode-detector.ts` + `DiffCard.tsx`/`GithubDiffPane.tsx` | mode 판별 + diff 뷰어 (Accept/Reject)                                                                                                                                                                                                                         |
| `src/lib/rhwp-core/` (init.ts)                                             | 렌더러 측 `@rhwp/core` lazy WASM init + `measureTextWidth` 콜백 (편집 IR 아님 — warm-up)                                                                                                                                                                      |

## IPC 채널 설계

명명 규칙: `domain:action` (kebab-case 안에 콜론 구분)

| Channel                                                              | 방향        | 페이로드                       | 응답                                                             |
| -------------------------------------------------------------------- | ----------- | ------------------------------ | ---------------------------------------------------------------- |
| `file:new`                                                           | R→M         | `void`                         | `{ path }` (임시 blank `.hwp` 파일 경로)                         |
| `file:open`                                                          | R→M         | `void`                         | `{ path }` 또는 `null`                                           |
| `file:open-by-path`                                                  | R→M         | `{ path }`                     | `{ path }` 또는 `null`                                           |
| `file:read`                                                          | R→M         | `{ path }`                     | `ArrayBuffer`                                                    |
| `file:save`                                                          | R→M         | `{ path, bytes }`              | `{ path }` (.hwpx → .hwp 자동 라우팅)                            |
| `file:save-as`                                                       | R→M         | `{ bytes, defaultPath? }`      | `{ path }` 또는 `null`                                           |
| `file:list-recent`                                                   | R→M         | `void`                         | `RecentFile[]` (legacy, 새 UI 미사용)                            |
| `folder:pick`                                                        | R→M         | `void`                         | `string` 또는 `null`                                             |
| `folder:list`                                                        | R→M         | `path`                         | `FolderEntry[]` (즉시 자식, 폴더 우선 한국어 정렬)               |
| `folder:watch`                                                       | R→M         | `rootPath`                     | `void` (chokidar watcher 시작)                                   |
| `folder:unwatch`                                                     | R→M         | `void`                         | `void`                                                           |
| `folder:changed`                                                     | M→R (event) | `{ type, path, parent }`       | watcher 이벤트                                                   |
| `folder:create-file`                                                 | R→M         | `parentPath, name`             | `string` (생성된 절대 경로)                                      |
| `folder:create-folder`                                               | R→M         | `parentPath, name`             | `string`                                                         |
| `folder:rename`                                                      | R→M         | `oldPath, newPath`             | `void` (이동에도 사용)                                           |
| `folder:trash`                                                       | R→M         | `path`                         | `void` (`shell.trashItem`)                                       |
| `folder:reveal`                                                      | R→M         | `path`                         | `void` (`shell.showItemInFolder`)                                |
| `clipboard:read-text`                                                | R→M         | `void`                         | `string`                                                         |
| `clipboard:write-text`                                               | R→M         | `text`                         | `void`                                                           |
| `session:get`                                                        | R→M         | `void`                         | `SessionState`                                                   |
| `session:set`                                                        | R→M         | `SessionState`                 | `void`                                                           |
| `menu:action`                                                        | M→R (event) | `MenuAction`                   | (`file:new` / `edit:undo` / `format:bold` 등)                    |
| `ipc:ping`                                                           | R→M         | `{ message }`                  | `{ pong, at, platform, electron }` (헬스체크)                    |
| `ai:chat-start`                                                      | R→M         | `{ id, request: ChatRequest }` | 즉시 ack — 스트림은 per-request `ai:chat-event:<id>` 채널로      |
| `ai:chat-event:<id>`                                                 | M→R (event) | —                              | `ChatStreamEvent` (`text-delta` / `tool-use` / `done` / `error`) |
| `ai:chat-abort`                                                      | R→M         | `id`                           | `void` (해당 `id` 의 AbortController 트리거)                     |
| `ai:ping` / `ai:list-models` / `ai:provider-config-get`/`-set`       | R→M         | —                              | provider reachability / 모델 리스트(24h 캐시) / provider 설정    |
| `secrets:set` / `:has` / `:delete` / `:list`                         | R→M         | `{ provider, key? }`           | `safeStorage` → `userData/secrets.json` (renderer 는 `get` 없음) |
| `chat-history:list/get/create/append/replace-messages/rename/delete` | R→M         | —                              | SQLite 대화·메시지 (`replace-messages` 0.7.50)                   |

> tool 실행은 **렌더러-로컬** — `ai:tool-execute`/`ai:tool-result`/`ai:apply-diff` 같은 main↔renderer 왕복은 없다. AI 도구는 렌더러의 agent loop(`useChatStreaming` + `tools.ts runTools`)가 화이트리스트로 직접 실행하고, IR 은 `BridgeIrHelper` 가 iframe WasmBridge 로 호출한다. 그 외 채널 (`updater:*` / `web:*` / `bash:*` / `file:export-html`·`export-pdf`·`save-draft`·`create-version`·`open-external` / `folder:search-text`·`list-outlines`·`read-paragraph`·`copy`)도 존재 — **권위 목록은 `electron/preload.ts`**.

스트리밍은 `ipcRenderer.on('ai:chat-event:<id>', ...)` 이벤트로, 요청별 `id` 가 채널 이름에 박혀 매칭된다.

## 데이터 모델

### SQLite 스키마 (개략)

```sql
-- 실제 스키마는 대화·메시지 2개 테이블뿐 (electron/store/chat-history.ts), doc_path 기준.
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_path TEXT,                  -- 문서 경로 (NULL 가능)
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,             -- system | user | assistant
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_conversations_doc_path ON conversations(doc_path);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);
```

> 위 2-테이블이 전부다. 초기 설계안의 `files` / `versions` 테이블, `hwpx_blob`, 메시지의 `tool_calls`/`provider`/`model` 컬럼은 **구현되지 않음**. 문서 버전 스냅샷은 SQLite 가 아니라 **파일시스템** (`userData/versions/<hash>/<ISO>.hwp`, 명시적 저장마다 `file:create-version`, 최근 50개) 에 보관된다.

### 설정 스키마 (자체 JSON 파일 — `electron/store/*`)

> `electron-store` 미사용. `session.json` / `secrets.json`(safeStorage 암호문) / `model-cache.json` 등을 `fs` 로 직접 읽고 atomic(tmp→rename) write.

```ts
type ProviderId = 'openai' | 'anthropic' | 'google' | 'custom'; // OpenAI-compatible: Ollama / vLLM / LM Studio / on-prem. (anthropic 어댑터 미구현, nvidia/NIM 0.6.18 제거)

interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  baseUrl?: string; // custom 전용 — 자체 호스팅 endpoint URL
  defaultModel: string;
  // API 키는 store에 두지 않고 safeStorage로 따로 보관
}

interface AppSettings {
  providers: ProviderConfig[];
  activeProvider: ProviderId;
  editMode: 'manual' | 'agent';
  recentFiles: string[];
  theme: 'system' | 'light' | 'dark';
}
```

## 문서 라이프사이클

문서는 메모리상 `Document` 객체로 표현되며, 디스크 경로(`path`)와 작업본 경로(`hwpxPath`)를 가집니다. 두 가지 진입 경로가 있습니다.

### A. 새 문서 생성 흐름 (`file:new`)

1. 사용자가 메뉴 `File → New` 또는 시작 화면의 "빈 문서로 시작" 클릭
2. Main이 빈 **HWP** 를 `createBlankHwpBytes()`(→`exportHwp`)로 만들어 `userData/temp/new-<ts>.hwp` 에 쓰고 **실제 경로**를 반환 (blank-seed 기반)
3. 에디터(rhwp-studio iframe)가 일반 파일처럼 로드 — `path` 는 임시 파일 경로 (null 아님)
4. AI도 즉시 사용 가능: 빈 문서 컨텍스트로 "이번 분기 매출 보고서 양식 만들어줘" 같은 요청 처리
5. 첫 `Save As`로 사용자가 위치·이름 선택 → **`.hwp`** 로 저장 (HWPX 입력 경로도 `.hwp` 로 자동 라우팅; 저장 canonical = HWP)

> 템플릿 옵션은 Phase 5 백로그(보고서·계약서 등). MVP는 `blank` 하나.

### B. 기존 파일 열기 흐름 (`file:open`)

> ⚠️ **2026-04-30 정책 변경 — 내부 캐노니컬 HWPX → HWP**
>
> 원래 계획은 "HWP→HWPX 변환 후 모든 처리는 HWPX 기준"이었으나, `@rhwp/core` 의 `exportHwpx → HwpDocument` 라운드트립이 이미지 IR 참조를 깨뜨리는 버그(KNOWN_ISSUES L-001) 발견 — **0.7.14 에서도 재현**. `exportHwp` 라운드트립은 정상이라 저장은 HWP 로 통일.
>
> 잠정적으로 **HWP를 캐노니컬 포맷으로 사용**. 라이브러리가 HWPX 라운드트립 fix 출시하면 HWPX로 전환 검토.

1. 사용자가 `.hwp` 또는 `.hwpx` 파일 선택
2. Main의 `file:read`는 raw bytes 그대로 반환 (매직 검증만)
3. 렌더러의 `HwpDocument` 생성자가 HWP/HWPX 자동 감지하여 파싱
4. 편집·AI 처리는 in-memory `HwpDocument` IR 기준
5. 사용자가 저장 시 `HwpDocument.exportHwp()` → `.hwp`로 저장 (auto-route)
6. `.hwpx` 입력이라도 저장은 `.hwp`로 라우팅 (다이얼로그 필터에서 HWPX 옵션 비활성)

> 결정 사항: 손실 방지를 위해 원본 입력 파일은 덮어쓰지 않음 (다른 path로 저장). HWPX 입력 사용자가 명시적으로 HWPX 유지를 원하면 수동 변환 필요 (현재 미지원).

### Document 식별

- 파일 IPC 는 **파일 경로** 기준 (새 문서도 `userData/temp/new-<ts>.hwp` 임시 경로를 가짐 — `docId`/`null` 아님). 탭/세션도 경로(`openTabPaths`)로 식별
- `docId` 는 채팅 컨텍스트 연결(ChatPanel)에만 쓰이고, 파일 IPC 의 식별자는 아님
- SQLite conversations 는 `doc_path` 로 매핑

## AI 편집 모드

자세한 프롬프트·도구 정의는 [AI_INTEGRATION.md](AI_INTEGRATION.md) 참고.

### Manual

```
User → "이 단락을 더 격식 있게 바꿔줘"
  → AI가 변경 영역과 patch 생성
  → Renderer가 diff 뷰 표시
  → 사용자 Accept → ai:apply-diff IPC → 문서 갱신
```

### Agent

```
User → "표 두 번째 행 삭제하고 합계 다시 계산해"
  → AI가 hwpctl tool 호출 (delete-row, set-cell, ...)
  → Main이 즉시 적용, undo 스택에 push
  → 결과를 다시 AI에게 반환 (multi-turn tool use)
  → 최종 응답
```

각 tool 호출은 `undo` 그룹으로 묶어 사용자가 한 번에 되돌릴 수 있게 함.

## 보안 모델

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- 렌더러는 `window.api.*`만 접근 — 임의 IPC 호출 불가
- API 키: `safeStorage.encryptString` 후 base64 로 `userData/secrets.json` 에 보관 (providerId → 암호문 맵; SQLite 미사용). renderer 는 `get` 경로 없음 — 요청 시점에 main 이 plaintext 주입
- AI 응답에 포함된 코드/스크립트는 어떤 경우에도 직접 실행하지 않음 — tool 호출만 화이트리스트로 허용
- 자동 업데이트 서명 검증 필수 (electron-builder + GitHub Releases or 자체 호스팅)

## 빌드·배포

- `npm run build` → `electron-builder`가 platform별 아티팩트 생성
- macOS: `.dmg` (notarization 필요, Phase 4에서 결정)
- Windows: NSIS `.exe`
- Linux: `.AppImage` + `.deb`
- `electron-updater`로 GitHub Releases에서 차등 업데이트
