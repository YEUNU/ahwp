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
        getPathForFile: vi.fn().mockReturnValue(''),
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
    expect(screen.getByText('Hello, ahwp')).toBeInTheDocument();
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
