/**
 * HWP/HWPX magic-byte sniff. **Cheap pre-parse heuristic** — used as a
 * fast-path optimizer (e.g. skip a WASM round-trip when input is already
 * HWPX). For authoritative format identification post-parse, defer to
 * `@rhwp/core`'s `HwpDocument.getSourceFormat()`.
 */

export type HwpFormat = 'hwpx' | 'hwp' | 'unknown';

export function detectHwpFormat(bytes: Uint8Array): HwpFormat {
  if (bytes.length < 4) return 'unknown';
  // ZIP local file header → HWPX
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return 'hwpx';
  }
  // Microsoft Compound File Binary → HWP
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return 'hwp';
  }
  return 'unknown';
}

/**
 * Adjusts the path's extension to match `format`. Only swaps between
 * `.hwp` and `.hwpx`; unknown extensions and unknown formats pass through
 * unchanged so we never surprise the user with an arbitrary rename.
 */
export function correctExtension(filePath: string, format: HwpFormat): string {
  if (format === 'unknown') return filePath;
  const target = format === 'hwpx' ? '.hwpx' : '.hwp';
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return filePath + target;
  const ext = filePath.slice(dot).toLowerCase();
  if (ext === target) return filePath;
  if (ext === '.hwp' || ext === '.hwpx') {
    return filePath.slice(0, dot) + target;
  }
  return filePath;
}
