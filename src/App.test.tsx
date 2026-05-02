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
      file: {
        new: vi.fn().mockResolvedValue({ path: '/tmp/new.hwp' }),
        open: vi.fn().mockResolvedValue(null),
        openByPath: vi.fn().mockResolvedValue(null),
        listRecent: vi.fn().mockResolvedValue([]),
        read: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        save: vi.fn().mockResolvedValue({ path: '' }),
        saveAs: vi.fn().mockResolvedValue(null),
        exportHtml: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn().mockReturnValue(''),
        watchPaths: vi.fn().mockResolvedValue(undefined),
        onExternalChange: vi.fn().mockReturnValue(() => {}),
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
        watch: vi.fn().mockResolvedValue(undefined),
        unwatch: vi.fn().mockResolvedValue(undefined),
        onChange: vi.fn().mockReturnValue(() => {}),
        createFile: vi.fn().mockResolvedValue(''),
        createFolder: vi.fn().mockResolvedValue(''),
        rename: vi.fn().mockResolvedValue(undefined),
        trash: vi.fn().mockResolvedValue(undefined),
        reveal: vi.fn().mockResolvedValue(undefined),
        copy: vi.fn().mockResolvedValue(''),
      },
      secrets: {
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        has: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      },
      ai: {
        chat: vi.fn().mockReturnValue({ abort: vi.fn() }),
        ping: vi.fn().mockResolvedValue(undefined),
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
    // Welcome screen greeting (UI revamp — "Hello, ahwp" was removed
    // when the marketing area was redesigned).
    expect(screen.getByText('안녕하세요.')).toBeInTheDocument();
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
