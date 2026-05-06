/**
 * `useDocumentLifecycle` — Phase R1.1 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 doc-load effect (~150 라인) 을 hook 으로 분해. path
 * 변경 시:
 *   1. 모든 ref / 상태 reset
 *   2. WASM init (`ensureRhwpCore`)
 *   3. file IPC read → `new HwpDocument(bytes)`
 *   4. page-0 SVG 렌더 + dimensions 파싱
 *   5. caret / cursor rect / style list / active format / page count seed
 *   6. baseline snapshot push (history)
 *   7. cleanup (free doc on unmount or path change)
 *
 * 모든 ref / setter 는 opts 로 명시 받음 — 글로벌 closure 캡처 0. caller
 * (StudioViewer) 가 React state 와 ref 모두 보유하고 hook 은 mutate 만 함.
 *
 * 추출 전후 동작은 완전 동일 — refactor 첫 hook 이라 외부 contract /
 * console.info 로그 / 에러 분기 모두 보존.
 */
import { useEffect, type MutableRefObject } from 'react';
import { WasmBridge, type RhwpDoc } from '@/lib/rhwp-core';
import { parsePageDimensions, type PageDims } from '../utils/page-dims';

export type LifecyclePhase = 'mounting' | 'reading' | 'rendering' | 'ready';

/** caretRef 의 shape 만 — 셀 컨텍스트는 unknown 으로 우회 (hook 은 caret
 * 위치 좌표만 사용). */
export interface LifecycleCaret {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  cell?: unknown;
}

export interface LifecycleHistory {
  entries: number[];
  index: number;
}

export interface LifecycleStyleListItem {
  id: number;
  name: string;
  englishName: string;
  type: number;
  paraShapeId: number;
  charShapeId: number;
}

export interface LifecycleCursorRect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

export type LifecycleAlignment = 'left' | 'center' | 'right' | 'justify';

export interface LifecycleActiveFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  styleId: number;
  fontSize: number;
  textColor: string;
  alignment: LifecycleAlignment;
}

interface LifecycleCharProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  textColor?: string;
}

interface LifecycleParaProps {
  alignment?: LifecycleAlignment;
}

const PARA_ALIGNMENTS: LifecycleAlignment[] = [
  'left',
  'center',
  'right',
  'justify',
];

export interface UseDocumentLifecycleOptions {
  path: string;
  // Refs (mutated by the hook). MutableRefObject (not RefObject) because we
  // re-assign `.current`. useRef with an initial value returns Mutable.
  //
  // chunk 100 (Phase 6.0): `bridgeRef` owns lifecycle (`WasmBridge.create` /
  // `.dispose`); `docRef` is kept as a mirror of `bridge.doc` so the ~136
  // existing `docRef.current?.X(...)` call sites in StudioViewer + 7 hooks
  // continue working unchanged. Future chunks may migrate categories of
  // method calls to the bridge as they gain bridge-specific logic.
  bridgeRef: MutableRefObject<WasmBridge | null>;
  docRef: MutableRefObject<RhwpDoc | null>;
  caretRef: MutableRefObject<LifecycleCaret>;
  cacheRef: MutableRefObject<Map<number, string>>;
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  dirtyRef: MutableRefObject<boolean>;
  historyRef: MutableRefObject<LifecycleHistory>;
  findTextCacheRef: MutableRefObject<Map<string, string> | null>;
  // Setters (React state)
  setDirty: (v: boolean) => void;
  setCanUndo: (v: boolean) => void;
  setCanRedo: (v: boolean) => void;
  setError: (v: string | null) => void;
  setPhase: (v: LifecyclePhase) => void;
  setCursorRect: (v: LifecycleCursorRect | null) => void;
  setStyleList: (v: LifecycleStyleListItem[]) => void;
  setActiveFormat: (v: LifecycleActiveFormat) => void;
  setPageCount: (v: number) => void;
  setPageDims: (v: PageDims | null) => void;
}

export function useDocumentLifecycle(opts: UseDocumentLifecycleOptions): void {
  const {
    path,
    bridgeRef,
    docRef,
    caretRef,
    cacheRef,
    pageRefsRef,
    dirtyRef,
    historyRef,
    findTextCacheRef,
    setDirty,
    setCanUndo,
    setCanRedo,
    setError,
    setPhase,
    setCursorRect,
    setStyleList,
    setActiveFormat,
    setPageCount,
    setPageDims,
  } = opts;

  useEffect(() => {
    let cancelled = false;
    let localBridge: WasmBridge | null = null;

    // Capture the Map *value* (not the ref wrapper) for the async closure
    // and cleanup — `cache.clear()` / `cache.set()` mutate the Map's
    // contents, which is fine; we never reassign `cacheRef.current`.
    const cache = cacheRef.current;

    // Reset everything for a fresh path. Ref `.current` reassignments go
    // through the *Ref-suffixed names directly so react-hooks/immutability
    // recognizes them as ref slots; aliasing to a non-Ref name would trip
    // "Modifying component props or hook arguments is not allowed".
    cache.clear();
    pageRefsRef.current = [];
    dirtyRef.current = false;
    historyRef.current = { entries: [], index: -1 };
    findTextCacheRef.current = null;

    void (async () => {
      try {
        setDirty(false);
        setCanUndo(false);
        setCanRedo(false);
        setError(null);
        setPhase('mounting');
        // chunk 100: WasmBridge.create() awaits ensureRhwpCore internally.
        if (cancelled) return;

        setPhase('reading');
        const tRead = performance.now();
        const buffer = await window.api.file.read(path);
        if (cancelled) return;
        console.info(
          `[studio] read ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB in ${(performance.now() - tRead).toFixed(0)} ms`,
        );

        setPhase('rendering');
        const tParse = performance.now();
        // chunk 100 (Phase 6.0): construct via `WasmBridge.create` which
        // owns lifecycle (`ensureRhwpCore` + `new HwpDocument(bytes)`).
        // The local `doc` alias keeps the original render/parse codepath
        // unchanged, and `docRef.current = bridge.doc` mirrors the inner
        // HwpDocument so existing hook call sites continue working.
        localBridge = await WasmBridge.create(new Uint8Array(buffer));
        const localDoc = localBridge.doc;
        const total = localDoc.pageCount();
        const svg0 = localDoc.renderPageSvg(0);
        const dims = parsePageDimensions(svg0);
        if (!dims) throw new Error('Could not parse page-0 dimensions');
        console.info(
          `[studio] parse ${total} pages, page-0 ${dims.w}×${dims.h} in ${(performance.now() - tParse).toFixed(0)} ms`,
        );

        if (cancelled) {
          localBridge.dispose();
          return;
        }

        bridgeRef.current = localBridge;
        docRef.current = localDoc;
        cache.set(0, svg0);

        // Sync initial caret state from the doc.
        try {
          caretRef.current = JSON.parse(
            localDoc.getCaretPosition(),
          ) as LifecycleCaret;
        } catch {
          /* keep default 0,0,0 */
        }

        // Compute initial cursor rect for the visual cursor.
        try {
          const c = caretRef.current;
          setCursorRect(
            JSON.parse(
              localDoc.getCursorRect(
                c.sectionIndex,
                c.paragraphIndex,
                c.charOffset,
              ),
            ) as LifecycleCursorRect,
          );
        } catch {
          /* keep null */
        }

        // Load style list (paragraph styles) for toolbar dropdown.
        try {
          const list = JSON.parse(
            localDoc.getStyleList(),
          ) as LifecycleStyleListItem[];
          // Only show 본문 styles (type=0) — type=1 is system styles
          // like 쪽 번호 which aren't user-applicable to body paragraphs.
          setStyleList(list.filter((s) => s.type === 0));
        } catch {
          setStyleList([]);
        }

        // Initial active format from caret's paragraph CharShape.
        try {
          const c = caretRef.current;
          const cp = JSON.parse(
            localDoc.getCharPropertiesAt(
              c.sectionIndex,
              c.paragraphIndex,
              c.charOffset,
            ),
          ) as LifecycleCharProps;
          const at = JSON.parse(
            localDoc.getStyleAt(c.sectionIndex, c.paragraphIndex),
          ) as { id: number };
          let alignment: LifecycleAlignment = 'left';
          try {
            const pp = JSON.parse(
              localDoc.getParaPropertiesAt(c.sectionIndex, c.paragraphIndex),
            ) as LifecycleParaProps;
            if (pp.alignment && PARA_ALIGNMENTS.includes(pp.alignment)) {
              alignment = pp.alignment;
            }
          } catch {
            /* keep default */
          }
          setActiveFormat({
            bold: !!cp.bold,
            italic: !!cp.italic,
            underline: !!cp.underline,
            styleId: at.id,
            fontSize: typeof cp.fontSize === 'number' ? cp.fontSize : 1000,
            textColor:
              typeof cp.textColor === 'string' ? cp.textColor : '#000000',
            alignment,
          });
        } catch {
          /* keep defaults */
        }

        setPageCount(total);
        setPageDims(dims);
        setPhase('ready');

        // Reset history and push baseline snapshot. Inline rather than
        // calling pushHistory() because that closure references docRef,
        // which has just been swapped — the safe ordering is to seed
        // historyRef directly here.
        try {
          const baseId = localDoc.saveSnapshot();
          historyRef.current = {
            entries: [baseId],
            index: 0,
          };
          setCanUndo(false);
          setCanRedo(false);
        } catch (err) {
          console.warn('[studio] baseline snapshot failed:', err);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
        localBridge?.dispose();
      }
    })();

    return () => {
      cancelled = true;
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
      docRef.current = null;
      cache.clear();
      pageRefsRef.current = [];
    };
    // path is the only true dependency — refs and setters are stable per
    // the caller's lifecycle (useState/useRef). exhaustive-deps would
    // demand them, but they don't cause re-runs and listing them is a
    // false signal. Match StudioViewer 의 prior eslint comment 패턴.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}
