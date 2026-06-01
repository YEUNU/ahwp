/**
 * compactVisionImages 단위 테스트 (0.7.27).
 *
 * Agent 루프가 매 턴 history 전체를 재전송하는데, 0.7.25 시각 self-verification
 * 으로 getPageSvg(=PNG base64) 호출이 누적되면 토큰이 폭증. 오래된 페이지
 * 렌더 이미지만 떼어내(텍스트·pairing 보존) 비용을 잡는다.
 */
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/ai';
import {
  compactVisionImages,
  compactOldLargeReads,
  compactAgentHistory,
} from './compact-history';

const toolImg = (id: string, b64: string): ChatMessage => ({
  role: 'tool',
  content: 'page svg',
  toolResult: {
    id,
    content: `ok: getPageSvg ${id}`,
    imageBase64: b64,
    imageMediaType: 'image/png',
  },
});
const userMsg = (t: string): ChatMessage => ({ role: 'user', content: t });
const toolText = (id: string): ChatMessage => ({
  role: 'tool',
  content: 'r',
  toolResult: { id, content: 'ok' },
});

describe('compactVisionImages', () => {
  it('이미지가 keep 이하면 그대로 (동일 참조)', () => {
    const msgs = [userMsg('hi'), toolImg('a', 'AAAA')];
    const out = compactVisionImages(msgs, 1);
    expect(out).toBe(msgs); // no-op → 동일 배열
  });

  it('최신 1장만 유지, 오래된 이미지는 strip + 마커', () => {
    const msgs = [
      toolImg('img1', 'OLD1'),
      userMsg('mid'),
      toolImg('img2', 'OLD2'),
      toolImg('img3', 'LATEST'),
    ];
    const out = compactVisionImages(msgs, 1);
    // 최신(img3)만 이미지 유지.
    expect(out[3].toolResult?.imageBase64).toBe('LATEST');
    // 오래된 둘은 imageBase64 제거.
    expect(out[0].toolResult?.imageBase64).toBeUndefined();
    expect(out[2].toolResult?.imageBase64).toBeUndefined();
    expect(out[0].toolResult?.imageMediaType).toBeUndefined();
    // pairing(id) 는 보존, content 는 compact 마커로 교체 (SVG 텍스트도 제거).
    expect(out[0].toolResult?.id).toBe('img1');
    expect(out[0].toolResult?.content).toContain('omitted');
    expect(out[0].toolResult?.content).not.toContain('getPageSvg img1');
    // 이미지 없는 메시지는 동일 참조로 통과.
    expect(out[1]).toBe(msgs[1]);
  });

  it('keep=2 면 최신 2장 유지', () => {
    const msgs = [toolImg('a', '1'), toolImg('b', '2'), toolImg('c', '3')];
    const out = compactVisionImages(msgs, 2);
    expect(out[0].toolResult?.imageBase64).toBeUndefined();
    expect(out[1].toolResult?.imageBase64).toBe('2');
    expect(out[2].toolResult?.imageBase64).toBe('3');
  });

  it('입력 불변 (원본 미변경)', () => {
    const msgs = [toolImg('a', 'OLD'), toolImg('b', 'NEW')];
    compactVisionImages(msgs, 1);
    expect(msgs[0].toolResult?.imageBase64).toBe('OLD'); // 원본 그대로
  });

  it('이미지 없는 텍스트 tool-result 는 영향 없음', () => {
    const msgs = [toolText('t1'), toolImg('i1', 'X'), toolText('t2')];
    const out = compactVisionImages(msgs, 1);
    expect(out[0]).toBe(msgs[0]);
    expect(out[2]).toBe(msgs[2]);
    expect(out[1].toolResult?.imageBase64).toBe('X'); // 유일 이미지 유지
  });

  it('keep=0 이면 모든 이미지 strip', () => {
    const msgs = [toolImg('a', '1'), toolImg('b', '2')];
    const out = compactVisionImages(msgs, 0);
    expect(out[0].toolResult?.imageBase64).toBeUndefined();
    expect(out[1].toolResult?.imageBase64).toBeUndefined();
  });
});

describe('compactOldLargeReads (0.7.33 — text aging)', () => {
  const bigRead = (id: string): ChatMessage => ({
    role: 'tool',
    content: 'X'.repeat(5000), // > 4096 threshold
    toolResult: { id, content: 'X'.repeat(5000) },
  });
  const smallRead = (id: string): ChatMessage => ({
    role: 'tool',
    content: 'small',
    toolResult: { id, content: 'small' },
  });
  const errRead = (id: string): ChatMessage => ({
    role: 'tool',
    content: 'E'.repeat(5000),
    toolResult: { id, content: 'E'.repeat(5000), isError: true },
  });

  it('최근 N개 외 오래된 대형 read 만 trim', () => {
    // 8 big reads, keepRecent=6 → 앞 2개만 trim 대상.
    const msgs = Array.from({ length: 8 }, (_, i) => bigRead(`r${i}`));
    const out = compactOldLargeReads(msgs, 6);
    expect(out[0].toolResult?.content).toContain('trimmed');
    expect(out[1].toolResult?.content).toContain('trimmed');
    // 최근 6개는 full.
    for (let i = 2; i < 8; i++) {
      expect(out[i].toolResult?.content).toBe('X'.repeat(5000));
    }
  });

  it('작은 결과는 trim 안 함', () => {
    const msgs = [
      smallRead('a'),
      ...Array.from({ length: 6 }, (_, i) => bigRead(`b${i}`)),
    ];
    const out = compactOldLargeReads(msgs, 6);
    expect(out[0].toolResult?.content).toBe('small'); // 작아서 보존
  });

  it('에러 결과는 보존 (재시도 판단용)', () => {
    const msgs = [
      errRead('e'),
      ...Array.from({ length: 6 }, (_, i) => bigRead(`b${i}`)),
    ];
    const out = compactOldLargeReads(msgs, 6);
    expect(out[0].toolResult?.content).toBe('E'.repeat(5000)); // 에러 full 보존
  });

  it('tool-result 수 ≤ keep 이면 no-op (동일 참조)', () => {
    const msgs = [bigRead('a'), bigRead('b')];
    expect(compactOldLargeReads(msgs, 6)).toBe(msgs);
  });

  it('입력 불변', () => {
    const msgs = Array.from({ length: 8 }, (_, i) => bigRead(`r${i}`));
    compactOldLargeReads(msgs, 6);
    expect(msgs[0].toolResult?.content).toBe('X'.repeat(5000));
  });

  it('trim 시 prefix + 마커 (pairing id 보존)', () => {
    const msgs = Array.from({ length: 7 }, (_, i) => bigRead(`r${i}`));
    const out = compactOldLargeReads(msgs, 6);
    expect(out[0].toolResult?.id).toBe('r0');
    expect(out[0].toolResult?.content.length).toBeLessThan(600);
    expect(out[0].toolResult?.content).toContain('trimmed');
  });
});

describe('compactAgentHistory (0.7.33 — 통합)', () => {
  it('이미지 prune + 오래된 대형 read trim 동시 적용', () => {
    const img = (id: string, b: string): ChatMessage => ({
      role: 'tool',
      content: 'svg',
      toolResult: {
        id,
        content: 'svg',
        imageBase64: b,
        imageMediaType: 'image/png',
      },
    });
    const big = (id: string): ChatMessage => ({
      role: 'tool',
      content: 'X'.repeat(5000),
      toolResult: { id, content: 'X'.repeat(5000) },
    });
    const msgs = [
      img('i1', 'OLD'),
      ...Array.from({ length: 7 }, (_, i) => big(`b${i}`)),
      img('i2', 'NEW'),
    ];
    const out = compactAgentHistory(msgs);
    // 오래된 이미지 strip, 최신 이미지 유지.
    expect(out[0].toolResult?.imageBase64).toBeUndefined();
    expect(out[out.length - 1].toolResult?.imageBase64).toBe('NEW');
    // 오래된 대형 read 일부 trim (전체 9 tool-result, keep 6 → 앞 3 trim 대상).
    expect(out[1].toolResult?.content).toContain('trimmed');
  });
});
