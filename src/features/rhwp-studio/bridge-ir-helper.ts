/**
 * `BridgeIrHelper` — Phase 7 Phase D2a.
 *
 * ahwp 의 AI tools (`src/features/chat/tools.ts`) 가 호출하는 `viewer.irX`
 * surface 의 bridge-backed 구현. Phase E 에서 StudioViewer 가 사라진 뒤
 * tools.ts 가 `viewer.irX(...)` 대신 `helper.irX(...)` 를 호출하도록
 * 단계적으로 옮긴다.
 *
 * 패턴:
 * - 단순 passthrough — `bridge.invokeWasm(fn, [...args])` 한 줄.
 * - composite — wasm-bridge 가 단일 메서드로 제공하지 않는 케이스
 *   (예: 멀티 paragraph getTextRange) 는 여러 invokeWasm 호출을 조합.
 *   기존 useViewerHandle 의 로직을 그대로 옮긴다.
 * - JSON 응답 — wasm-bridge 는 일부 메서드를 JSON string 으로 돌려준다
 *   (insertText 의 `{"ok":true,...}` 등). helper 는 parsing 도 책임.
 *
 * 본 클래스는 D2a 의 초기 subset 만 구현. D2b/D2c/... 에서 ir* 전체 커버.
 */
import type { RhwpBridge } from '@/lib/rhwp-bridge';
import type { RhwpCaretPosition, RhwpSearchHit } from '@shared/rhwp-bridge';

/** wasm-bridge 의 write op 들이 돌려주는 status JSON 의 공통 모양. */
interface IrOpResult {
  ok?: boolean;
}

function isOk(raw: unknown): boolean {
  if (typeof raw !== 'string') return Boolean(raw);
  try {
    const parsed = JSON.parse(raw) as IrOpResult;
    return parsed.ok !== false;
  } catch {
    // 비-JSON 응답 (예: 빈 문자열) 은 성공으로 간주.
    return true;
  }
}

export class BridgeIrHelper {
  constructor(private readonly bridge: RhwpBridge) {}

  // ── 단순 정보 조회 ─────────────────────────────────────────────

  /** 섹션 개수. doc 미로드 시 0. */
  async getSectionCount(): Promise<number> {
    return await this.bridge.invokeWasm<number>('getSectionCount', []);
  }

  /** 섹션 안 paragraph 개수. */
  async getParagraphCount(sec: number): Promise<number> {
    return await this.bridge.invokeWasm<number>('getParagraphCount', [sec]);
  }

  /** 특정 paragraph 의 글자 길이 (control 객체 제외). */
  async getParagraphLength(sec: number, para: number): Promise<number> {
    return await this.bridge.invokeWasm<number>('getParagraphLength', [
      sec,
      para,
    ]);
  }

  /**
   * 현재 caret 위치. doc 미로드 시 null. wasm-bridge.ts 의
   * `getCaretPosition` 가 이미 JSON.parse 결과를 돌려주므로 그대로 사용.
   */
  async getCaretPosition(): Promise<RhwpCaretPosition | null> {
    return await this.bridge.invokeWasm<RhwpCaretPosition | null>(
      'getCaretPosition',
      [],
    );
  }

  // ── 텍스트 read ─────────────────────────────────────────────────

  /**
   * 멀티 paragraph 텍스트 추출. useViewerHandle 의 composite 로직과 동일.
   * 결과는 paragraph 사이 '\n' 으로 join. 4096 byte 넘으면 trim.
   */
  async getTextRange(
    sec: number,
    startPara: number,
    startOffset: number,
    endPara: number,
    endOffset: number,
    maxBytes = 4096,
  ): Promise<string> {
    let out: string;
    if (startPara === endPara) {
      out = await this.bridge.invokeWasm<string>('getTextRange', [
        sec,
        startPara,
        startOffset,
        endOffset - startOffset,
      ]);
    } else {
      const parts: string[] = [];
      const len0 = await this.getParagraphLength(sec, startPara);
      parts.push(
        await this.bridge.invokeWasm<string>('getTextRange', [
          sec,
          startPara,
          startOffset,
          len0 - startOffset,
        ]),
      );
      for (let p = startPara + 1; p < endPara; p++) {
        const lp = await this.getParagraphLength(sec, p);
        parts.push(
          await this.bridge.invokeWasm<string>('getTextRange', [sec, p, 0, lp]),
        );
      }
      parts.push(
        await this.bridge.invokeWasm<string>('getTextRange', [
          sec,
          endPara,
          0,
          endOffset,
        ]),
      );
      out = parts.join('\n');
    }
    const enc = new TextEncoder().encode(out);
    if (enc.length > maxBytes) {
      return new TextDecoder().decode(enc.slice(0, maxBytes)) + '…[trimmed]';
    }
    return out;
  }

  /** 셀 안 paragraph 텍스트. */
  async getTextInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    charOffset: number,
    count: number,
  ): Promise<string> {
    return await this.bridge.invokeWasm<string>('getTextInCell', [
      sec,
      parentPara,
      controlIdx,
      cellIdx,
      cellParaIdx,
      charOffset,
      count,
    ]);
  }

  // ── 검색 ────────────────────────────────────────────────────────

  /**
   * 전체 문서 매치 검색. include_cells=true 면 표 cell 안 매치도 포함.
   * wasm-bridge.ts 의 searchAllText 가 이미 JSON.parse 결과 (`SearchHit[]`)
   * 를 돌려준다.
   */
  async searchAllText(
    query: string,
    caseSensitive = false,
    includeCells = false,
  ): Promise<RhwpSearchHit[]> {
    return await this.bridge.invokeWasm<RhwpSearchHit[]>('searchAllText', [
      query,
      caseSensitive,
      includeCells,
    ]);
  }

  // ── 텍스트 write ─────────────────────────────────────────────────

  /** body paragraph 에 텍스트 삽입. 성공 여부만 반환. */
  async insertText(
    sec: number,
    para: number,
    charOffset: number,
    text: string,
  ): Promise<boolean> {
    const raw = await this.bridge.invokeWasm<string>('insertText', [
      sec,
      para,
      charOffset,
      text,
    ]);
    return isOk(raw);
  }

  /** body paragraph 에서 N 글자 삭제. */
  async deleteText(
    sec: number,
    para: number,
    charOffset: number,
    count: number,
  ): Promise<boolean> {
    const raw = await this.bridge.invokeWasm<string>('deleteText', [
      sec,
      para,
      charOffset,
      count,
    ]);
    return isOk(raw);
  }

  /** 표 셀 안 paragraph 에 텍스트 삽입. */
  async insertTextInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    charOffset: number,
    text: string,
  ): Promise<boolean> {
    const raw = await this.bridge.invokeWasm<string>('insertTextInCell', [
      sec,
      parentPara,
      controlIdx,
      cellIdx,
      cellParaIdx,
      charOffset,
      text,
    ]);
    return isOk(raw);
  }

  // ── Phase D2c-1 — 추가 paragraph / format / read ─────────────────

  /**
   * 멀티 paragraph 범위 삭제. wasm-bridge.deleteRange 가 이미 parsed
   * `{ok, paraIdx, charOffset}` 반환 — .ok 만 추출.
   */
  async deleteRange(
    sec: number,
    startPara: number,
    startOffset: number,
    endPara: number,
    endOffset: number,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>('deleteRange', [
      sec,
      startPara,
      startOffset,
      endPara,
      endOffset,
    ]);
    return r?.ok === true;
  }

  /** 인접 paragraph 와 병합. JSON 상태 응답. */
  async mergeParagraph(sec: number, para: number): Promise<boolean> {
    const raw = await this.bridge.invokeWasm<string>('mergeParagraph', [
      sec,
      para,
    ]);
    return isOk(raw);
  }

  /** Char format 적용. props 는 객체 — JSON.stringify 후 전달. */
  async applyCharFormat(
    sec: number,
    para: number,
    startOffset: number,
    endOffset: number,
    props: Record<string, unknown>,
  ): Promise<boolean> {
    const raw = await this.bridge.invokeWasm<string>('applyCharFormat', [
      sec,
      para,
      startOffset,
      endOffset,
      JSON.stringify(props),
    ]);
    return isOk(raw);
  }

  /** Paragraph style 적용. wasm-bridge.applyStyle 은 parsed `{ok}` 반환. */
  async applyStyle(
    sec: number,
    para: number,
    styleId: number,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>('applyStyle', [
      sec,
      para,
      styleId,
    ]);
    return r?.ok === true;
  }

  /** caret 위치의 char shape 속성. wasm-bridge 가 이미 parsed object 반환. */
  async getCharPropertiesAt(
    sec: number,
    para: number,
    charOffset: number,
  ): Promise<Record<string, unknown>> {
    return await this.bridge.invokeWasm<Record<string, unknown>>(
      'getCharPropertiesAt',
      [sec, para, charOffset],
    );
  }

  /** Paragraph 의 para shape 속성. */
  async getParaPropertiesAt(
    sec: number,
    para: number,
  ): Promise<Record<string, unknown>> {
    return await this.bridge.invokeWasm<Record<string, unknown>>(
      'getParaPropertiesAt',
      [sec, para],
    );
  }

  /**
   * paragraph 의 style 정보. useViewerHandle 의 composite 와 동일 —
   * getStyleAt 으로 styleId 받고 getStyleDetail 로 전체 bag, 합쳐서 반환.
   */
  async getStyleAt(
    sec: number,
    para: number,
  ): Promise<Record<string, unknown>> {
    const at = await this.bridge.invokeWasm<{ styleId?: number; id?: number }>(
      'getStyleAt',
      [sec, para],
    );
    const styleId = at?.styleId ?? at?.id ?? 0;
    const detail = await this.bridge.invokeWasm<Record<string, unknown>>(
      'getStyleDetail',
      [styleId],
    );
    return { ...detail, styleId };
  }

  // ── Phase D2c-2 — 범용 라우터 ─────────────────────────────────────
  //
  // 남은 ~30 ir write/read cases 는 대부분 wasm-bridge 메서드를 그대로
  // 호출하고 `{ok}` 또는 JSON `{"ok":...}` 응답을 확인. 각각에 1-line
  // wrapper 를 두는 대신 두 개의 generic 으로 일괄 처리.

  /**
   * `bridge.invokeWasm(fn, args)` 호출 후 응답을 boolean 으로 정규화.
   * - object 면 `.ok` 확인
   * - JSON string 이면 parse 후 `.ok` 확인 (isOk)
   * - 그 외 truthy 면 true
   * - 호출이 throw 하면 false.
   *
   * 모든 단순 write op (insertTableRow / deleteTableControl / ...) 에 사용.
   */
  async invokeOk(fn: string, args: unknown[]): Promise<boolean> {
    try {
      const r = await this.bridge.invokeWasm<unknown>(fn, args);
      if (r === null || r === undefined) return false;
      if (typeof r === 'string') return isOk(r);
      if (typeof r === 'object' && 'ok' in (r as object))
        return (r as { ok?: boolean }).ok !== false;
      return Boolean(r);
    } catch {
      return false;
    }
  }

  /**
   * `bridge.invokeWasm(fn, args)` 결과를 그대로 반환. 단순 read op
   * (getColumnDef / getCellInfo / getFootnoteAtCursor / ...). 호출이
   * throw 하면 null.
   */
  async invokeRead<T>(fn: string, args: unknown[]): Promise<T | null> {
    try {
      return await this.bridge.invokeWasm<T>(fn, args);
    } catch {
      return null;
    }
  }
}
