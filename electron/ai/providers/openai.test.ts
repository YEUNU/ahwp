/**
 * Unit tests for openai.ts response-API input sanitization.
 *
 * 0.6.14 — fixes the 400 "No tool call found for function call output
 * with call_id ..." that fired when an upstream renderer state bug
 * (StrictMode double-fire of fireChat inside setMessages updater)
 * orphaned tool-results from prior turns.
 */
import { describe, expect, it } from 'vitest';
import {
  sanitizeResponsesInput,
  toOpenAIMessages,
  toResponsesInputItems,
} from './openai';
import type { ChatMessage } from '../../../shared/ai';

describe('sanitizeResponsesInput', () => {
  it('passes through a valid paired conversation', () => {
    const input = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      {
        type: 'function_call',
        call_id: 'call_A',
        name: 'foo',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call_A', output: 'ok' },
      { role: 'assistant', content: 'done' },
    ];
    const out = sanitizeResponsesInput(input);
    expect(out.droppedCount).toBe(0);
    expect(out.items).toHaveLength(input.length);
  });

  it('drops orphan function_call_output (no matching function_call)', () => {
    const input = [
      { role: 'user', content: 'q' },
      // Assistant turn lost its toolUses (StrictMode race), so no
      // function_call here — but the tool result still arrives.
      { role: 'assistant', content: '' },
      { type: 'function_call_output', call_id: 'call_ORPHAN', output: 'data' },
      { role: 'user', content: 'next' },
    ];
    const out = sanitizeResponsesInput(input);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedIds).toEqual(['call_ORPHAN']);
    // The function_call_output item is gone; everything else preserved.
    expect(out.items.some((i) => i.type === 'function_call_output')).toBe(
      false,
    );
    expect(out.items).toHaveLength(3);
  });

  it('keeps outputs whose call_id IS present, drops only the orphan', () => {
    const input = [
      {
        type: 'function_call',
        call_id: 'call_A',
        name: 'foo',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call_A', output: 'a' },
      // No function_call for call_B — orphan.
      { type: 'function_call_output', call_id: 'call_B', output: 'b' },
      {
        type: 'function_call',
        call_id: 'call_C',
        name: 'bar',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call_C', output: 'c' },
    ];
    const out = sanitizeResponsesInput(input);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedIds).toEqual(['call_B']);
    const ids = out.items
      .filter((i) => i.type === 'function_call_output')
      .map((i) => i.call_id);
    expect(ids).toEqual(['call_A', 'call_C']);
  });

  it('drops function_call_output that arrives BEFORE its function_call', () => {
    // OpenAI Responses API requires function_call to come first in the
    // input order. Out-of-order tool results should also be dropped (the
    // assistant_turn ordering invariant is what protects pairing).
    const input = [
      { type: 'function_call_output', call_id: 'call_X', output: 'early' },
      {
        type: 'function_call',
        call_id: 'call_X',
        name: 'foo',
        arguments: '{}',
      },
    ];
    const out = sanitizeResponsesInput(input);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedIds).toEqual(['call_X']);
  });

  it('handles function_call_output with no call_id (defensive)', () => {
    const input = [
      { role: 'user', content: 'q' },
      { type: 'function_call_output', output: 'no id' },
    ];
    const out = sanitizeResponsesInput(input);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedIds).toEqual(['<missing>']);
  });

  it('preserves order of surviving items', () => {
    const input = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u1' },
      {
        type: 'function_call',
        call_id: 'call_A',
        name: 'foo',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call_GHOST', output: 'x' },
      { type: 'function_call_output', call_id: 'call_A', output: 'a' },
      { role: 'assistant', content: 'done' },
    ];
    const out = sanitizeResponsesInput(input);
    expect(out.items.map((i) => i.type ?? i.role)).toEqual([
      'system',
      'user',
      'function_call',
      'function_call_output',
      'assistant',
    ]);
  });
});

// 0.6.20 — vision integration. tool_result 에 imageBase64/imageMediaType 이
// 있으면 chat-completions / responses 양쪽 형식 모두 image-carrying user
// 메시지를 inject. AI 가 다음 turn 에서 image 도 함께 보고 추론.
describe('vision: tool_result image attachment (chat-completions toOpenAIMessages)', () => {
  it('passes-through plain tool_result (no image) as single tool message', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: '{"ok":true}',
      toolResult: { id: 'call_A', content: '{"ok":true}' },
    };
    const out = toOpenAIMessages(msg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_A',
      content: '{"ok":true}',
    });
  });

  it('appends user message with image_url when tool_result has imageBase64', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: '{"pageIdx":0,"svg":"..."}',
      toolResult: {
        id: 'call_PAGE',
        content: '{"pageIdx":0,"svg":"..."}',
        imageBase64: 'iVBORw0KGgo=',
        imageMediaType: 'image/png',
      },
    };
    const out = toOpenAIMessages(msg);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'tool', tool_call_id: 'call_PAGE' });
    expect(out[1]).toMatchObject({ role: 'user' });
    const content = out[1].content as {
      type: string;
      image_url?: { url: string };
    }[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url?.url).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });
});

describe('vision: tool_result image attachment (responses API toResponsesInputItems)', () => {
  it('plain tool_result → single function_call_output item', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: 'ok',
      toolResult: { id: 'call_X', content: 'ok' },
    };
    const out = toResponsesInputItems(msg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call_X',
      output: 'ok',
    });
  });

  it('with imageBase64 → function_call_output + user message with input_image', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: '{"pageIdx":1}',
      toolResult: {
        id: 'call_PAGE',
        content: '{"pageIdx":1}',
        imageBase64: 'PNGDATA',
        imageMediaType: 'image/png',
      },
    };
    const out = toResponsesInputItems(msg);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call_PAGE',
    });
    expect(out[1]).toMatchObject({ role: 'user' });
    const content = out[1].content as { type: string; image_url?: string }[];
    expect(content[0].type).toBe('input_text');
    expect(content[1].type).toBe('input_image');
    expect(content[1].image_url).toBe('data:image/png;base64,PNGDATA');
  });
});
