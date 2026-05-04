/**
 * `useExcerptAttachments` — Phase R2.2 refactor (REFACTORING_PLAN.md).
 *
 * ChatPanel.tsx 의 chunk 20 (excerpt 첨부) + chunk 22 (drag/drop) 처리
 * 를 hook 으로 분해. 발췌 chip 추가 / 제거 / 캡처 / drop / dragover
 * 모두 보존.
 *
 * 외부 의존: activeDocPath (active doc 의 path getter), captureExcerpt
 * (현재 viewer selection 캡처). 결과 chip 은 `setExcerpts` setter 로
 * 부모에 노출 — 부모는 `excerpts` state 를 그대로 보유 (send / verify
 * 단계에서 직접 읽음).
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  EXCERPT_HARD_CHAR_LIMIT,
  hashText,
  type ExcerptAttachment,
} from '@shared/ai-excerpt';

interface ExcerptCapture {
  sectionIndex: number;
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
  text: string;
  docPath?: string | null;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseExcerptAttachmentsOptions {
  activeDocPath?: () => string | null;
  captureExcerpt?: () => {
    sectionIndex: number;
    startParagraphIndex: number;
    startOffset: number;
    endParagraphIndex: number;
    endOffset: number;
    text: string;
  } | null;
  setExcerpts: Dispatch<SetStateAction<ExcerptAttachment[]>>;
  setExcerptError: Dispatch<SetStateAction<string | null>>;
}

export interface ExcerptAttachmentsHandle {
  addExcerptFromPayload: (cap: ExcerptCapture) => void;
  onCaptureExcerpt: () => void;
  onDropExcerpt: (e: React.DragEvent<HTMLFormElement>) => void;
  onDragOverExcerpt: (e: React.DragEvent<HTMLFormElement>) => void;
  removeExcerpt: (id: string) => void;
}

export function useExcerptAttachments(
  opts: UseExcerptAttachmentsOptions,
): ExcerptAttachmentsHandle {
  const { activeDocPath, captureExcerpt, setExcerpts, setExcerptError } = opts;

  // Push a captured excerpt onto the chip list. Shared between the
  // `📌 발췌 첨부` button click and the HTML5 drag-and-drop path
  // (chunk 22). The payload differs only in the source: the button
  // reads via captureExcerpt(); drop reads via dataTransfer's
  // `application/x-ahwp-excerpt` MIME.
  const addExcerptFromPayload = useCallback(
    (cap: ExcerptCapture): void => {
      if (cap.text.length > EXCERPT_HARD_CHAR_LIMIT) {
        setExcerptError(
          `발췌가 너무 깁니다 (${cap.text.length} / ${EXCERPT_HARD_CHAR_LIMIT}자 상한).`,
        );
        return;
      }
      setExcerptError(null);
      const path =
        cap.docPath !== undefined ? cap.docPath : (activeDocPath?.() ?? null);
      const label = path ? (path.split(/[/\\]/).pop() ?? path) : '(이름 없음)';
      const chip: ExcerptAttachment = {
        id: newId(),
        docPath: path,
        docLabel: label,
        role: 'target',
        anchor: {
          sectionIndex: cap.sectionIndex,
          startParagraphIndex: cap.startParagraphIndex,
          startOffset: cap.startOffset,
          endParagraphIndex: cap.endParagraphIndex,
          endOffset: cap.endOffset,
        },
        text: cap.text,
        hash: hashText(cap.text),
        status: 'fresh',
      };
      setExcerpts((prev) => [...prev, chip]);
    },
    [activeDocPath, setExcerptError, setExcerpts],
  );

  const onCaptureExcerpt = useCallback((): void => {
    if (!captureExcerpt) return;
    const cap = captureExcerpt();
    if (!cap) {
      setExcerptError(
        '선택된 텍스트가 없습니다. 먼저 문서에서 텍스트를 선택해 주세요.',
      );
      return;
    }
    addExcerptFromPayload(cap);
  }, [addExcerptFromPayload, captureExcerpt, setExcerptError]);

  // Drop handler for the input form — chunk 22. Accepts the custom
  // `application/x-ahwp-excerpt` MIME emitted by `studio-selection-rect`
  // dragstart. Falls back to creating a chip from `text/plain` if the
  // structured payload is missing — that case has no anchor and so is
  // marked stale-relocated immediately on send (verifyExcerpt will
  // either find the text or reject).
  const onDropExcerpt = useCallback(
    (e: React.DragEvent<HTMLFormElement>): void => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes('application/x-ahwp-excerpt')) return;
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/x-ahwp-excerpt');
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as ExcerptCapture;
        addExcerptFromPayload(parsed);
      } catch {
        setExcerptError('발췌 페이로드를 읽지 못했습니다.');
      }
    },
    [addExcerptFromPayload, setExcerptError],
  );

  // preventDefault on dragover lets the drop fire. Without it the
  // browser rejects the drop ahead of our handler.
  const onDragOverExcerpt = useCallback(
    (e: React.DragEvent<HTMLFormElement>): void => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes('application/x-ahwp-excerpt')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [],
  );

  const removeExcerpt = useCallback(
    (id: string): void => {
      setExcerpts((prev) => prev.filter((e) => e.id !== id));
    },
    [setExcerpts],
  );

  return {
    addExcerptFromPayload,
    onCaptureExcerpt,
    onDropExcerpt,
    onDragOverExcerpt,
    removeExcerpt,
  };
}
