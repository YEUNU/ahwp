/**
 * Render-side SVG → PNG converter (0.6.20 — Phase B vision integration).
 *
 * vision-capable AI provider 들 (OpenAI / Gemini) 대부분이 raster 이미지
 * (PNG / JPEG / WebP) 만 신뢰성 있게 해석. SVG 를 그대로 보내면 일부 모델
 * 에서 거부 / 부분 해석. 따라서 chat layer 가 tool result 의 SVG 를
 * 받는 시점에 PNG 로 변환한 뒤 provider 어댑터에 넘긴다.
 *
 * 구현: Blob → object-URL → `Image` → `<canvas>` → `canvas.toDataURL`.
 * 모두 renderer (browser) API 만 사용 — Node 의존 없음. 변환 실패 시
 * (Image load 실패 / canvas 미지원) null 반환 — 호출자는 graceful
 * degrade (PNG 없이 text content 만 보내거나 vision skip).
 *
 * 크기 제어:
 * - `maxWidth` 기본 1024px. AI vision 모델 대부분 1024~2048px 에서
 *   최선. 그 이상은 비용/지연만 늘고 정확도 향상 미미. 큰 페이지면
 *   비율 유지하며 다운스케일.
 * - 결과 PNG base64 자체 크기는 호출자 책임 (provider 별 cap 다름).
 */

interface ConvertOptions {
  /** 최대 가로 픽셀. SVG 의 viewBox 기준 width 보다 크면 무시. */
  maxWidth?: number;
}

interface ConvertResult {
  base64: string;
  width: number;
  height: number;
}

const DEFAULT_MAX_WIDTH = 1024;

export async function svgToPngBase64(
  svg: string,
  opts?: ConvertOptions,
): Promise<ConvertResult | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  if (!svg || svg.length === 0) return null;
  const maxWidth = Math.max(
    64,
    Math.min(opts?.maxWidth ?? DEFAULT_MAX_WIDTH, 4096),
  );

  return new Promise<ConvertResult | null>((resolve) => {
    let objectUrl: string | null = null;
    const cleanup = (): void => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    try {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      objectUrl = URL.createObjectURL(blob);
    } catch {
      cleanup();
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = (): void => {
      try {
        // `Image.naturalWidth` 는 SVG 의 viewBox / width attr 에서 추출.
        // 일부 SVG 는 width 가 0 으로 와서 fallback 필요.
        const nw = img.naturalWidth || img.width || maxWidth;
        const nh = img.naturalHeight || img.height || maxWidth;
        const scale = nw > maxWidth ? maxWidth / nw : 1;
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        // 흰 배경 (SVG 가 투명 배경이면 vision 모델이 텍스트 contrast 낮춰
        // 잘못 읽는 경우 회피).
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/png');
        cleanup();
        const prefix = 'data:image/png;base64,';
        const base64 = dataUrl.startsWith(prefix)
          ? dataUrl.slice(prefix.length)
          : '';
        if (!base64) {
          resolve(null);
          return;
        }
        resolve({ base64, width: w, height: h });
      } catch {
        cleanup();
        resolve(null);
      }
    };
    img.onerror = (): void => {
      cleanup();
      resolve(null);
    };
    img.src = objectUrl;
  });
}
