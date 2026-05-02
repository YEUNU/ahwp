/**
 * Chat history IPC — chunk 26. Exposes the SQLite-backed conversation /
 * message store from `electron/store/chat-history.ts` to the renderer.
 * Channels are domain-scoped under `chat-history:*`.
 */
import { ipcMain } from 'electron';
import * as store from '../store/chat-history';

export function registerChatHistoryIpc(): void {
  ipcMain.handle('chat-history:list', (_e, req: { docPath: string | null }) =>
    store.listConversations(req.docPath),
  );
  ipcMain.handle('chat-history:get', (_e, req: { conversationId: number }) => ({
    messages: store.getMessages(req.conversationId),
  }));
  ipcMain.handle(
    'chat-history:create',
    (_e, req: { docPath: string | null; title: string }) => ({
      id: store.createConversation(req.docPath, req.title),
    }),
  );
  ipcMain.handle(
    'chat-history:append',
    (
      _e,
      req: {
        conversationId: number;
        role: 'system' | 'user' | 'assistant';
        content: string;
      },
    ) => ({
      id: store.appendMessage(req.conversationId, req.role, req.content),
    }),
  );
  ipcMain.handle(
    'chat-history:rename',
    (_e, req: { id: number; title: string }) => {
      store.renameConversation(req.id, req.title);
      return { ok: true };
    },
  );
  ipcMain.handle('chat-history:delete', (_e, req: { id: number }) => {
    store.deleteConversation(req.id);
    return { ok: true };
  });
}
