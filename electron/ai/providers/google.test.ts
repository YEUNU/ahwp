/**
 * Unit tests for google.ts Gemini message conversion — 0.6.20 vision integration.
 */
import { describe, expect, it } from 'vitest';
import { toGeminiBody } from './google';
import type { ChatMessage } from '../../../shared/ai';

describe('toGeminiBody', () => {
  it('passes-through plain tool result as single functionResponse', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolUses: [{ id: 'call_A', name: 'foo', args: { a: 1 } }],
      },
      {
        role: 'tool',
        content: 'ok',
        toolResult: { id: 'call_A', content: 'ok' },
      },
    ];
    const { contents } = toGeminiBody(messages);
    // assistant (functionCall) + tool (functionResponse) — 2 entries.
    expect(contents).toHaveLength(2);
    expect(contents[1].role).toBe('user');
    expect(contents[1].parts[0].functionResponse).toMatchObject({
      name: 'foo',
      response: { result: 'ok' },
    });
  });

  it('vision: appends user message with inlineData when toolResult has image', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolUses: [
          { id: 'call_PAGE', name: 'getPageSvg', args: { pageIdx: 0 } },
        ],
      },
      {
        role: 'tool',
        content: '{"pageIdx":0}',
        toolResult: {
          id: 'call_PAGE',
          content: '{"pageIdx":0}',
          imageBase64: 'GEMINIDATA',
          imageMediaType: 'image/png',
        },
      },
    ];
    const { contents } = toGeminiBody(messages);
    // assistant + tool functionResponse + image user message — 3 entries.
    expect(contents).toHaveLength(3);
    expect(contents[2].role).toBe('user');
    expect(contents[2].parts[0].text).toContain('Tool image attachment');
    expect(contents[2].parts[1].inlineData).toEqual({
      mimeType: 'image/png',
      data: 'GEMINIDATA',
    });
  });

  it('system messages collapse into systemInstruction', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ];
    const { systemInstruction, contents } = toGeminiBody(messages);
    expect(systemInstruction?.parts[0].text).toBe('sys1\n\nsys2');
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
  });
});
