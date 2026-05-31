/**
 * File-format predicates shared between main + renderer — 0.6.0.
 *
 * **편집 가능 (editable)** 한 파일은 ahwp 가 탭으로 mount 한다 (rhwp-studio
 * 가 IR 변형 지원). 이외의 readable 포맷 (PDF / DOCX / Excel / CSV / TXT /
 * MD / JSON / XML / HTML) 은 폴더 트리에 노출되지만 클릭 시 OS 기본 앱으로
 * 위임 (`file:open-external`).
 *
 * Main process 의 `electron/files/readable-formats.ts` 는 같은 allowlist
 * + 텍스트 추출기 (pdf-parse / mammoth / exceljs) 를 보유. 그쪽이 fs / native
 * deps 를 사용하므로 renderer 에서 import 불가 → 본 shared 모듈은 plain
 * string lookup 만 노출 (sandbox 호환).
 */

/** rhwp-studio 가 editor 로 mount 할 수 있는 native 포맷. */
export const EDITABLE_EXTENSIONS = ['.hwp', '.hwpx'] as const;

/** AI / 폴더 트리 / Search 패널이 enumerate 하는 모든 포맷. */
export const READABLE_EXTENSIONS = [
  '.hwp',
  '.hwpx',
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.xlsx',
  // .xls (legacy BIFF8) 는 의도적으로 제외 — 추출기 (exceljs) 가 OOXML
  // 전용이라 .xls 는 런타임에 throw 한다. "검증 못 하는 포맷은 선언하지
  // 않는다" 원칙 (electron/files/readable-formats-binary.test.ts 가 선언
  // 포맷마다 binary round-trip 검증). .xls 실지원은 kordoc parseXls 도입
  // (검증 포함) 시 복원 예정.
] as const;

export function isEditable(name: string): boolean {
  const lower = name.toLowerCase();
  return EDITABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isReadable(name: string): boolean {
  const lower = name.toLowerCase();
  return READABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
