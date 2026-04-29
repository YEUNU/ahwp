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
    };
    Object.defineProperty(window, 'api', {
      value: mockApi,
      writable: true,
      configurable: true,
    });
  });

  it('renders three-pane layout', () => {
    render(<App />);
    expect(screen.getByText('파일')).toBeInTheDocument();
    expect(screen.getByText('챗봇')).toBeInTheDocument();
    expect(screen.getByText('Hello, ahwp')).toBeInTheDocument();
  });

  it('calls ipc:ping on mount and renders the response', async () => {
    render(<App />);
    await waitFor(() => {
      expect(window.api.ping).toHaveBeenCalledWith({
        message: 'hello from renderer',
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/hello from renderer/)).toBeInTheDocument();
    });
  });
});
