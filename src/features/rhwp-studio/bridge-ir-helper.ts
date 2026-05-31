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
import {
  inferExpectedFormat,
  normalizeLabelText,
  CHECKBOX_GLYPH_RE,
  type ExpectedFormat,
} from '@shared/form-format';

/** wasm-bridge 의 write op 들이 돌려주는 status JSON 의 공통 모양. */
interface IrOpResult {
  ok?: boolean;
}

function isOk(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as IrOpResult;
      return parsed.ok !== false;
    } catch {
      // 비-JSON 응답 (예: 빈 문자열) 은 성공으로 간주.
      return true;
    }
  }
  if (typeof raw === 'object' && 'ok' in (raw as object)) {
    return (raw as IrOpResult).ok !== false;
  }
  return Boolean(raw);
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

  /**
   * 셀 paragraph 의 기존 텍스트를 모두 지우고 새 텍스트로 교체.
   * 빈 셀이면 delete 단계 skip 후 insert 만. 비어있지 않으면 현재
   * 길이만큼 delete 후 insert — 두 호출 모두 같은 turn 안에서 일어나
   * 그룹 undo (한 번의 ⌘Z 로 복구) 가 정상 작동.
   *
   * placeholder/예시문 제거 + 새 값 채우기 / 기존 값 수정 양쪽 모두
   * 한 도구 호출로 처리. text === '' 이면 effectively clear 와 동치.
   */
  async replaceTextInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    text: string,
  ): Promise<boolean> {
    const current = await this.getTextInCell(
      sec,
      parentPara,
      controlIdx,
      cellIdx,
      cellParaIdx,
      0,
      65536,
    );
    if (current.length > 0) {
      const delRaw = await this.bridge.invokeWasm<string>('deleteTextInCell', [
        sec,
        parentPara,
        controlIdx,
        cellIdx,
        cellParaIdx,
        0,
        current.length,
      ]);
      if (!isOk(delRaw)) return false;
    }
    if (text.length === 0) return true;
    const insRaw = await this.bridge.invokeWasm<string>('insertTextInCell', [
      sec,
      parentPara,
      controlIdx,
      cellIdx,
      cellParaIdx,
      0,
      text,
    ]);
    return isOk(insRaw);
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

  /**
   * 한 페이지를 SVG 문자열로 렌더 (0.6.17 — Phase B 시각 검증 MVP).
   *
   * rhwp WasmBridge 의 `renderPageSvg(pageNum)` 직접 호출. Layout
   * 이 이미 계산된 페이지에 대해 SVG 문자열을 반환 — text / 표 / 도형
   * 모두 포함. 결과 크기는 페이지에 따라 수십~수백 KB.
   *
   * 용도:
   * - form-fill 완료 후 사용자가 시각적으로 위치 / 매칭 확인 (chat
   *   UI 가 향후 inline render 지원 시).
   * - 향후 (Phase B-full) vision provider 가 SVG → PNG 변환 후 직접
   *   "본다" — 현재는 인프라만 깔아두고 chat UI / vision integration
   *   은 별도 chunk.
   *
   * 첫 호출 시 페이지 layout 이 아직 계산 안 된 페이지는 렌더 안 될
   * 수 있음 (rhwp 의 lazy layout). 그 경우 빈 문자열 / 부분 SVG 반환.
   */
  async getPageSvg(pageNum: number): Promise<string> {
    const raw = await this.bridge.invokeWasm<string>('renderPageSvg', [
      pageNum,
    ]);
    return typeof raw === 'string' ? raw : '';
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

  // ── Phase 7 E2-finalize — composite restorations ────────────────
  //
  // 아래 메서드들은 ahwp 가 자체 StudioViewer 시절 composite 로 제공한
  // 동작을 BridgeIrHelper 위에 재구현. 일관성 원칙:
  //
  // 1) ahwp tools.ts 는 helper 메서드만 호출, **JSON.stringify 절대 X**.
  // 2) helper 가 single serialization point — WASM 메서드가 string 받으면
  //    helper 가 한 번만 stringify, object 받는 메서드면 그대로 passthrough.
  // 3) wasm-bridge 의 일부 setter (setShapeProperties / setTableProperties /
  //    setCellProperties / setPictureProperties / setPageDef / setSectionDef)
  //    는 내부적으로 JSON.stringify 수행 — ahwp 가 추가로 안 한다.
  //    반면 applyCharFormat / applyParaFormat 은 string 받으므로 helper 가
  //    한 번 stringify.

  /**
   * Para shape 적용 — alignment / 들여쓰기 / 줄간격 / 단락 spacing 등.
   * 기존 viewer.applyParaProps / applyAlignment 의 composite 동작 대체.
   *
   * 동작: caret 또는 selection 의 paragraph 에 applyParaFormat 호출. props
   * 는 partial — wasm 측이 기존 값을 보존하며 덮어쓴다.
   */
  async applyParaProps(
    sec: number,
    para: number,
    props: Record<string, unknown>,
  ): Promise<boolean> {
    const raw = await this.bridge.invokeWasm<string>('applyParaFormat', [
      sec,
      para,
      JSON.stringify(props), // wasm-bridge.applyParaFormat 은 string 받음.
    ]);
    return isOk(raw);
  }

  /**
   * Caret 위치의 paragraph 에 align 적용. tools.ts 의 applyAlignment 가
   * 사용. helper.applyParaProps 의 1-arg shortcut.
   */
  async applyAlignmentAtCaret(
    align: 'left' | 'center' | 'right' | 'justify',
  ): Promise<boolean> {
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    return await this.applyParaProps(caret.sectionIndex, caret.paragraphIndex, {
      alignment: align,
    });
  }

  /**
   * Caret 위치의 char shape 변경 — fontSize / textColor / bold·italic·
   * underline. selection 이 있으면 selection 범위, 없으면 caret 의 paragraph
   * 전체. 일관된 진입점.
   */
  async applyCharFormatAtCaret(
    props: Record<string, unknown>,
  ): Promise<boolean> {
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    const sec = caret.sectionIndex;
    const para = caret.paragraphIndex;
    const paraLen = await this.getParagraphLength(sec, para);
    return await this.applyCharFormat(sec, para, 0, paraLen, props);
  }

  /** Font size (pt) 변경 — applyCharFormatAtCaret 의 shortcut. */
  async applyFontSizePtAtCaret(pt: number): Promise<boolean> {
    // HWPUNIT: 1 pt = 100 hwpunit (rhwp/core convention).
    return await this.applyCharFormatAtCaret({ fontSize: pt * 100 });
  }

  /** Text color (hex) 변경. */
  async applyTextColorAtCaret(hex: string): Promise<boolean> {
    return await this.applyCharFormatAtCaret({ textColor: hex });
  }

  /**
   * Bold / italic / underline 토글. caret 의 paragraph 의 현재 상태를
   * 읽고 반대로 설정. composite — getCharPropertiesAt + applyCharFormat.
   */
  async toggleCharFormatAtCaret(
    key: 'bold' | 'italic' | 'underline',
  ): Promise<boolean> {
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    const current = await this.getCharPropertiesAt(
      caret.sectionIndex,
      caret.paragraphIndex,
      caret.charOffset,
    );
    const next = !current?.[key];
    return await this.applyCharFormatAtCaret({ [key]: next });
  }

  /**
   * Page def 적용. wasm-bridge.setPageDef 는 object 받음 — JSON.stringify
   * 안 함. 일관성 원칙 적용.
   */
  async setPageDef(
    sec: number,
    pageDef: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>('setPageDef', [
      sec,
      pageDef, // object 그대로
    ]);
    return r?.ok === true;
  }

  /**
   * Table props 적용. object 그대로 passthrough.
   */
  async setTableProperties(
    sec: number,
    parentPara: number,
    controlIdx: number,
    props: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>(
      'setTableProperties',
      [sec, parentPara, controlIdx, props],
    );
    return r?.ok === true;
  }

  /** Cell props 적용. object passthrough. */
  async setCellProperties(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    props: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>(
      'setCellProperties',
      [sec, parentPara, controlIdx, cellIdx, props],
    );
    return r?.ok === true;
  }

  /** Picture props 적용. object passthrough. */
  async setPictureProperties(
    sec: number,
    para: number,
    controlIdx: number,
    props: Record<string, unknown>,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>(
      'setPictureProperties',
      [sec, para, controlIdx, props],
    );
    return r?.ok === true;
  }

  /** Picture control 삭제. */
  async deletePictureControl(
    sec: number,
    para: number,
    controlIdx: number,
  ): Promise<boolean> {
    return await this.invokeOk('deletePictureControl', [sec, para, controlIdx]);
  }

  /**
   * Bookmark 추가 (caret 위치). 기존 viewer.addBookmarkAtCaret 의 1:1.
   */
  async addBookmarkAtCaret(name: string): Promise<boolean> {
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    return await this.invokeOk('addBookmark', [
      caret.sectionIndex,
      caret.paragraphIndex,
      caret.charOffset,
      name,
    ]);
  }

  /** Bookmark 삭제. */
  async deleteBookmarkAt(
    sec: number,
    para: number,
    controlIdx: number,
  ): Promise<boolean> {
    return await this.invokeOk('deleteBookmark', [sec, para, controlIdx]);
  }

  /**
   * 머리/꼬리말 텍스트 설정. WASM 은 단일 set 메서드를 제공하지 않으므로
   * composite: getHeaderFooter (없으면 createHeaderFooter) → 기존 paragraph
   * 별 텍스트 clear → insertTextInHeaderFooter 로 신규 text 삽입.
   *
   * 단일 paragraph 머리/꼬리말 가정 (대부분 양식). 다중 paragraph 는 첫
   * paragraph 만 사용.
   */
  async setHeaderFooterText(
    sec: number,
    isHeader: boolean,
    applyTo: number,
    text: string,
  ): Promise<boolean> {
    const parseJson = <T>(raw: unknown): T | null => {
      if (raw == null) return null;
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      }
      return raw as T;
    };
    type HfInfo = {
      ok?: boolean;
      exists?: boolean;
      paraCount?: number;
    };
    type HfParaInfo = { ok?: boolean; charCount?: number };

    let info = parseJson<HfInfo>(
      await this.invokeRead<unknown>('getHeaderFooter', [
        sec,
        isHeader,
        applyTo,
      ]),
    );
    if (!info || info.ok === false) return false;
    if (!info.exists) {
      const created = parseJson<{ ok?: boolean }>(
        await this.invokeRead<unknown>('createHeaderFooter', [
          sec,
          isHeader,
          applyTo,
        ]),
      );
      if (!created || created.ok === false) return false;
      info = parseJson<HfInfo>(
        await this.invokeRead<unknown>('getHeaderFooter', [
          sec,
          isHeader,
          applyTo,
        ]),
      );
      if (!info || info.ok === false) return false;
    }
    const paraCount = info.paraCount ?? 1;
    // Clear each existing paragraph's text from the start.
    for (let hfPara = 0; hfPara < paraCount; hfPara++) {
      const pInfo = parseJson<HfParaInfo>(
        await this.invokeRead<unknown>('getHeaderFooterParaInfo', [
          sec,
          isHeader,
          applyTo,
          hfPara,
        ]),
      );
      const charCount = pInfo?.charCount ?? 0;
      if (charCount > 0) {
        const cleared = parseJson<{ ok?: boolean }>(
          await this.invokeRead<unknown>('deleteTextInHeaderFooter', [
            sec,
            isHeader,
            applyTo,
            hfPara,
            0,
            charCount,
          ]),
        );
        if (cleared && cleared.ok === false) return false;
      }
    }
    if (text.length === 0) return true;
    const inserted = parseJson<{ ok?: boolean }>(
      await this.invokeRead<unknown>('insertTextInHeaderFooter', [
        sec,
        isHeader,
        applyTo,
        0,
        0,
        text,
      ]),
    );
    return Boolean(inserted && inserted.ok !== false);
  }

  /**
   * Footnote 삽입 (caret 위치, 본문 텍스트 포함). composite:
   * insertFootnote (3-args, 빈 각주 만들고 anchor 정보 반환) +
   * insertTextInFootnote (반환된 paraIdx/controlIdx 로 본문 채움).
   */
  async insertFootnoteAtCaret(text: string): Promise<boolean> {
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    let raw: unknown;
    try {
      raw = await this.bridge.invokeWasm<unknown>('insertFootnote', [
        caret.sectionIndex,
        caret.paragraphIndex,
        caret.charOffset,
      ]);
    } catch {
      return false;
    }
    type InsertFootnoteResult = {
      ok?: boolean;
      paraIdx?: number;
      controlIdx?: number;
    };
    let result: InsertFootnoteResult | null = null;
    if (typeof raw === 'string') {
      try {
        result = JSON.parse(raw) as InsertFootnoteResult;
      } catch {
        return false;
      }
    } else if (raw && typeof raw === 'object') {
      result = raw as InsertFootnoteResult;
    }
    if (!result || result.ok === false) return false;
    if (text.length === 0) return true;
    const { paraIdx, controlIdx } = result;
    if (typeof paraIdx !== 'number' || typeof controlIdx !== 'number') {
      return false;
    }
    return await this.invokeOk('insertTextInFootnote', [
      caret.sectionIndex,
      paraIdx,
      controlIdx,
      0,
      0,
      text,
    ]);
  }

  /**
   * 명명 style 생성. rhwp-studio 의 createStyle 은 JSON string 받는다.
   */
  async createNamedStyle(name: string, englishName: string): Promise<number> {
    const id = await this.bridge.invokeWasm<number>('createStyle', [
      JSON.stringify({ name, englishName, type: 0 }),
    ]);
    return id ?? 0;
  }

  /**
   * 직사각형 도형 생성 (caret). composite: createShapeControl.
   */
  async createRectShapeAtCaret(
    widthHwpunit: number,
    heightHwpunit: number,
    opts: Record<string, unknown> = {},
  ): Promise<{
    ok: boolean;
    paraIdx?: number;
    controlIdx?: number;
  }> {
    const caret = await this.getCaretPosition();
    if (!caret) return { ok: false };
    const params = {
      type: 'rect',
      sec: caret.sectionIndex,
      para: caret.paragraphIndex,
      charOffset: caret.charOffset,
      widthHwpunit,
      heightHwpunit,
      ...opts,
    };
    const r = await this.bridge.invokeWasm<{
      ok?: boolean;
      paraIdx?: number;
      controlIdx?: number;
    }>('createShapeControl', [params]);
    return {
      ok: r?.ok === true,
      paraIdx: r?.paraIdx,
      controlIdx: r?.controlIdx,
    };
  }

  /** 셀에 style 적용. */
  async applyCellStyle(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    styleId: number,
  ): Promise<boolean> {
    const r = await this.bridge.invokeWasm<{ ok?: boolean }>('applyCellStyle', [
      sec,
      parentPara,
      controlIdx,
      cellIdx,
      cellParaIdx,
      styleId,
    ]);
    return r?.ok === true;
  }

  /** 표 공식 평가. */
  async evaluateTableFormula(
    sec: number,
    parentPara: number,
    controlIdx: number,
    targetRow: number,
    targetCol: number,
    formula: string,
    writeResult: boolean,
  ): Promise<unknown> {
    return await this.invokeRead('evaluateTableFormula', [
      sec,
      parentPara,
      controlIdx,
      targetRow,
      targetCol,
      formula,
      writeResult,
    ]);
  }

  /**
   * Style list 조회. WASM `getStyleList()` 가 JSON string 반환
   * (parsing 은 helper 가 책임 — wasm-bridge 가 자동 parse 안 함).
   * 이전 구현은 존재하지 않는 `getStyleListJson` 이름을 호출해 모든
   * 문서에서 빈 배열을 반환하는 사일런트 버그가 있었음.
   */
  async getStyleList(): Promise<
    {
      id?: number;
      name?: string;
      englishName?: string;
      type?: number;
      paraShapeId?: number;
      charShapeId?: number;
    }[]
  > {
    type StyleEntry = {
      id?: number;
      name?: string;
      englishName?: string;
      type?: number;
      paraShapeId?: number;
      charShapeId?: number;
    };
    const raw = await this.invokeRead<unknown>('getStyleList', []);
    if (raw == null) return [];
    let arr: unknown;
    if (typeof raw === 'string') {
      try {
        arr = JSON.parse(raw);
      } catch {
        return [];
      }
    } else {
      arr = raw;
    }
    if (!Array.isArray(arr)) return [];
    return arr as StyleEntry[];
  }

  /**
   * 문서 전체 outline (heading 단락) 추출 — composite.
   *
   * 단락별로 `getStyleAt(s, p)` 로 활성 styleId 조회 → 스타일 이름이
   * "제목 N" / "개요 N" / "Heading N" 패턴이면 outline 에 포함.
   *
   * 이전 구현은 `ParaProperties.styleId` 를 읽었지만 그 필드가 없음
   * (실제는 `paraShapeId`). 결과적으로 모든 문서에서 빈 outline 을
   * 반환하는 사일런트 버그가 있었음.
   */
  async getDocumentOutline(): Promise<
    {
      sectionIndex: number;
      paragraphIndex: number;
      level: number;
      text: string;
    }[]
  > {
    const out: {
      sectionIndex: number;
      paragraphIndex: number;
      level: number;
      text: string;
    }[] = [];
    const sectionCount = await this.getSectionCount();
    const styleList = await this.getStyleList();
    const headingLevel = new Map<number, number>();
    for (const obj of styleList) {
      const id = obj.id;
      const nm = String(obj.name ?? obj.englishName ?? '');
      const m = nm.match(/(?:제목|개요|Heading)\s*(\d)/i);
      if (typeof id === 'number' && m) {
        headingLevel.set(id, Number(m[1]));
      }
    }
    if (headingLevel.size === 0) return out;

    type StyleAtRecord = { id?: number; ok?: boolean };
    const parseStyleAt = (raw: unknown): number | null => {
      if (raw == null) return null;
      let obj: StyleAtRecord | null = null;
      if (typeof raw === 'string') {
        try {
          obj = JSON.parse(raw) as StyleAtRecord;
        } catch {
          return null;
        }
      } else if (typeof raw === 'object') {
        obj = raw as StyleAtRecord;
      }
      if (!obj || obj.ok === false) return null;
      return typeof obj.id === 'number' ? obj.id : null;
    };

    for (let s = 0; s < sectionCount; s++) {
      const paraCount = await this.getParagraphCount(s);
      for (let p = 0; p < paraCount; p++) {
        const styleId = parseStyleAt(
          await this.invokeRead<unknown>('getStyleAt', [s, p]),
        );
        if (styleId == null) continue;
        const lvl = headingLevel.get(styleId);
        if (!lvl) continue;
        const lenN = await this.getParagraphLength(s, p);
        if (lenN === 0) continue;
        const text = await this.bridge.invokeWasm<string>('getTextRange', [
          s,
          p,
          0,
          lenN,
        ]);
        out.push({
          sectionIndex: s,
          paragraphIndex: p,
          level: lvl,
          text: text.trim(),
        });
      }
    }
    return out;
  }

  /**
   * 짧은 요약 — 첫 paragraph 들의 텍스트를 모은 string. ahwp 의
   * getDocumentSummary 와 동일 개념의 composite.
   *
   * 0.6.14 — form-structure prefix: 문서가 표를 포함하면 (양식/보고서
   * 의 강력한 신호) 첫 줄에 `[form: N tables, M empty cells]` 를 주입.
   * 모델이 첫 read 응답만 보고도 "이건 양식이니까 getEmptyFormFields
   * 워크플로우" 로 라우팅할 수 있게. 본문 단락만 보고 산문으로 오인하던
   * 사일런트 회귀 (form cells 무시 + body level patch dump) 방지.
   * 스캔 비용 cap: 처음 60 paragraph 까지만 multi-control probe.
   */
  async getDocumentSummary(maxParas = 20, maxBytes = 2048): Promise<string> {
    const sectionCount = await this.getSectionCount();

    // ── form-structure scan (cheap, capped) ──
    let tableCount = 0;
    let emptyCellCount = 0;
    const TABLE_SCAN_PARAS = 60;
    const MAX_CTRLS_PER_PARA = 3;
    const parseDims = (
      raw: unknown,
    ): { rowCount: number; colCount: number; cellCount: number } | null => {
      if (raw == null) return null;
      let obj: {
        ok?: boolean;
        cellCount?: number;
        rowCount?: number;
        colCount?: number;
      };
      if (typeof raw === 'string') {
        try {
          obj = JSON.parse(raw) as typeof obj;
        } catch {
          return null;
        }
      } else {
        obj = raw as typeof obj;
      }
      if (!obj || obj.ok === false) return null;
      const cellCount = obj.cellCount ?? 0;
      if (cellCount === 0) return null;
      return {
        rowCount: obj.rowCount ?? 0,
        colCount: obj.colCount ?? 0,
        cellCount,
      };
    };
    structScan: for (let s = 0; s < sectionCount; s++) {
      const paraCount = await this.getParagraphCount(s);
      const limit = Math.min(paraCount, TABLE_SCAN_PARAS);
      for (let p = 0; p < limit; p++) {
        for (let ctrl = 0; ctrl < MAX_CTRLS_PER_PARA; ctrl++) {
          const dims = parseDims(
            await this.invokeRead<unknown>('getTableDimensions', [s, p, ctrl]),
          );
          if (!dims) continue;
          tableCount++;
          for (let c = 0; c < dims.cellCount; c++) {
            let txt: string;
            try {
              txt = await this.getTextInCell(s, p, ctrl, c, 0, 0, 256);
            } catch {
              continue;
            }
            if (txt === '' || /^[\s_]*$/.test(txt)) emptyCellCount++;
            // bail early on very large forms — we only need the signal,
            // not exact counts.
            if (emptyCellCount > 5000) break structScan;
          }
        }
      }
    }

    // ── text content (existing logic) ──
    const parts: string[] = [];
    let count = 0;
    outer: for (let s = 0; s < sectionCount; s++) {
      const paraCount = await this.getParagraphCount(s);
      for (let p = 0; p < paraCount; p++) {
        if (count >= maxParas) break outer;
        const lenN = await this.getParagraphLength(s, p);
        if (lenN === 0) continue;
        const text = await this.bridge.invokeWasm<string>('getTextRange', [
          s,
          p,
          0,
          lenN,
        ]);
        const t = text.trim();
        if (t.length === 0) continue;
        parts.push(t);
        count++;
      }
    }
    let body = parts.join('\n');
    const enc = new TextEncoder().encode(body);
    if (enc.length > maxBytes) {
      body = new TextDecoder().decode(enc.slice(0, maxBytes)) + '…[trimmed]';
    }
    // Prefix with form signal so models route to getEmptyFormFields even
    // when the user's verb (e.g. "수정해줘") doesn't literally say "fill".
    if (tableCount > 0 && emptyCellCount > 0) {
      const tableLabel =
        emptyCellCount > 5000 ? '5000+' : String(emptyCellCount);
      return `[form: ${tableCount} tables, ${tableLabel} empty cells — call getEmptyFormFields before any write]\n${body}`;
    }
    return body;
  }

  /**
   * HTML 블록을 caret 위치에 삽입 (composite). ahwp 의 chunk 99
   * follow-up 의 applyHtmlAtCaret 와 동일 개념. rhwp-studio 에 직접
   * 매핑되는 wasm 메서드 없음 → 단순화: `applyHtml` 를 raw doc method
   * 로 호출 (있다면). 없으면 throw → 호출자가 catch.
   *
   * Note: rhwp-studio 가 HTML import 를 자체 UI 로 더 정교히 처리.
   * 본 메서드는 AI tool 호환용 minimum 구현.
   */
  async applyHtmlAtCaret(html: string): Promise<boolean> {
    // pasteHtml returns a JSON string per rhwp.d.ts. 이전 구현은
    // `typeof r === 'object'` 체크만 해서 string 응답을 무조건 성공으로
    // 판정하던 사일런트 버그가 있었음. isOk() 가 string/object 양쪽
    // 모두 `{"ok":false,...}` 를 정확히 false 로 평가.
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    try {
      const r = await this.bridge.invokeWasm<unknown>('pasteHtml', [
        caret.sectionIndex,
        caret.paragraphIndex,
        caret.charOffset,
        html,
      ]);
      if (r === null || r === undefined) return false;
      return isOk(r);
    } catch {
      return false;
    }
  }

  /**
   * 양식의 빈 필드 (빈 cell + placeholder cell) 스캔. 결과 모양은
   * `viewer-handle-types.ts` 의 `getEmptyFormFields` 컨트랙트 + system
   * prompt 의 form-fill workflow 기대치 (location / labelHint /
   * labelCharShape) 와 일치.
   *
   * 차원 조회는 `getTableDimensions` (정확한 rowCount/colCount/cellCount
   * 반환). 이전 구현이 사용하던 `getCellInfo` 는 셀-상대 위치
   * `{row,col,rowSpan,colSpan}` 만 돌려주므로 rowCount=0 으로 평가되어
   * 모든 양식에서 0 필드를 반환하던 버그가 있었음.
   *
   * Multi-control: paragraph 가 여러 컨트롤 (예: 표 + 표) 을 앵커할
   * 수 있으므로 controlIdx 0..MAX_CTRLS_PER_PARA 까지 probe.
   *
   * labelHint: 빈 셀의 왼쪽 (같은 행) 또는 위 (같은 열) 인접 셀의
   * 텍스트. 우선순위는 좌측, 비어있으면 상단. system prompt 가 이 hint
   * 를 보고 각 필드가 무엇을 받는지 추론한다.
   *
   * 병합 셀 처리: flat cellIdx 산술 (c-1, c-colCount) 은 병합된 표
   * (예: 13×7=91, totalCells=61) 에서 잘못된 셀을 가리킨다. 각 셀의
   * `getCellInfo` `{row, col, rowSpan, colSpan}` 로 (row,col) 그리드
   * 맵을 1회 빌드한 뒤 진짜 좌상 이웃을 찾는다. 셀이 너무 많은 표
   * (`MAX_CELLS_FOR_GRID_MAP` 초과) 는 비용 회피를 위해 grid 맵을
   * 건너뛰고 labelHint 를 비워둔다 — AI 는 labelHint 없으면 currentText
   * 와 주변 paragraph 텍스트로 판단하면 된다.
   *
   * labelCharShape: hint 의 char shape — `additionFormat.lib` 로 그대로
   * 넘기면 채워넣은 값의 타이포그래피가 라벨과 일치.
   *
   * `includeFilled`: 기본 false (empty 셀만 반환). true 면 채워진 셀까지
   * 포함 — 각 셀에 `isEmpty` boolean + 채워진 셀의 `contentCharShape`
   * (이탤릭/색상 등 placeholder 판정용) 를 반환. AI 가 "이탤릭+비검정"
   * 같은 시각 단서로 템플릿 예시문 (e.g. "예) 성형공정 ...") 을 식별하고
   * 교체할 수 있다.
   *
   * 0.7.2 — `slotKind` 분류. AI 가 도구 선택 (insertTextInCell vs
   * replaceTextInCell) 을 cell-by-cell 로 정확히 하도록 4 가지로 분류:
   *
   * - `'value-slot'` — `isEmpty === true`. 빈 셀, `insertTextInCell` 로
   *   값을 채움. 0.7.1 의 default.
   * - `'instruction'` — `isEmpty === false` 이고 `contentCharShape.italic`
   *   가 true 이며 `textColor` 가 비-검정. 템플릿 예시문 / placeholder
   *   (e.g. "예) 회사명을 입력하세요", "1.3 주요 공정별 ..."). AI 는
   *   `replaceTextInCell` 로 본 값으로 교체해야 함. 이전 회귀 (cell #4
   *   placeholder 남고 cell #5 에만 새 값 들어가서 layout 깨짐) 의 직접
   *   원인.
   * - `'sub-header'` — `isEmpty === false` 이고 `contentCharShape.bold`
   *   가 true 이고 텍스트 길이가 짧음. 셀 안의 보조 헤더 (e.g. "1)" /
   *   "구분" 같은 인-셀 라벨). 손대지 말 것. 0.7.2 에서는 conservative
   *   하게 정의 — bold + length<=30 + (라벨-스러운 종결 패턴 없음).
   * - `'content'` — 그 외 (이미 채워진 정상 데이터). 사용자가 명시 요청
   *   안 하면 손대지 말 것.
   *
   * 색상 비교 — `#000000` / `#000` / 대문자 / 공백 모두 정규화. 비-검정
   * 이라도 italic 가 false 면 instruction 아님 (검정 + bold 등 다른 스타일
   * 조합과 충돌 방지).
   */
  async getEmptyFormFields(opts?: {
    sectionIdx?: number;
    parentParaIdx?: number;
    maxResults?: number;
    includeFilled?: boolean;
  }): Promise<{
    cellFields: {
      location: {
        sectionIndex: number;
        paragraphIndex: number;
        controlIndex: number;
        cellIndex: number;
        cellParagraphIndex: number;
      };
      labelHint: string;
      labelCharShape?: Record<string, unknown>;
      currentText: string;
      isEmpty: boolean;
      contentCharShape?: Record<string, unknown>;
      slotKind: 'value-slot' | 'instruction' | 'sub-header' | 'content';
      /** 0.7.12 — 행 첫 칸 텍스트 ((row, 0) 의 셀). 큰 표 / 미해석 시 ''. */
      rowLabel: string;
      /** 0.7.12 — 컬럼 헤더 텍스트 ((0, col) 의 셀). 큰 표 / 미해석 시 ''. */
      columnHeader: string;
      /** 0.7.12 — columnHeader+rowLabel 휴리스틱으로 추론한 expectedFormat.
       *  marker / number / currency / date / text. write 도구가 이 값을
       *  args 에 echo 하면 dispatcher 가 text 와 함께 검증. */
      expectedFormat: ExpectedFormat;
    }[];
    truncated: boolean;
    tableInventory: {
      sectionIndex: number;
      paragraphIndex: number;
      controlIndex: number;
      rowCount: number;
      colCount: number;
      totalCells: number;
      emptyCells: number;
      sampleLabel: string;
    }[];
  }> {
    const DEFAULT_MAX = 200;
    const MAX_CTRLS_PER_PARA = 4;
    const LABEL_MAX = 100;
    const TABLE_INVENTORY_MAX = 60;
    const MAX_CELLS_FOR_GRID_MAP = 300;
    const maxResults = Math.max(
      1,
      Math.min(opts?.maxResults ?? DEFAULT_MAX, 500),
    );
    const filterSection = opts?.sectionIdx;
    const filterParentPara = opts?.parentParaIdx;
    const includeFilled = opts?.includeFilled === true;

    type SlotKind = 'value-slot' | 'instruction' | 'sub-header' | 'content';
    type Field = {
      location: {
        sectionIndex: number;
        paragraphIndex: number;
        controlIndex: number;
        cellIndex: number;
        cellParagraphIndex: number;
      };
      labelHint: string;
      labelCharShape?: Record<string, unknown>;
      currentText: string;
      isEmpty: boolean;
      contentCharShape?: Record<string, unknown>;
      slotKind: SlotKind;
      rowLabel: string;
      columnHeader: string;
      expectedFormat: ExpectedFormat;
    };
    // 0.7.2 — slot 분류 휴리스틱.
    //
    // 'instruction' = 채워진 셀 + italic + 비-검정 색. HWP 양식의 표준
    // placeholder 패턴 (e.g. "예) 회사명을 입력" italic blue, "1.3 주요
    // 공정별 ... 내용을 요약하여 기술" italic dark-blue). 사용자가 본
    // 값을 채우면 이 텍스트는 사라져야 함 → replaceTextInCell.
    //
    // 'sub-header' = 채워진 셀 + bold + 짧은 텍스트 (length<=30) + 이탤릭
    // 아닌. 셀 안에 임베드된 보조 라벨. 손대지 말 것.
    //
    // 'content' = 위 둘 다 아니고 채워져 있음. 사용자가 명시 수정 안 하면
    // 보존.
    //
    // 'value-slot' = 빈 셀. 기존 0.7.1 의 기본 — insertTextInCell.
    const BLACK_RE = /^#?(?:0{3}|0{6})$/i; // #000 또는 #000000
    const classifySlot = (
      isEmpty: boolean,
      currentText: string,
      contentCharShape: Record<string, unknown> | undefined,
    ): SlotKind => {
      if (isEmpty) return 'value-slot';
      if (!contentCharShape) return 'content';
      const italic = contentCharShape.italic === true;
      const bold = contentCharShape.bold === true;
      const rawColor = contentCharShape.textColor;
      const colorStr =
        typeof rawColor === 'string'
          ? rawColor.replace(/\s/g, '').toLowerCase()
          : '';
      const isBlack =
        colorStr === '' ||
        BLACK_RE.test(colorStr) ||
        /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*[,)]/i.test(colorStr);
      if (italic && !isBlack) return 'instruction';
      // sub-header: bold + 짧고 + italic 아님. 너무 공격적이면 정상 데이터
      // 도 sub-header 로 오분류 위험 → 30자 cap.
      if (bold && !italic && currentText.length > 0 && currentText.length <= 30)
        return 'sub-header';
      return 'content';
    };
    type TableEntry = {
      sectionIndex: number;
      paragraphIndex: number;
      controlIndex: number;
      rowCount: number;
      colCount: number;
      totalCells: number;
      emptyCells: number;
      sampleLabel: string;
    };
    const cellFields: Field[] = [];
    const tableInventory: TableEntry[] = [];
    let truncated = false;

    const parseTableDims = (
      raw: string | object | null,
    ): { rowCount: number; colCount: number; cellCount: number } | null => {
      if (!raw) return null;
      let obj: {
        ok?: boolean;
        rowCount?: number;
        colCount?: number;
        cellCount?: number;
      };
      if (typeof raw === 'string') {
        try {
          obj = JSON.parse(raw) as typeof obj;
        } catch {
          return null;
        }
      } else {
        obj = raw as typeof obj;
      }
      if (!obj || obj.ok === false) return null;
      const cellCount = obj.cellCount ?? 0;
      if (cellCount === 0) return null;
      return {
        rowCount: obj.rowCount ?? 0,
        colCount: obj.colCount ?? 0,
        cellCount,
      };
    };

    const fetchLabel = async (
      s: number,
      p: number,
      ctrl: number,
      cellIdx: number,
    ): Promise<{ text: string; cellIdx: number } | null> => {
      try {
        const t = await this.getTextInCell(s, p, ctrl, cellIdx, 0, 0, 200);
        // 0.7.16 — 꼬리 콜론 / 각주 위첨자 strip (kordoc 차용). "성명:" →
        // "성명", "등록기준지²" → "등록기준지". labelHint / rowLabel /
        // columnHeader 가 모두 이 경로를 타므로 한 곳에서 정규화.
        const trimmed = normalizeLabelText(t);
        if (!trimmed) return null;
        return { text: trimmed.slice(0, LABEL_MAX), cellIdx };
      } catch {
        return null;
      }
    };

    const isCellEmpty = (txt: string): boolean =>
      txt === '' || /^[\s_]*$/.test(txt) || /placeholder|<.*>/i.test(txt);

    const sectionCount = await this.getSectionCount();
    const sectionStart = filterSection ?? 0;
    const sectionEnd =
      filterSection !== undefined ? filterSection + 1 : sectionCount;

    // 0.6.16 — scope 의 의미를 분리:
    // - `tableInventory` 는 sectionScope 전체 (filterParentPara 무관) — AI
    //   가 cellFields:[] 받고도 inventory 보고 "scope 잘못됐다" self-correct.
    // - `cellFields` 는 filterParentPara 지정 시 그 paragraph 의 표만.
    // 이전: parentParaIdx=0 / 5 처럼 표가 없는 단락으로 좁히면 inventory
    // 까지 [] 가 되어 AI 가 "양식 빈 셀 없네" 오판 → body insertText
    // fallback (양식 표에 안 들어가고 본문에 들어감) 회귀가 있었음.

    // 0.7.15 — `filterParentPara` 가 표를 anchor 하지 않으면 (e.g. AI 가
    // heading / non-table 단락을 잘못 넘김) cellFields 가 [] 로 나와 AI 가
    // "양식 빈 셀 없네" 오판하던 버그. 잘못된 scope 면 effectiveScope 를
    // undefined 로 낮춰 cellFields 를 unscoped 로 self-heal — 한 번의 호출
    // 로 진짜 셀이 나온다. 실제 표를 anchor 하면 (빈 셀이 0개여도) scope
    // 유지 → 그 표의 cellFields (가득 찬 표면 정확히 []). anchor 판정은
    // getTableDimensions 만 도는 싼 pre-pass (per-cell read 없음).
    let effectiveScope = filterParentPara;
    if (filterParentPara !== undefined) {
      let anchorsTable = false;
      for (
        let s = sectionStart;
        s < sectionEnd && s < sectionCount && !anchorsTable;
        s++
      ) {
        for (let ctrl = 0; ctrl < MAX_CTRLS_PER_PARA && !anchorsTable; ctrl++) {
          const probe = await this.invokeRead<string | object>(
            'getTableDimensions',
            [s, filterParentPara, ctrl],
          );
          if (parseTableDims(probe)) anchorsTable = true;
        }
      }
      if (!anchorsTable) effectiveScope = undefined;
    }

    for (let s = sectionStart; s < sectionEnd && s < sectionCount; s++) {
      const paraCount = await this.getParagraphCount(s);
      for (let p = 0; p < paraCount; p++) {
        const inCellScope =
          effectiveScope === undefined || effectiveScope === p;
        for (let ctrl = 0; ctrl < MAX_CTRLS_PER_PARA; ctrl++) {
          const raw = await this.invokeRead<string | object>(
            'getTableDimensions',
            [s, p, ctrl],
          );
          const dims = parseTableDims(raw);
          if (!dims) continue;
          const { rowCount, colCount, cellCount } = dims;

          // Always start an inventory entry — AI navigates large forms by
          // picking a table from this list and re-calling with parentParaIdx.
          // 0.6.16 — inventory 는 scope 와 무관하게 항상 채움. cell 스캔만
          // scope 제한 (out-of-scope 표는 emptyCells=0 으로 남음 — 정확
          // 카운트는 unscoped 호출에서 받은 첫 응답에 있음).
          let tableEntry: TableEntry | null = null;
          if (tableInventory.length < TABLE_INVENTORY_MAX) {
            tableEntry = {
              sectionIndex: s,
              paragraphIndex: p,
              controlIndex: ctrl,
              rowCount,
              colCount,
              totalCells: cellCount,
              emptyCells: 0,
              sampleLabel: '',
            };
            tableInventory.push(tableEntry);
          }

          // 0.7.15 — emptyCells 카운트 (아래 per-cell 루프) 는 scope 와 무관
          // 하게 항상 돌려 tableInventory 를 truthful 하게 유지한다 (out-of-
          // scope 표도 진짜 빈 셀 수가 보임 → AI / form-guard 가 self-correct).
          // 비싼 라벨/charShape 일감 (grid map 빌드 + 셀별 push) 만 scope 로
          // 제한. full 셀 스캔 자체는 싸다 (headless: 64-table / 6752-cell
          // 템플릿 전체 ~13ms). inventory 는 여전히 TABLE_INVENTORY_MAX 개
          // 표까지만 (emptyCells 카운트도 tableEntry 있을 때만 누적).

          // (row,col) → cellIdx grid map. 병합된 표에서 진짜 인접 셀을
          // 찾기 위함. cellCount 가 크면 (>MAX_CELLS_FOR_GRID_MAP) 비용
          // 회피를 위해 빌드를 건너뛴다 — 결과적으로 labelHint 가 비고,
          // AI 는 currentText / 주변 paragraph 텍스트로 판단. out-of-scope
          // 표는 라벨이 필요 없으니 grid map 도 건너뛴다.
          let cellInfoByIdx: Map<
            number,
            { row: number; col: number; rowSpan: number; colSpan: number }
          > | null = null;
          let gridMap: Map<string, number> | null = null;
          if (
            inCellScope &&
            cellCount > 0 &&
            cellCount <= MAX_CELLS_FOR_GRID_MAP
          ) {
            cellInfoByIdx = new Map();
            gridMap = new Map();
            for (let c = 0; c < cellCount; c++) {
              try {
                const infoRaw = await this.bridge.invokeWasm<string | object>(
                  'getCellInfo',
                  [s, p, ctrl, c],
                );
                let info: {
                  ok?: boolean;
                  row?: number;
                  col?: number;
                  rowSpan?: number;
                  colSpan?: number;
                };
                if (typeof infoRaw === 'string') {
                  try {
                    info = JSON.parse(infoRaw);
                  } catch {
                    continue;
                  }
                } else {
                  info = infoRaw as typeof info;
                }
                if (!info || info.ok === false) continue;
                const row = info.row ?? 0;
                const col = info.col ?? 0;
                const rowSpan = Math.max(1, info.rowSpan ?? 1);
                const colSpan = Math.max(1, info.colSpan ?? 1);
                cellInfoByIdx.set(c, { row, col, rowSpan, colSpan });
                for (let r = row; r < row + rowSpan; r++) {
                  for (let cc = col; cc < col + colSpan; cc++) {
                    gridMap.set(`${r},${cc}`, c);
                  }
                }
              } catch {
                /* per-cell failure is best-effort */
              }
            }
          }

          // 셀의 char-shape (라벨용 / content 용 공통) 을 가져와 compact.
          // 빈 응답 / 파싱 실패 / 0.6.14 의 ok=false 응답 모두 undefined 반환.
          const COMPACT_KEYS = [
            'fontFamily',
            'fontSize',
            'bold',
            'italic',
            'underline',
            'strikethrough',
            'textColor',
            'charShapeId',
          ] as const;
          const fetchCellCharShape = async (
            cellIdx: number,
          ): Promise<Record<string, unknown> | undefined> => {
            try {
              const raw = await this.bridge.invokeWasm<unknown>(
                'getCellCharPropertiesAt',
                [s, p, ctrl, cellIdx, 0, 0],
              );
              let shape: Record<string, unknown> | undefined;
              if (typeof raw === 'string') {
                try {
                  shape = JSON.parse(raw) as Record<string, unknown>;
                } catch {
                  return undefined;
                }
              } else if (raw && typeof raw === 'object') {
                shape = raw as Record<string, unknown>;
              }
              if (!shape || (shape as { ok?: boolean }).ok === false)
                return undefined;
              const compact: Record<string, unknown> = {};
              for (const k of COMPACT_KEYS) {
                if (k in shape)
                  compact[k] = (shape as Record<string, unknown>)[k];
              }
              return Object.keys(compact).length > 0 ? compact : undefined;
            } catch {
              return undefined;
            }
          };

          for (let c = 0; c < cellCount; c++) {
            let txt: string;
            try {
              txt = await this.getTextInCell(s, p, ctrl, c, 0, 0, 1024);
            } catch {
              continue;
            }
            const empty = isCellEmpty(txt);

            // emptyCells 카운트는 inventory 정확도 위해 항상 누적.
            if (empty && tableEntry) tableEntry.emptyCells++;

            // 0.7.15 — out-of-scope 표는 여기서 끝 (카운트만). cellFields /
            // 라벨 / charShape 같은 비싼 enrich 는 in-scope 표만.
            if (!inCellScope) continue;

            // includeFilled 가 false 면 채워진 셀은 결과 / 라벨 처리 모두 skip.
            if (!empty && !includeFilled) continue;

            // label-hint: left sibling first, then top sibling.
            // grid 맵이 있으면 진짜 (row,col) 이웃을 찾고, 없으면
            // 큰 표라 라벨은 비워둔다.
            let label: { text: string; cellIdx: number } | null = null;
            const info = cellInfoByIdx?.get(c);
            if (info && gridMap) {
              if (info.col > 0) {
                const leftIdx = gridMap.get(`${info.row},${info.col - 1}`);
                if (leftIdx !== undefined && leftIdx !== c) {
                  label = await fetchLabel(s, p, ctrl, leftIdx);
                }
              }
              if (!label && info.row > 0) {
                const topIdx = gridMap.get(`${info.row - 1},${info.col}`);
                if (topIdx !== undefined && topIdx !== c) {
                  label = await fetchLabel(s, p, ctrl, topIdx);
                }
              }
            }

            if (empty && tableEntry && !tableEntry.sampleLabel && label) {
              tableEntry.sampleLabel = label.text;
            }

            if (cellFields.length >= maxResults) {
              if (empty) truncated = true;
              continue; // keep counting emptyCells for inventory
            }

            const labelCharShape = label
              ? await fetchCellCharShape(label.cellIdx)
              : undefined;
            // contentCharShape: 채워진 셀의 본문 char shape — placeholder
            // (이탤릭+비검정) 식별용. 빈 셀은 본문이 없으니 생략.
            const contentCharShape = !empty
              ? await fetchCellCharShape(c)
              : undefined;

            const slotKind = classifySlot(empty, txt, contentCharShape);

            // 0.7.12 — rowLabel / columnHeader 추출 + expectedFormat 추론.
            // gridMap 이 있는 경우에만 (작은 표) 가능. 큰 표는 '' / 'text'.
            // self-cell (자기 자신이 헤더 / 라벨인 경우) 은 skip.
            let rowLabel = '';
            let columnHeader = '';
            let expectedFormat: ExpectedFormat = 'text';
            if (info && gridMap) {
              const rowLabelIdx = gridMap.get(`${info.row},0`);
              if (rowLabelIdx !== undefined && rowLabelIdx !== c) {
                const fetched = await fetchLabel(s, p, ctrl, rowLabelIdx);
                if (fetched) rowLabel = fetched.text;
              }
              const colHeaderIdx = gridMap.get(`0,${info.col}`);
              if (colHeaderIdx !== undefined && colHeaderIdx !== c) {
                const fetched = await fetchLabel(s, p, ctrl, colHeaderIdx);
                if (fetched) columnHeader = fetched.text;
              }
              if (columnHeader || rowLabel) {
                expectedFormat = inferExpectedFormat(columnHeader, rowLabel);
              }
              // 0.7.16 — 헤더에 마커 신호가 없어도 셀 자체 텍스트에 체크박스
              // 글리프 (□ ☐ ☑ ...) 가 있으면 marker 로 승격 (kordoc 차용).
              // 헤더 없는 체크박스 행 ("□ 해당  □ 비해당") 대응.
              if (expectedFormat === 'text' && CHECKBOX_GLYPH_RE.test(txt)) {
                expectedFormat = 'marker';
              }
            }

            cellFields.push({
              location: {
                sectionIndex: s,
                paragraphIndex: p,
                controlIndex: ctrl,
                cellIndex: c,
                cellParagraphIndex: 0,
              },
              labelHint: label?.text ?? '',
              labelCharShape,
              currentText: txt,
              isEmpty: empty,
              contentCharShape,
              slotKind,
              rowLabel,
              columnHeader,
              expectedFormat,
            });
          }
        }
      }
    }
    return { cellFields, truncated, tableInventory };
  }

  /**
   * 이미지 (base64) 삽입. rhwp-studio 의 `insertPicture` raw doc 메서드
   * 가 base64 직접 받을 수 있으면 1-shot. 아니면 caller 가 추가 처리.
   */
  async insertPictureAtCaret(
    sec: number,
    para: number,
    charOffset: number,
    base64Data: string,
    widthHwpunit: number,
    heightHwpunit: number,
    naturalWidthPx: number,
    naturalHeightPx: number,
    extension: string,
    description: string,
  ): Promise<boolean> {
    return await this.invokeOk('insertPicture', [
      sec,
      para,
      charOffset,
      base64Data,
      widthHwpunit,
      heightHwpunit,
      naturalWidthPx,
      naturalHeightPx,
      extension,
      description,
    ]);
  }
}
