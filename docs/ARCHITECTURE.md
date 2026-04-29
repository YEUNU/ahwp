# 아키텍처

## 개요

ahwp는 Electron 표준 2-프로세스 모델을 따릅니다.

- **Main Process** (Node.js): 파일 I/O, AI provider 호출, SQLite, 키체인 접근, rhwp 코어 호출
- **Renderer Process** (Chromium): React UI, `@rhwp/editor` 호스팅, 채팅 UI

렌더러는 노드 통합 없이 격리되며, `preload.ts`의 `contextBridge`로 노출된 좁은 API만 사용합니다.

```
┌────────────────────────────────────────────────────────────┐
│                      Renderer (React)                      │
│  ┌──────────┐ ┌──────────────────┐ ┌─────────────────────┐ │
│  │ FileList │ │  rhwp/editor     │ │  Chat (History/     │ │
│  │ (left)   │ │  (center)        │ │  Chat tabs, right)  │ │
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

| 모듈                        | 역할                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `electron/main.ts`          | `app.whenReady`, `BrowserWindow` 생성, 메뉴, 자동 업데이트 |
| `electron/preload.ts`       | `contextBridge.exposeInMainWorld('api', {...})`            |
| `electron/ipc/file.ts`      | 파일 열기/저장 다이얼로그, 최근 파일, HWP→HWPX 변환 트리거 |
| `electron/ipc/ai.ts`        | 채팅 요청 라우팅, 스트리밍 토큰 전달, tool 실행            |
| `electron/ipc/settings.ts`  | API 키 set/get, provider 설정                              |
| `electron/hwp/converter.ts` | `.hwp` → `.hwpx` 일방향 변환 (rhwp core 활용)              |
| `electron/hwp/document.ts`  | 문서 로드, 변경 적용, 저장                                 |
| `electron/ai/openai.ts` 등  | provider별 어댑터 (공통 인터페이스 구현)                   |
| `electron/store/db.ts`      | better-sqlite3, 마이그레이션                               |
| `electron/store/secrets.ts` | `safeStorage.encryptString` 래퍼                           |

### Renderer Process

| 모듈                                 | 역할                                      |
| ------------------------------------ | ----------------------------------------- |
| `src/app/AppShell.tsx`               | 3-Pane 레이아웃, 리사이저블               |
| `src/features/files/`                | 파일 리스트, 최근 항목, drag-and-drop     |
| `src/features/editor/RhwpEditor.tsx` | `@rhwp/editor` 마운트, 변경 이벤트 브릿지 |
| `src/features/chat/ChatPanel.tsx`    | 탭(History/Chat), 메시지 스트림           |
| `src/features/chat/Modes.tsx`        | Manual/Agent 토글, diff 뷰어              |
| `src/lib/ipc.ts`                     | `window.api.*` 타입 안전 래퍼             |

## IPC 채널 설계

명명 규칙: `domain:action` (kebab-case 안에 콜론 구분)

| Channel                  | 방향        | 페이로드                                         | 응답                                         |
| ------------------------ | ----------- | ------------------------------------------------ | -------------------------------------------- |
| `file:new`               | R→M         | `{ template?: 'blank' \| 'report' \| 'letter' }` | `{ docId, hwpxPath }`                        |
| `file:open`              | R→M         | `void`                                           | `{ path, hwpxPath, content }`                |
| `file:save`              | R→M         | `{ docId, path? }`                               | `{ path }` (Save As 시 사용자 선택 경로)     |
| `file:save-as`           | R→M         | `{ docId }`                                      | `{ path }`                                   |
| `file:list-recent`       | R→M         | `void`                                           | `RecentFile[]`                               |
| `file:convert-to-hwpx`   | R→M         | `{ srcPath }`                                    | `{ hwpxPath }`                               |
| `ai:chat-stream`         | R→M (event) | `{ provider, messages, mode }`                   | 스트림 이벤트 (`token`, `tool-call`, `done`) |
| `ai:apply-diff`          | R→M         | `{ docId, patch }`                               | `{ ok, newRevision }`                        |
| `settings:set-secret`    | R→M         | `{ provider, key }`                              | `{ ok }`                                     |
| `settings:get-providers` | R→M         | `void`                                           | `ProviderConfig[]`                           |
| `history:list`           | R→M         | `{ filePath }`                                   | `Conversation[]`                             |
| `history:append`         | R→M         | `{ filePath, message }`                          | `{ ok }`                                     |

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

1. 사용자가 `.hwp` 또는 `.hwpx` 파일 선택
2. Main이 확장자 감지
3. `.hwp`인 경우 `@rhwp/core` 변환 함수로 `.hwpx`를 임시 디렉토리에 생성 (`hwpxPath`)
4. 이후 모든 편집·AI 처리는 `.hwpx` 기준으로 진행
5. 사용자가 저장 시 같은 위치에 `.hwpx`로 저장 (원본 `.hwp`는 보존, 사용자에게 안내)

> 결정 사항: 입력 `.hwp`는 변환 후 읽기 전용으로 취급. 같은 파일명에 `.hwpx` 확장자로 저장. 손실 방지를 위해 원본은 덮어쓰지 않음.

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
