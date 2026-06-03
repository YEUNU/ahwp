/**
 * IPC contract shared between Electron main and renderer.
 * Renderer accesses these as window.api.*
 */

import type {
  ChatRequest,
  ChatStreamEvent,
  ModelListResult,
  ProviderId,
} from './ai';

export interface PingRequest {
  message: string;
}

export interface PingResponse {
  pong: string;
  at: number;
  /** Literal union of `process.platform` values. Inlined to avoid the
   *  `NodeJS` global namespace which only exists in node-typed contexts
   *  — `shared/api.ts` is read by the renderer (DOM) tsconfig too. */
  platform:
    | 'aix'
    | 'darwin'
    | 'freebsd'
    | 'linux'
    | 'openbsd'
    | 'sunos'
    | 'win32'
    | 'cygwin'
    | 'netbsd'
    | 'haiku'
    | 'android';
  electron: string;
}

/**
 * Menu actions emitted by the native application menu.
 * Renderer subscribes via window.api.onMenuAction(...).
 * Concrete handlers are wired in later phases (1-B file ops, 1-C editor commands).
 */
export type MenuAction =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:save-as'
  | 'app:new-window'
  | 'edit:copy'
  | 'edit:cut'
  | 'edit:paste'
  | 'view:settings'
  | 'view:about';

export interface RecentFile {
  path: string;
  lastOpenedAt: number;
}

export interface FileOpenResult {
  path: string;
  /**
   * When the main process auto-routed the requested path's extension to a
   * different one (e.g. `.hwpx` → `.hwp` because of the HWPX round-trip
   * limitation in `@rhwp/core`), this holds the original requested path so
   * the renderer can surface a notice. Undefined when no rerouting happened.
   */
  routedFrom?: string;
}

export interface FileSaveRequest {
  path: string;
  bytes: ArrayBuffer | Uint8Array;
}

export interface FileSaveAsRequest {
  bytes: ArrayBuffer | Uint8Array;
  defaultPath?: string;
}

export interface FileApi {
  /**
   * Create a blank HWP document and write it to a per-session temp path.
   * Returns the path so the viewer can open it like any other file. The
   * temp file is excluded from the Recent list until the user runs Save As.
   */
  new: () => Promise<FileOpenResult>;
  /** Show native open dialog. Returns null when the user cancels. */
  open: () => Promise<FileOpenResult | null>;
  /** Open a specific path (drag-drop, recent-list click). Returns null if rejected (e.g. wrong extension). */
  openByPath: (path: string) => Promise<FileOpenResult | null>;
  /** Most-recent-first list, capped to N entries. */
  listRecent: () => Promise<RecentFile[]>;
  /** Read raw bytes for a path. Throws if extension is not allowed or file is missing. */
  read: (path: string) => Promise<ArrayBuffer>;
  /** Write bytes to an existing path. Atomic via tmp + rename. Updates recent. */
  save: (req: FileSaveRequest) => Promise<FileOpenResult>;
  /** Show native save dialog, write bytes, return chosen path. null if user cancels. */
  saveAs: (req: FileSaveAsRequest) => Promise<FileOpenResult | null>;
  /**
   * Show native save dialog and write an HTML export of the active doc.
   * Wraps the body HTML in a minimal `<!DOCTYPE html>` shell. chunk 41.
   */
  exportHtml: (req: {
    html: string;
    defaultPath?: string;
  }) => Promise<FileOpenResult | null>;
  /**
   * Export the active document as PDF — chunk 59. The renderer hands
   * the body HTML over and main runs it through Chrome's `printToPDF`
   * in a hidden BrowserWindow. Quality matches "Save as PDF" from a
   * standard browser print — fine for review/share flows.
   */
  exportPdf: (req: {
    html: string;
    defaultPath?: string;
  }) => Promise<FileOpenResult | null>;
  /**
   * Reconfigure the external-change watcher to track exactly the paths
   * passed in. Pass `[]` to stop watching all files. The previous set is
   * always replaced — the renderer just resends the full path list when
   * tabs open/close. Idempotent.
   */
  watchPaths: (paths: string[]) => Promise<void>;
  /**
   * chunk 52 — auto-save draft sidecar. The renderer dumps each dirty
   * tab to `<path>.ahwp-draft` every minute; on next launch
   * `hasDraft(path)` lets us surface a recovery toast and `loadDraft`
   * pulls the bytes back when the user chooses to restore.
   */
  saveDraft: (req: {
    path: string;
    bytes: ArrayBuffer | Uint8Array;
  }) => Promise<void>;
  hasDraft: (path: string) => Promise<boolean>;
  loadDraft: (path: string) => Promise<ArrayBuffer | null>;
  clearDraft: (path: string) => Promise<void>;
  /**
   * chunk 62 — version history. Each successful explicit save writes a
   * versioned snapshot under `userData/versions/<hash>/<ISO>.hwp` (latest
   * 50 per file, FIFO). This is the pre-edit safety net; read-back/restore
   * IPC is not currently wired.
   */
  createVersion: (req: {
    path: string;
    bytes: ArrayBuffer | Uint8Array;
  }) => Promise<void>;
  /**
   * Subscribe to external (off-app) modifications of the watched files.
   * Returns an unsubscriber. Fires once per change event from chokidar.
   */
  onExternalChange: (
    handler: (event: ExternalFileChangeEvent) => void,
  ) => () => void;
  /**
   * Resolve a renderer-side File object to its absolute disk path.
   * Wraps Electron's webUtils.getPathForFile (replacement for the removed File.path).
   */
  getPathForFile: (file: File) => string;
  /**
   * 0.6.0 — non-editable 파일 (PDF / DOCX / Excel / 등) 클릭 시 OS 기본
   * 앱으로 위임. `shell.openPath` wrap. 성공 시 빈 문자열, 실패 시 에러
   * 메시지 반환 (Electron 의 convention 그대로).
   */
  openExternal: (path: string) => Promise<string>;
}

export interface ClipboardApi {
  /** Read plain text from the system clipboard. Returns '' when empty. */
  readText: () => Promise<string>;
  /** Write plain text to the system clipboard. */
  writeText: (text: string) => Promise<void>;
}

/**
 * One immediate child of a folder. Returned by `folder:list`. Stat errors
 * (permission denied, dangling symlink) are silently dropped — the user
 * shouldn't see broken entries in the tree.
 */
export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Push event fired when chokidar notices a change inside the watched
 * root. The renderer uses `parent` to decide which already-expanded
 * folder to refresh; full-tree refetch is unnecessary.
 */
export interface FolderChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  path: string;
  parent: string;
}

/**
 * Push event fired when a file the renderer asked to watch (open tab
 * paths) was modified by an external process. The renderer compares to
 * the active tabs' dirty state and decides whether to silently reload
 * (`!dirty`) or surface a conflict notice (`dirty`).
 */
export interface ExternalFileChangeEvent {
  type: 'change' | 'unlink';
  path: string;
}

/**
 * Cross-file text search result — chunk 60. Each match carries the
 * source file + a lightweight snippet so the result panel can render
 * "filename: …<match>… preview" rows. The renderer uses (path,
 * sectionIndex, paragraphIndex) to open the file and scroll to the hit.
 */
export interface FolderSearchHit {
  path: string;
  filename: string;
  /** Total non-zero matches found in the file (capped per-file by main). */
  matchCount: number;
  /** Up to 5 preview snippets per file. */
  snippets: {
    sectionIndex: number;
    paragraphIndex: number;
    /** ~60 chars of context around the match. */
    preview: string;
    /** Match offset within `preview`. */
    matchOffset: number;
    matchLength: number;
  }[];
}

export type FolderSearchStatus = 'ok' | 'limit-reached' | 'aborted' | 'no-root';

export interface FolderSearchResult {
  status: FolderSearchStatus;
  hits: FolderSearchHit[];
  scanned: number;
  /** Files skipped (too large / parse error / extension filter). */
  skipped: number;
}

/**
 * Workspace outline inventory — chunk 96. Cheap "table of contents" for
 * every .hwp/.hwpx under `rootPath`, used as a routing prompt for the
 * Agent: given the user's concept-level query, the LLM picks
 * `(path, paragraphIndex)` candidates and follows up with
 * `readParagraphByPath` for the body text.
 *
 * Per-file outline reuses `getOutline` semantics (heading-styled paras
 * only — `제목 N` / `Heading N`). Filename + outline together gives the
 * model enough surface area to disambiguate without seeing the bodies.
 *
 * Cached to `userData/outline-cache.json` keyed by `path + mtime` —
 * unchanged files reuse prior outline; chokidar invalidates on edit.
 */
export interface WorkspaceOutlineEntry {
  path: string;
  filename: string;
  /** ms since epoch — invalidates the cache. */
  mtime: number;
  /** Heading-styled paragraphs in section 0 (capped at 200). Empty array
   *  if the doc has no recognizable heading style. */
  outline: { paragraphIndex: number; level: number; text: string }[];
}

export type WorkspaceOutlineStatus =
  | 'ok'
  | 'limit-reached'
  | 'no-root'
  | 'partial';

export interface WorkspaceOutlineResult {
  status: WorkspaceOutlineStatus;
  entries: WorkspaceOutlineEntry[];
  /** Files successfully parsed this call (cache hits + cold parses). */
  scanned: number;
  /** Files skipped (too large / parse error). */
  skipped: number;
}

export interface ReadParagraphRequest {
  path: string;
  sectionIdx: number;
  paragraphIdx: number;
  /** N preceding + N following paragraphs returned alongside as context.
   *  Default 2, max 10. Caller can set 0 to read just the target. */
  contextParagraphs?: number;
}

export interface ReadParagraphResult {
  ok: boolean;
  /** Reason on failure — `parse-error` / `out-of-range` / `read-failed`. */
  reason?: string;
  text?: string;
  /** Surrounding paragraphs (chronological order) when contextParagraphs > 0. */
  context?: { paragraphIdx: number; text: string }[];
}

export interface FolderApi {
  /** Native dialog → returns absolute path or null on cancel. */
  pick: () => Promise<string | null>;
  /** List immediate children of `path`, sorted: folders first, alphabetical. */
  list: (path: string) => Promise<FolderEntry[]>;
  /**
   * Cross-file text search — chunk 60. Walks `rootPath` recursively (max
   * depth + file-count caps applied in main), parses each `.hwp` /
   * `.hwpx`, and greps the body text. Case-insensitive substring match.
   * Returns up to ~50 hits across all files; the renderer paginates if
   * needed.
   */
  searchText: (req: {
    rootPath: string;
    query: string;
  }) => Promise<FolderSearchResult>;
  /** Start chokidar watcher on a root. Replaces any existing watcher. */
  watch: (rootPath: string) => Promise<void>;
  /** Stop the active watcher. No-op if none. */
  unwatch: () => Promise<void>;
  /** Subscribe to change events from the watcher. Returns an unsubscriber. */
  onChange: (handler: (event: FolderChangeEvent) => void) => () => void;
  /**
   * Create an empty file at `parentPath/name`. Throws if a file already
   * exists at the target path. Returns the resulting absolute path.
   */
  createFile: (parentPath: string, name: string) => Promise<string>;
  /**
   * Create a directory at `parentPath/name`. Throws on collision.
   */
  createFolder: (parentPath: string, name: string) => Promise<string>;
  /**
   * fs.rename — also handles move-to-different-parent. Throws if the
   * destination already exists.
   */
  rename: (oldPath: string, newPath: string) => Promise<void>;
  /**
   * Move to OS trash (Electron `shell.trashItem`). Recoverable; does not
   * permanently delete. Throws if the path can't be reached.
   */
  trash: (path: string) => Promise<void>;
  /** Open the OS file manager with `path` selected. */
  reveal: (path: string) => Promise<void>;
  /**
   * Recursive copy from `src` into `destDir`. The new path is the dir +
   * the source's basename. If a file/folder of that name already exists,
   * the IPC appends " (1)", " (2)", … to disambiguate. Returns the
   * resulting absolute path.
   */
  copy: (src: string, destDir: string) => Promise<string>;
  /**
   * Workspace outline inventory — chunk 96. BFS walks `rootPath`
   * (max depth 5), parses each .hwp/.hwpx, extracts its heading-style
   * outline. Cached per file by mtime to keep re-runs fast. The Agent's
   * `searchWorkspaceOutlines` tool wraps this and ships the inventory
   * to the LLM as a routing prompt.
   */
  listOutlines: (req: {
    rootPath: string;
    maxDocs?: number;
  }) => Promise<WorkspaceOutlineResult>;
  /**
   * Read a paragraph from an arbitrary .hwp/.hwpx — chunk 96. Used after
   * `searchWorkspaceOutlines` identifies a candidate. Returns the target
   * paragraph + N surrounding ones for context. The active doc is
   * unaffected (no IR mutation, no caret movement).
   */
  readParagraph: (req: ReadParagraphRequest) => Promise<ReadParagraphResult>;
}

export interface SessionState {
  /** Path of the folder the user has open in the left panel. */
  lastFolderPath?: string | null;
  /** Path of the document active when the renderer last persisted state. */
  lastActivePath?: string | null;
  /**
   * Paths of all open tabs in display order (chunk: tabs). On restore the
   * shell mounts a viewer for each and activates `lastActivePath`.
   */
  openTabPaths?: string[];
}

export interface SessionApi {
  get: () => Promise<SessionState>;
  set: (state: SessionState) => Promise<void>;
}

/**
 * BYOK secret storage. Plaintext keys never leave the main process —
 * the renderer can write a key, ask whether one exists, list providers,
 * and delete, but cannot read. AI requests go through a separate IPC
 * (Phase 2-B) that injects the secret in main.
 */
export interface SecretsApi {
  /** Persist an API key for a provider (encrypted via Electron safeStorage). */
  set: (providerId: ProviderId, key: string) => Promise<void>;
  /** Remove a stored key. No-op if not set. */
  delete: (providerId: ProviderId) => Promise<void>;
  /** Whether a key is currently stored for the provider. */
  has: (providerId: ProviderId) => Promise<boolean>;
  /** Providers with stored keys, in insertion order. */
  list: () => Promise<ProviderId[]>;
  /** chunk 70 — subscribe to set/delete broadcasts so the renderer can
   *  re-warm the model-list cache when keys change. Returns an
   *  unsubscribe fn. */
  onChanged: (handler: () => void) => () => void;
}

export interface AiChatHandle {
  /**
   * Cancel the in-flight stream. Safe to call after the stream has already
   * completed; subsequent events for this id are ignored.
   */
  abort: () => void;
}

export interface AiChatCallbacks {
  /**
   * Invoked for every event emitted by the provider. The stream always ends
   * with exactly one `done` or `error` event; once one of those is delivered
   * no further events arrive for this handle.
   */
  onEvent: (event: ChatStreamEvent) => void;
}

export interface AiPingOptions {
  /**
   * Transient API key supplied by a Settings form *before* the user has saved.
   * If omitted, the main process falls back to the stored secret for this
   * provider. The transient key is never persisted.
   */
  apiKey?: string;
  /** Override the provider's default base URL (e.g. on-prem LLM
   * gateway, self-hosted /v1-compatible endpoint, NIM cluster). */
  baseUrl?: string;
}

/**
 * AI chat over IPC. The renderer never sees the API key — main loads it from
 * encrypted storage and runs the adapter. Returns synchronously with a handle
 * for cancellation; events arrive asynchronously via `callbacks.onEvent`.
 */
export interface AiApi {
  chat: (req: ChatRequest, callbacks: AiChatCallbacks) => AiChatHandle;
  /** Reachability check. Resolves on success, rejects with the error message. */
  ping: (providerId: ProviderId, opts?: AiPingOptions) => Promise<void>;
  /**
   * Fetch the list of model IDs available for `providerId` — chunk 48.
   * Served from a 24h cache when fresh; main refetches and updates the
   * cache when stale. Pass `force: true` to bypass the cache after a
   * key rotation. Always resolves (never throws); the union shape lets
   * the UI distinguish fresh / stale / unknown.
   */
  listModels: (
    providerId: ProviderId,
    opts?: { baseUrl?: string; force?: boolean },
  ) => Promise<ModelListResult>;
  /** Drop the on-disk cache entry for `providerId`. Used by Settings'
   * 새로고침 button when the user wants a hard refresh. */
  clearModelsCache: (providerId: ProviderId) => Promise<void>;
  /** Phase 3 chunk 44 — read per-provider config (baseUrl). */
  getProviderConfig: (providerId: ProviderId) => Promise<{ baseUrl?: string }>;
  /** Phase 3 chunk 44 — write per-provider config. Pass only the keys you
   * want to update (existing keys preserved). */
  setProviderConfig: (params: {
    providerId: ProviderId;
    baseUrl?: string;
  }) => Promise<{ ok: true }>;
}

/** Chat history persistence — chunk 26. SQLite-backed conversations
 * and messages keyed by document path. The renderer never sees DB
 * internals; everything flows through these IPC channels. */
export interface ChatHistoryConversation {
  id: number;
  docPath: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatHistoryMessage {
  id: number;
  conversationId: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ChatHistoryApi {
  /** List conversations, optionally filtered by doc path. Most-recently
   * updated first. Pass `null` to get every conversation. */
  list: (docPath: string | null) => Promise<ChatHistoryConversation[]>;
  /** Read all messages of a conversation in chronological order. */
  get: (conversationId: number) => Promise<{ messages: ChatHistoryMessage[] }>;
  /** Start a new conversation. Returns the new id so the caller can
   * append messages to it immediately. */
  create: (docPath: string | null, title: string) => Promise<{ id: number }>;
  /** Append a message. Bumps the conversation's `updatedAt`. */
  append: (
    conversationId: number,
    role: 'system' | 'user' | 'assistant',
    content: string,
  ) => Promise<{ id: number }>;
  rename: (id: number, title: string) => Promise<{ ok: true }>;
  delete: (id: number) => Promise<{ ok: true }>;
}

export interface AppVersions {
  app: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  /** chunk 79 — `@rhwp/core` (HWP/HWPX WASM lib) version. Read from
   *  `package.json` dependencies at app launch — surfaced in Settings
   *  → 정보 so users know which WASM build powers their viewer. */
  rhwpCore: string;
}

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  /** chunk 65 — open a fresh BrowserWindow with the same React app. */
  newWindow: () => Promise<void>;
  /** chunk 52 — About 창에서 사용. app/electron/chrome/node 버전 +
   * platform/arch 일괄 조회. package.json version 은 app.getVersion(). */
  getVersions: () => Promise<AppVersions>;
  /** chunk 63 — renderer-side global error bridge. Append to
   * `userData/error.log` (local-only sink — no upload). */
  logError: (req: { origin?: string; message: string }) => Promise<void>;
  /** chunk 100 — Settings 의 "캐시 비우기" 진입점. outline-cache.json +
   *  model-cache.json 만 삭제. 채팅 히스토리 / 세션 / API 키 / recent.json
   *  은 건드리지 않음 (사용자 데이터). 결과는 삭제 성공 / 실패 파일명. */
  clearCaches: () => Promise<{ removed: string[]; failed: string[] }>;
  /** 0.6.12 — Windows / Linux 햄버거 메뉴. 네이티브 메뉴바가 숨겨진
   *  플랫폼에서 TitleBar 의 햄버거 버튼이 본 API 를 호출 →
   *  main 의 Menu.popup() 으로 메뉴 노출. macOS 는 시스템 메뉴바
   *  사용하니까 호출 불필요. `pos` 미지정 시 마우스 위치. */
  popupAppMenu: (pos?: { x?: number; y?: number }) => Promise<void>;
  file: FileApi;
  session: SessionApi;
  clipboard: ClipboardApi;
  folder: FolderApi;
  secrets: SecretsApi;
  ai: AiApi;
  chatHistory: ChatHistoryApi;
  updater: UpdaterApi;
  /** 0.7.7 — external world access (web fetch / search). */
  web: WebApi;
  /** 0.7.9 — Bash 명령 실행 (allowlist + default off). */
  bash: BashApi;
}

/**
 * 0.6.2 — auto-updater surface. main 에 `electron-updater` (chunk 53) 가
 * 이미 GitHub Releases 와 wire 되어 있지만 UI 는 비어있었다. 본 API 는
 * autoUpdater 의 이벤트를 renderer 로 broadcast + 사용자 액션 (지금 받기 /
 * 재시작 설치) 을 main 으로 보내는 양방향 채널.
 *
 * dev (`!app.isPackaged`) 에선 모든 액션이 즉시 reject — packaged build
 * 에서만 의미 있음. e2e 는 `AHWP_UPDATER_FAKE` env 로 fake event sequence
 * 주입.
 */
export type UpdaterStatus =
  | 'idle' // 아직 check 안 함
  | 'checking' // checkForUpdates 진행 중
  | 'up-to-date' // 현재 버전이 최신
  | 'available' // 새 버전 있음 (다운로드 전)
  | 'downloading' // 다운로드 진행 중 (progressPercent 같이)
  | 'downloaded' // 다운로드 끝, 재시작 대기
  | 'error'; // 어디선가 실패

export interface UpdaterState {
  status: UpdaterStatus;
  /** 최신 release 버전 (`available`/`downloading`/`downloaded` 시). */
  version?: string;
  /** `downloading` 일 때 0-100. */
  progressPercent?: number;
  /** `error` 일 때 사용자에게 보일 메시지. */
  errorMessage?: string;
  /** dev 모드 / `AHWP_DISABLE_UPDATER=1` 면 false → UI 는 noop 유지. */
  enabled: boolean;
}

/**
 * 0.6.8 — auto-updater 사용자 설정. `userData/updater-prefs.json` 영구.
 * main 의 `electron-updater` 인스턴스 동작에 직접 매핑.
 */
export interface UpdaterPrefs {
  /** 새 버전 발견 시 자동 다운로드 진행. default true. false 면 사용자가
   *  banner 의 "지금 받기" 클릭 시에만 다운로드. */
  autoDownload: boolean;
}

/**
 * 0.7.7 — external world access surface. AI 의 webFetch / webSearch 도구
 * 의 main-process 대응. 모두 read-only — IR 변경 없음, 네트워크만 사용.
 *
 * CSP: 본 호출은 renderer 의 fetch 가 아니라 main process 에서 실행 →
 * 렌더러 CSP 우회 없이 임의 도메인 접근 가능. URL scheme 은 http/https
 * 만 허용 (main 측 validator).
 */
export interface WebFetchRequest {
  url: string;
  /** AI 가 받은 본문에서 추출하고 싶은 의도 hint. 호출 결과에 echo. */
  prompt?: string;
  /** 응답 본문의 최대 byte 수. 기본 32768. */
  maxBytes?: number;
}
export interface WebFetchResult {
  ok: boolean;
  /** 응답 status code (200 / 404 등). */
  status?: number;
  /** content-type 헤더. */
  contentType?: string;
  /** 응답 본문을 plain text 로 추출. HTML 은 Readability 로 article 본문
   *  추출 후 fallback 으로 regex tag-strip. */
  text?: string;
  /** 본문이 maxBytes 초과로 잘림. */
  truncated?: boolean;
  /** 원본 byte 길이 (잘리기 전). */
  originalBytes?: number;
  /** 실패 시 사유 (timeout / network / 4xx / 5xx). */
  error?: string;
  // 0.7.10 — Readability article metadata (HTML 일 때만 채워짐).
  /** Article 제목 (Readability 추출). non-article 페이지면 undefined. */
  title?: string;
  /** Author / byline. */
  byline?: string;
  /** Article 요약 (meta description 등). */
  excerpt?: string;
  /** Site 이름 (e.g. "MDN Web Docs"). */
  siteName?: string;
  /** 추출 방법: 'readability' (article 추출 성공) 또는 'regex' (fallback). */
  extractionMethod?: 'readability' | 'regex';
}
export interface WebSearchRequest {
  query: string;
  /** 결과 최대 개수. 1-20, 기본 10. */
  maxResults?: number;
}
export interface WebSearchResultItem {
  title: string;
  url: string;
  /** 검색엔진이 제공한 짧은 snippet (없을 수 있음). */
  snippet?: string;
}
export interface WebSearchResult {
  ok: boolean;
  query: string;
  results: WebSearchResultItem[];
  error?: string;
}
/**
 * 0.7.8 — 검색 backend 의 API 키 등록. plaintext key 는 renderer 에
 * 노출 안 함 (get 미제공) — main process 가 직접 사용.
 *
 * `'brave'` = Brave Search API (https://api.search.brave.com). 무료
 * tier 2000 q/month. JSON 응답, 빠름.
 *
 * 키 없으면 DDG HTML scraping fallback.
 */
export type WebSearchBackend = 'brave';
export type ActiveSearchBackend = WebSearchBackend | 'ddg';
export interface WebApi {
  fetch: (req: WebFetchRequest) => Promise<WebFetchResult>;
  search: (req: WebSearchRequest) => Promise<WebSearchResult>;
  /** 0.7.8 — search backend key 관리 (Brave). */
  setSearchKey: (backend: WebSearchBackend, key: string) => Promise<void>;
  hasSearchKey: (backend: WebSearchBackend) => Promise<boolean>;
  deleteSearchKey: (backend: WebSearchBackend) => Promise<void>;
  /** 현재 활성 backend ('ddg' = key 없음 / fallback). UI 가 표시. */
  getActiveSearchBackend: () => Promise<ActiveSearchBackend>;
}

/**
 * 0.7.9 — Bash 명령 실행 surface.
 *
 * **Default OFF + allowlist 기반.** AI catalog 에 노출되려면:
 *   1. `bash.setEnabled(true)` (사용자가 Settings UI 에서 토글)
 *   2. allowlist 가 비어있지 않음
 *
 * 두 조건 모두 만족하면 `runCommand` 도구가 cross-doc-research 외의
 * mode catalog 에 포함됨. allowlist 가 비어있으면 enable 해도 모든
 * 호출 거부 (deny-by-default).
 *
 * **보안 모델:**
 * - Allowlist: 명령의 prefix 가 등록 패턴 중 하나와 매치해야 함
 * - Hardcoded blocklist: `rm -rf /` / `sudo` / `:(){:|:&};:` / `>` etc.
 *   (사용자가 allowlist 에 넣었더라도 거부)
 * - cwd: workspace root 기준 상대 경로만, 절대 경로 거부
 * - Timeout: 60s 기본, 사용자 설정 가능 (최대 5분)
 * - Output cap: stdout / stderr 각 32KB
 *
 * **renderer 노출:**
 * - enable/disable + allowlist 조회/설정 (Settings UI 가 사용)
 * - 실행 자체는 AI tool dispatcher 만 — UI 에서 직접 호출 안 함.
 */
export interface BashRunRequest {
  command: string;
  /** workspace root 기준 상대 경로. 없으면 root 사용. */
  cwd?: string;
  /** ms, 기본 60_000, 최대 300_000. */
  timeoutMs?: number;
}
export interface BashRunResult {
  ok: boolean;
  /** 거부 사유 (allowlist / blocklist / cwd / timeout / exec error). */
  reason?: string;
  /** child process exit code. 정상 종료 시 0. */
  exitCode?: number;
  /** stdout (32KB cap). */
  stdout?: string;
  /** stderr (32KB cap). */
  stderr?: string;
  /** stdout 가 cap 초과로 잘림. */
  truncatedStdout?: boolean;
  /** stderr 가 cap 초과로 잘림. */
  truncatedStderr?: boolean;
}
export interface BashApi {
  /** 토글: 도구 활성화 여부. 기본 false. */
  isEnabled: () => Promise<boolean>;
  setEnabled: (on: boolean) => Promise<void>;
  /** Allowlist 조회 (사용자가 등록한 명령 prefix 들). */
  getAllowlist: () => Promise<string[]>;
  setAllowlist: (patterns: string[]) => Promise<void>;
  /**
   * 명령 실행. **AI tool dispatcher (`src/features/chat/tools.ts`) 만
   * 호출.** UI 가 직접 호출하면 사용자가 의도하지 않은 입력 발사 위험 —
   * Settings UI 에선 read/write 만 사용. 안전 게이트는 main process IPC
   * 핸들러가 처리 (allowlist / blocklist / cwd / timeout / output cap).
   */
  run: (req: BashRunRequest) => Promise<BashRunResult>;
}

export interface UpdaterApi {
  /** 현 상태 snapshot. 첫 mount 시 useEffect 에서 가져와 초기 화면. */
  getState: () => Promise<UpdaterState>;
  /** Manual "지금 확인". 결과는 onEvent 로 흘러옴. */
  checkNow: () => Promise<void>;
  /** `available` 상태에서 사용자가 "지금 받기" 누름. autoDownload=true 면
   *  보통 자동 진행 — 본 호출은 fallback / manual retry. */
  downloadUpdate: () => Promise<void>;
  /** `downloaded` 상태에서 "재시작해서 설치" 누름. 앱 종료 + 설치. */
  quitAndInstall: () => Promise<void>;
  /**
   * autoUpdater 의 모든 이벤트 broadcast 구독. handler 가 매 state 전환
   * 시 호출. unsubscriber 반환.
   */
  onEvent: (handler: (state: UpdaterState) => void) => () => void;
  /** 0.6.8 — 현 사용자 설정 조회. */
  getPrefs: () => Promise<UpdaterPrefs>;
  /** 0.6.8 — 설정 갱신. 즉시 main 의 autoUpdater 인스턴스에 live 반영. */
  setPrefs: (patch: Partial<UpdaterPrefs>) => Promise<UpdaterPrefs>;
}

declare global {
  interface Window {
    api: AhwpApi;
  }
}

export {};
