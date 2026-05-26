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
}
