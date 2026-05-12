import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import type { AhwpApi } from '@shared/api';

describe('App', () => {
  beforeEach(() => {
    const mockApi: AhwpApi = {
      ping: vi.fn().mockResolvedValue({
        pong: 'hello from renderer',
        at: 1700000000000,
        platform: 'win32',
        electron: '33.0.0',
      }),
      onMenuAction: vi.fn().mockReturnValue(() => {}),
      newWindow: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn().mockResolvedValue(undefined),
      clearCaches: vi.fn().mockResolvedValue({ removed: [], failed: [] }),
      getVersions: vi.fn().mockResolvedValue({
        app: '0.0.0-test',
        electron: '33.0.0',
        chrome: '120.0.0',
        node: '20.0.0',
        platform: 'darwin',
        arch: 'arm64',
        rhwpCore: '0.7.9',
      }),
      file: {
        new: vi.fn().mockResolvedValue({ path: '/tmp/new.hwp' }),
        open: vi.fn().mockResolvedValue(null),
        openByPath: vi.fn().mockResolvedValue(null),
        listRecent: vi.fn().mockResolvedValue([]),
        read: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        save: vi.fn().mockResolvedValue({ path: '' }),
        saveAs: vi.fn().mockResolvedValue(null),
        exportHtml: vi.fn().mockResolvedValue(null),
        exportPdf: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn().mockReturnValue(''),
        watchPaths: vi.fn().mockResolvedValue(undefined),
        onExternalChange: vi.fn().mockReturnValue(() => {}),
        saveDraft: vi.fn().mockResolvedValue(undefined),
        hasDraft: vi.fn().mockResolvedValue(false),
        loadDraft: vi.fn().mockResolvedValue(null),
        clearDraft: vi.fn().mockResolvedValue(undefined),
        createVersion: vi.fn().mockResolvedValue(undefined),
        listVersions: vi.fn().mockResolvedValue([]),
        readVersion: vi.fn().mockResolvedValue(null),
      },
      session: {
        get: vi.fn().mockResolvedValue({ lastActivePath: null }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      clipboard: {
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      folder: {
        pick: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        searchText: vi.fn().mockResolvedValue({
          status: 'ok',
          hits: [],
          scanned: 0,
          skipped: 0,
        }),
        watch: vi.fn().mockResolvedValue(undefined),
        unwatch: vi.fn().mockResolvedValue(undefined),
        onChange: vi.fn().mockReturnValue(() => {}),
        createFile: vi.fn().mockResolvedValue(''),
        createFolder: vi.fn().mockResolvedValue(''),
        rename: vi.fn().mockResolvedValue(undefined),
        trash: vi.fn().mockResolvedValue(undefined),
        reveal: vi.fn().mockResolvedValue(undefined),
        copy: vi.fn().mockResolvedValue(''),
        listOutlines: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [],
          scanned: 0,
          skipped: 0,
        }),
        readParagraph: vi.fn().mockResolvedValue({ ok: false, reason: 'mock' }),
        resolveExternalImages: vi.fn().mockResolvedValue([]),
      },
      secrets: {
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        has: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
        onChanged: vi.fn().mockReturnValue(() => {}),
      },
      ai: {
        chat: vi.fn().mockReturnValue({ abort: vi.fn() }),
        ping: vi.fn().mockResolvedValue(undefined),
        listModels: vi
          .fn()
          .mockResolvedValue({ status: 'ok', models: [], fetchedAt: 0 }),
        clearModelsCache: vi.fn().mockResolvedValue(undefined),
        getProviderConfig: vi.fn().mockResolvedValue({}),
        setProviderConfig: vi.fn().mockResolvedValue({ ok: true }),
      },
      chatHistory: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({ messages: [] }),
        create: vi.fn().mockResolvedValue({ id: 1 }),
        append: vi.fn().mockResolvedValue({ id: 1 }),
        rename: vi.fn().mockResolvedValue({ ok: true }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    Object.defineProperty(window, 'api', {
      value: mockApi,
      writable: true,
      configurable: true,
    });
  });

  it('renders three-pane layout', () => {
    render(<App />);
    // No folder selected → left panel header shows "폴더" placeholder.
    expect(screen.getByText('폴더')).toBeInTheDocument();
    expect(screen.getByText('챗봇')).toBeInTheDocument();
    // Welcome screen visible — anchor on stable testids (locale-agnostic).
    // jsdom 의 navigator.language 가 'en-US' 라 i18n 이 영어로 초기화
    // 되어 '안녕하세요.' 텍스트 의존은 환경 fragile.
    expect(screen.getByTestId('welcome-new-doc')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-open')).toBeInTheDocument();
  });

  it('calls ipc:ping on mount', async () => {
    render(<App />);
    await waitFor(() => {
      expect(window.api.ping).toHaveBeenCalledWith({
        message: 'hello from renderer',
      });
    });
  });

  it('renders new-document and open buttons on welcome view', () => {
    render(<App />);
    expect(screen.getByTestId('welcome-new-doc')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-open')).toBeInTheDocument();
  });
});
