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
   * 머리/꼬리말 텍스트 설정. composite: createHeaderFooter (없으면 생성)
   * + setHeaderFooterText. rhwp-studio 의 HwpDocument 가 setHeaderFooterText
   * 메서드를 직접 제공하므로 passthrough.
   */
  async setHeaderFooterText(
    sec: number,
    isHeader: boolean,
    applyTo: number,
    text: string,
  ): Promise<boolean> {
    return await this.invokeOk('setHeaderFooterText', [
      sec,
      isHeader,
      applyTo,
      text,
    ]);
  }

  /**
   * Footnote 삽입 (caret 위치, 본문 텍스트 포함).
   */
  async insertFootnoteAtCaret(text: string): Promise<boolean> {
    const caret = await this.getCaretPosition();
    if (!caret) return false;
    // wasm.doc.insertFootnote(sec, para, charOffset, text) — string 응답.
    return await this.invokeOk('insertFootnote', [
      caret.sectionIndex,
      caret.paragraphIndex,
      caret.charOffset,
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

  /** Style list 조회 — `getStyleListJson` 은 wasm-bridge wrapper 가 parsed. */
  async getStyleList(): Promise<unknown[]> {
    const r = await this.invokeRead<unknown[]>('getStyleListJson', []);
    return r ?? [];
  }

  /**
   * 문서 전체 outline (heading 단락) 추출 — composite.
   * 각 section / paragraph 의 paraProps 에서 styleId 가 "제목 N" 류면
   * 포함. ahwp 가 자체적으로 합치는 composite 라 helper 가 책임.
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
    // styleId → heading level (1..9) 매핑. style 이름이 "제목 N" / "Heading N"
    // 패턴이면 level=N.
    const headingLevel = new Map<number, number>();
    for (const s of styleList) {
      if (!s || typeof s !== 'object') continue;
      const obj = s as { id?: number; name?: string; englishName?: string };
      const id = obj.id;
      const nm = String(obj.name ?? obj.englishName ?? '');
      const m = nm.match(/(?:제목|개요|Heading)\s*(\d)/i);
      if (typeof id === 'number' && m) {
        headingLevel.set(id, Number(m[1]));
      }
    }
    for (let s = 0; s < sectionCount; s++) {
      const paraCount = await this.getParagraphCount(s);
      for (let p = 0; p < paraCount; p++) {
        const props = await this.getParaPropertiesAt(s, p);
        const styleId =
          typeof props?.styleId === 'number' ? (props.styleId as number) : -1;
        const lvl = headingLevel.get(styleId);
        if (!lvl) continue;
        const lenN = await this.getParagraphLength(s, p);
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
   */
  async getDocumentSummary(maxParas = 20, maxBytes = 2048): Promise<string> {
    const sectionCount = await this.getSectionCount();
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
    const out = parts.join('\n');
    const enc = new TextEncoder().encode(out);
    if (enc.length > maxBytes) {
      return new TextDecoder().decode(enc.slice(0, maxBytes)) + '…[trimmed]';
    }
    return out;
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
    // Try rhwp-core 의 pasteHtml. selection 없으면 caret 위치.
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
      if (typeof r === 'object' && 'ok' in (r as object))
        return (r as { ok?: boolean }).ok !== false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 양식의 빈 필드 (placeholder 가 들어있는 cell) 스캔. rhwp-studio
   * 가 자체 form-field detection 을 제공하지 않으므로 ahwp composite
   * 로 셀 텍스트를 훑어 빈 셀 / placeholder 셀을 찾는다.
   */
  async getEmptyFormFields(): Promise<{
    cellFields: {
      sectionIndex: number;
      parentParaIdx: number;
      controlIdx: number;
      cellIdx: number;
      cellParaIdx: number;
      currentText: string;
    }[];
    truncated: boolean;
  }> {
    // 본 sweep 은 데이터 비용이 큼 (셀 N x 평균 길이) — 단순 구현으로
    // 첫 section 의 모든 paragraph 의 control 0 cell 들만 훑는다.
    // 추후 더 정교한 구현 필요 시 rhwp-studio 측 helper 로 옮길 것.
    const cellFields: {
      sectionIndex: number;
      parentParaIdx: number;
      controlIdx: number;
      cellIdx: number;
      cellParaIdx: number;
      currentText: string;
    }[] = [];
    const sectionCount = await this.getSectionCount();
    let truncated = false;
    outer: for (let s = 0; s < sectionCount && !truncated; s++) {
      const paraCount = await this.getParagraphCount(s);
      for (let p = 0; p < paraCount; p++) {
        if (cellFields.length >= 100) {
          truncated = true;
          break outer;
        }
        // getCellInfo (controlIdx=0) — table 이 없으면 throw, 무시.
        try {
          const info = await this.invokeRead<{
            rowCount?: number;
            colCount?: number;
          }>('getCellInfo', [s, p, 0, 0]);
          if (!info) continue;
          const cellTotal = (info.rowCount ?? 0) * (info.colCount ?? 0);
          for (let c = 0; c < cellTotal; c++) {
            const txt = await this.getTextInCell(s, p, 0, c, 0, 0, 1024);
            const isEmpty =
              txt === '' ||
              /^[\s_]*$/.test(txt) ||
              /placeholder|<.*>/i.test(txt);
            if (isEmpty) {
              cellFields.push({
                sectionIndex: s,
                parentParaIdx: p,
                controlIdx: 0,
                cellIdx: c,
                cellParaIdx: 0,
                currentText: txt,
              });
            }
            if (cellFields.length >= 100) {
              truncated = true;
              break outer;
            }
          }
        } catch {
          /* not a table para — skip */
        }
      }
    }
    return { cellFields, truncated };
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
