import { clipboard, ipcMain } from 'electron';

/**
 * System clipboard bridge. Renderer is sandboxed and can't touch
 * `clipboard` directly — IPC marshals plain text only. HTML or rich
 * formats are deliberately omitted from this surface; pasteHtml flows
 * route through file IPC if needed in a future chunk.
 */
export function registerClipboardIpc(): void {
  ipcMain.handle('clipboard:read-text', async (): Promise<string> => {
    return clipboard.readText();
  });
  ipcMain.handle(
    'clipboard:write-text',
    async (_event, text: string): Promise<void> => {
      if (typeof text !== 'string') {
        throw new Error('clipboard:write-text requires a string');
      }
      clipboard.writeText(text);
    },
  );
}
