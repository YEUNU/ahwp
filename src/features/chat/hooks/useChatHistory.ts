/**
 * `useChatHistory` — Phase R2.1 refactor (REFACTORING_PLAN.md).
 *
 * ChatPanel.tsx 의 chat history 측면 (sidebar listing + load/select/
 * delete/rename + new conversation) 을 hook 으로 분해. SQLite IPC
 * (chatHistory.{list,get,delete,rename}) 호출 / inline rename
 * (chunk 30) / auto-title 마킹 자연 reset 모두 보존.
 *
 * 외부 의존: activeDocPath, conversationIdRef, streaming, message·
 * conversation·error·excerpt setters. 호출자는 refresh 콜백을
 * `refreshHistoryRef.current` 로 노출 — 자동 새로고침 (e.g. on send
 * 완료) 시 stale closure 없이 호출.
 */
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { ChatMessage } from '@shared/ai';
import type { ExcerptAttachment } from '@shared/ai-excerpt';

export interface ChatHistoryRow {
  id: number;
  docPath: string | null;
  title: string;
  updatedAt: number;
}

/** Subset of caller's `HistoryMessage`. Hook only sets/reads role+content+id. */
interface HistoryMessage extends ChatMessage {
  id: string;
}

export interface UseChatHistoryOptions {
  activeDocPath?: () => string | null;
  conversationIdRef: MutableRefObject<number | null>;
  streaming: boolean;
  setMessages: Dispatch<SetStateAction<HistoryMessage[]>>;
  setConversationId: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setExcerpts: Dispatch<SetStateAction<ExcerptAttachment[]>>;
  setExcerptError: Dispatch<SetStateAction<string | null>>;
  /** Mirror slot for `refreshHistory`. The hook writes to
   * `current` so handlers (send completion, etc.) read latest. */
  refreshHistoryRef: MutableRefObject<(() => Promise<void>) | null>;
}

export interface ChatHistoryHandle {
  historyList: ChatHistoryRow[];
  setHistoryList: Dispatch<SetStateAction<ChatHistoryRow[]>>;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  renamingId: number | null;
  renameDraft: string;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  refreshHistory: () => Promise<void>;
  newConversation: () => void;
  loadConversation: (id: number) => Promise<void>;
  deleteHistoryItem: (id: number) => Promise<void>;
  beginRename: (id: number, currentTitle: string | null) => void;
  cancelRename: () => void;
  commitRename: (id: number) => Promise<void>;
}

export function useChatHistory(opts: UseChatHistoryOptions): ChatHistoryHandle {
  const {
    activeDocPath,
    conversationIdRef,
    streaming,
    setMessages,
    setConversationId,
    setError,
    setExcerpts,
    setExcerptError,
    refreshHistoryRef,
  } = opts;

  const [historyList, setHistoryList] = useState<ChatHistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Inline rename — chunk 30. Double-click on a conversation title swaps
  // it for an input; Enter persists, Esc cancels. The conversation row
  // shows the new title immediately via optimistic local update; the
  // chatHistory.rename IPC writes through to SQLite. On failure we revert
  // by re-fetching the list.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      const docPath = activeDocPath?.() ?? null;
      const rows = await window.api.chatHistory.list(docPath);
      setHistoryList(
        rows.map((r) => ({
          id: r.id,
          docPath: r.docPath,
          title: r.title,
          updatedAt: r.updatedAt,
        })),
      );
    } catch (err) {
      console.warn('[chat] history.list failed', err);
    }
  }, [activeDocPath]);

  useEffect(() => {
    refreshHistoryRef.current = refreshHistory;
  }, [refreshHistory, refreshHistoryRef]);

  const newConversation = useCallback((): void => {
    if (streaming) return;
    setMessages([]);
    setConversationId(null);
    conversationIdRef.current = null;
    setError(null);
    setExcerpts([]);
    setExcerptError(null);
    setHistoryOpen(false);
    // chunk 31 — 새 대화 시작 시 auto-title 마킹은 conversation id 단위
    // 라 따로 clear할 필요 없음 (id가 새로 발급될 때 자연히 미마킹 상태).
  }, [
    streaming,
    setMessages,
    setConversationId,
    conversationIdRef,
    setError,
    setExcerpts,
    setExcerptError,
  ]);

  const loadConversation = useCallback(
    async (id: number): Promise<void> => {
      try {
        const r = await window.api.chatHistory.get(id);
        setMessages(
          r.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: `db-${m.id}`,
              role: m.role,
              content: m.content,
            })),
        );
        setConversationId(id);
        conversationIdRef.current = id;
        setHistoryOpen(false);
        setError(null);
      } catch (err) {
        console.warn('[chat] history.get failed', err);
      }
    },
    [setMessages, setConversationId, conversationIdRef, setError],
  );

  const deleteHistoryItem = useCallback(
    async (id: number): Promise<void> => {
      try {
        await window.api.chatHistory.delete(id);
        // If we deleted the currently-loaded conversation, reset to a fresh chat.
        if (conversationIdRef.current === id) {
          newConversation();
        }
        await refreshHistory();
      } catch (err) {
        console.warn('[chat] history.delete failed', err);
      }
    },
    [conversationIdRef, newConversation, refreshHistory],
  );

  const beginRename = useCallback(
    (id: number, currentTitle: string | null): void => {
      setRenamingId(id);
      setRenameDraft(currentTitle ?? '');
    },
    [],
  );

  const cancelRename = useCallback((): void => {
    setRenamingId(null);
    setRenameDraft('');
  }, []);

  const commitRename = useCallback(
    async (id: number): Promise<void> => {
      const next = renameDraft.trim();
      if (next.length === 0) {
        cancelRename();
        return;
      }
      // Optimistic update so the row reflects the new title before the
      // IPC round-trip completes.
      setHistoryList((prev) =>
        prev.map((row) => (row.id === id ? { ...row, title: next } : row)),
      );
      setRenamingId(null);
      setRenameDraft('');
      try {
        await window.api.chatHistory.rename(id, next);
      } catch (err) {
        console.warn('[chat] history.rename failed', err);
        // Revert: re-fetch authoritative list from SQLite.
        await refreshHistory();
      }
    },
    [renameDraft, cancelRename, refreshHistory],
  );

  return {
    historyList,
    setHistoryList,
    historyOpen,
    setHistoryOpen,
    renamingId,
    renameDraft,
    setRenameDraft,
    refreshHistory,
    newConversation,
    loadConversation,
    deleteHistoryItem,
    beginRename,
    cancelRename,
    commitRename,
  };
}
