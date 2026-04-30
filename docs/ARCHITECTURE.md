# 아키텍처

## 개요

ahwp는 Electron 표준 2-프로세스 모델을 따릅니다.

- **Main Process** (Node.js): 파일 I/O, AI provider 호출, SQLite, 키체인 접근, rhwp 코어 호출
- **Renderer Process** (Chromium): React UI, `@rhwp/core` 직접 사용 (자체 viewer/editor — Studio), 채팅 UI

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
│   filesystem    @rhwp/core   OpenAI/Claude   keychain     │
│                              /Gemini/Ollama  + SQLite     │
└────────────────────────────────────────────────────────────┘
```

## 프로세스별 책임

### Main Process

| 모듈                         | 역할                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `electron/main.ts`           | `app.whenReady`, `BrowserWindow` 생성, 메뉴, watcher shutdown, 자동 업데이트   |
| `electron/preload.ts`        | `contextBridge.exposeInMainWorld('api', {...})`                                |
| `electron/ipc/file.ts`       | 파일 새 문서 / 열기·저장 다이얼로그 / 라운드트립 정규화 / 임시 파일 라우팅     |
| `electron/ipc/folder.ts`     | 폴더 pick/list/watch (chokidar) / create-file·folder / rename / trash / reveal |
| `electron/ipc/clipboard.ts`  | `clipboard:read-text` / `write-text` (Electron `clipboard` 모듈)               |
| `electron/ipc/session.ts`    | `userData/session.json` get/set (lastFolderPath, lastActivePath, openTabPaths) |
| `electron/ipc/ai.ts`         | 채팅 요청 라우팅, 스트리밍 토큰 전달, tool 실행 (Phase 2)                      |
| `electron/ipc/settings.ts`   | API 키 set/get, provider 설정 (Phase 2)                                        |
| `electron/hwp/converter.ts`  | `@rhwp/core` 동적 import + WASM lazy init + 라운드트립 정규화 + 빈 시드        |
| `electron/hwp/blank-seed.ts` | base64 임베드 blank.hwpx (`file:new`용)                                        |
| `electron/store/recent.ts`   | `userData/recent.json` LRU max 20 (legacy — UI는 폴더 트리)                    |
| `electron/store/secrets.ts`  | `safeStorage.encryptString` 래퍼 (Phase 2)                                     |

### Renderer Process

| 모듈                                   | 역할                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/app/AppShell.tsx`                 | 3-Pane 레이아웃, 탭 상태(`tabsState`+`activeIndex`), 세션 복원, 메뉴 액션 라우팅                                     |
| `src/features/files/FolderTree.tsx`    | 폴더 트리(lazy expand, watcher 동기화) + 컨텍스트 메뉴 + 인라인 rename/new + DnD 이동 + F2/Delete                    |
| `src/features/studio/StudioViewer.tsx` | `@rhwp/core` 직접 마운트. 페이지 SVG, 키보드/마우스/IME, 선택, 서식, Undo/Redo, Find. 활성 탭만 `__studioDebug` 점유 |
| `src/features/studio/TabBar.tsx`       | 파일별 탭 — dirty 점, X 닫기, 미들 클릭, ⌘W                                                                          |
| `src/features/chat/ChatPanel.tsx`      | 탭(History/Chat), 메시지 스트림 (Phase 2)                                                                            |
| `src/features/chat/Modes.tsx`          | Manual/Agent 토글, diff 뷰어 (Phase 2/3)                                                                             |
| `src/lib/rhwp-core.ts`                 | 렌더러 측 `@rhwp/core` lazy WASM init + `measureTextWidth` 콜백                                                      |

## IPC 채널 설계

명명 규칙: `domain:action` (kebab-case 안에 콜론 구분)

| Channel                  | 방향        | 페이로드                                 | 응답                                               |
| ------------------------ | ----------- | ---------------------------------------- | -------------------------------------------------- |
| `file:new`               | R→M         | `void`                                   | `{ path }` (임시 blank `.hwp` 파일 경로)           |
| `file:open`              | R→M         | `void`                                   | `{ path }` 또는 `null`                             |
| `file:open-by-path`      | R→M         | `{ path }`                               | `{ path }` 또는 `null`                             |
| `file:read`              | R→M         | `{ path }`                               | `ArrayBuffer`                                      |
| `file:save`              | R→M         | `{ path, bytes }`                        | `{ path }` (.hwpx → .hwp 자동 라우팅)              |
| `file:save-as`           | R→M         | `{ bytes, defaultPath? }`                | `{ path }` 또는 `null`                             |
| `file:list-recent`       | R→M         | `void`                                   | `RecentFile[]` (legacy, 새 UI 미사용)              |
| `folder:pick`            | R→M         | `void`                                   | `string` 또는 `null`                               |
| `folder:list`            | R→M         | `path`                                   | `FolderEntry[]` (즉시 자식, 폴더 우선 한국어 정렬) |
| `folder:watch`           | R→M         | `rootPath`                               | `void` (chokidar watcher 시작)                     |
| `folder:unwatch`         | R→M         | `void`                                   | `void`                                             |
| `folder:changed`         | M→R (event) | `{ type, path, parent }`                 | watcher 이벤트                                     |
| `folder:create-file`     | R→M         | `parentPath, name`                       | `string` (생성된 절대 경로)                        |
| `folder:create-folder`   | R→M         | `parentPath, name`                       | `string`                                           |
| `folder:rename`          | R→M         | `oldPath, newPath`                       | `void` (이동에도 사용)                             |
| `folder:trash`           | R→M         | `path`                                   | `void` (`shell.trashItem`)                         |
| `folder:reveal`          | R→M         | `path`                                   | `void` (`shell.showItemInFolder`)                  |
| `clipboard:read-text`    | R→M         | `void`                                   | `string`                                           |
| `clipboard:write-text`   | R→M         | `text`                                   | `void`                                             |
| `session:get`            | R→M         | `void`                                   | `SessionState`                                     |
| `session:set`            | R→M         | `SessionState`                           | `void`                                             |
| `menu:action`            | M→R (event) | `MenuAction`                             | (`file:new` / `edit:undo` / `format:bold` 등)      |
| `ipc:ping`               | R→M         | `{ message }`                            | `{ pong, at, platform, electron }` (헬스체크)      |
| `ai:chat-stream`         | R→M (event) | `{ provider, messages, mode }` (Phase 2) | 스트림 이벤트 (`token`, `tool-call`, `done`)       |
| `ai:apply-diff`          | R→M         | `{ docId, patch }` (Phase 2)             | `{ ok, newRevision }`                              |
| `settings:set-secret`    | R→M         | `{ provider, key }` (Phase 2)            | `{ ok }`                                           |
| `settings:get-providers` | R→M         | `void` (Phase 2)                         | `ProviderConfig[]`                                 |
| `history:list`           | R→M         | `{ filePath }` (Phase 2)                 | `Conversation[]`                                   |
| `history:append`         | R→M         | `{ filePath, message }` (Phase 2)        | `{ ok }`                                           |

스트리밍은 `ipcRenderer.on(channel, ...)` 이벤트 + 요청 ID로 구분.

## 데이터 모델

### SQLite 스키마 (개략)

```sql
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  hwpx_path TEXT,
  last_opened_at INTEGER NOT NULL
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,          -- user | assistant | tool
  content TEXT NOT NULL,
  tool_calls TEXT,             -- JSON
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_conv_file ON conversations(file_id);

-- 버전 관리 (Phase 2 도입). 결정: 풀 카피 + HWPX BLOB.
-- 멤버 단위 dedup / 정규화 / 패치 체인은 채택하지 않음.
-- 이유: dedup 효율은 HWPX 직렬화 결정성에 좌우되고 정규화 레이어 정확성 비용이 큼.
-- 단순 풀 카피로 출시 후, 사용 데이터 보고 필요 시 Phase 3+에서 dedup 마이그레이션.
CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES versions(id),
  hwpx_blob BLOB NOT NULL,        -- 전체 HWPX 바이트
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  label TEXT,                     -- 사용자 지정 이름 (수동 체크포인트)
  is_pinned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL            -- 'auto' | 'manual' | 'session-end'
);
CREATE INDEX idx_versions_file ON versions(file_id, created_at DESC);
```

비용 추정: 2.85MB 문서 × 20 버전 ≈ 57MB. GC 정책으로 관리 — `is_pinned=0 AND source='auto'`이고 7일 이상 된 항목 또는 N개 초과분 자동 삭제. 실측 후 임계치 조정.

### 설정 스키마 (`electron-store`)

```ts
type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'nvidia'
  | 'ollama'
  | 'custom';

interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  baseUrl?: string; // ollama / custom
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
2. Main이 빈 HWPX 템플릿을 임시 디렉토리에 생성 (rhwp의 빈 문서 시드 사용)
3. `docId` 발급, 에디터에 로드 — `path`는 아직 `null` (디스크 미저장 상태)
4. AI도 즉시 사용 가능: 빈 문서 컨텍스트로 "이번 분기 매출 보고서 양식 만들어줘" 같은 요청 처리
5. 첫 저장 시 `file:save-as`로 사용자가 위치·이름 선택 → `.hwpx`로 저장

> 템플릿 옵션은 Phase 5 백로그(보고서·계약서 등). MVP는 `blank` 하나.

### B. 기존 파일 열기 흐름 (`file:open`)

> ⚠️ **2026-04-30 정책 변경 — 내부 캐노니컬 HWPX → HWP**
>
> 원래 계획은 "HWP→HWPX 변환 후 모든 처리는 HWPX 기준"이었으나, `@rhwp/core` v0.7.8의 `exportHwpx → HwpDocument` 라운드트립이 이미지 IR 참조를 깨뜨리는 버그 발견 (`scripts/check-image-pipeline.mjs`로 검증). `exportHwp` 라운드트립은 정상 동작.
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

- 메모리상 모든 열린 문서에 `docId` (UUID) 부여
- Renderer는 `docId`로 IPC 호출 — 디스크 경로 없이도(새 문서) 동작
- SQLite의 conversations는 `path`가 확정된 후 매핑. 새 문서는 첫 저장 시점에 conversations.file_id가 채워짐 (저장 전까지는 임시 파일 경로 사용)

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
- API 키: `safeStorage.encryptString` 후 SQLite의 `secrets` 테이블에 base64 보관 (또는 OS 전용 키체인)
- AI 응답에 포함된 코드/스크립트는 어떤 경우에도 직접 실행하지 않음 — tool 호출만 화이트리스트로 허용
- 자동 업데이트 서명 검증 필수 (electron-builder + GitHub Releases or 자체 호스팅)

## 빌드·배포

- `npm run build` → `electron-builder`가 platform별 아티팩트 생성
- macOS: `.dmg` (notarization 필요, Phase 4에서 결정)
- Windows: NSIS `.exe`
- Linux: `.AppImage` + `.deb`
- `electron-updater`로 GitHub Releases에서 차등 업데이트
