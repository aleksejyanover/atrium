export interface Point {
  x: number;
  y: number;
}

/** A single pen stroke — an ordered list of points. */
export type Stroke = Point[];

function round(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Convert one stroke into a smooth SVG path (midpoint quadratic smoothing).
 */
export function strokeToPath(stroke: Stroke): string {
  if (stroke.length === 0) return '';
  const first = stroke[0];
  if (stroke.length === 1) {
    // A single tap — render a tiny segment so the dot is visible.
    return `M ${round(first.x)} ${round(first.y)} L ${round(first.x + 0.1)} ${round(first.y)}`;
  }
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < stroke.length - 1; i++) {
    const p = stroke[i];
    const next = stroke[i + 1];
    const midX = (p.x + next.x) / 2;
    const midY = (p.y + next.y) / 2;
    d += ` Q ${round(p.x)} ${round(p.y)} ${round(midX)} ${round(midY)}`;
  }
  const last = stroke[stroke.length - 1];
  d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

/**
 * Build an SVG document from the drawn strokes (dark background, light ink —
 * exactly what the user sees on the signature pad).
 */
export function strokesToSvg(strokes: Stroke[], width: number, height: number): string {
  const paths = strokes
    .map(
      (s) =>
        `<path d="${strokeToPath(s)}" fill="none" stroke="#ECECEF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}"><rect width="100%" height="100%" fill="#0A0A0C"/>${paths}</svg>`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 for an ASCII string (our SVG document is ASCII-only). */
export function base64EncodeAscii(input: string): string {
  let out = '';
  let i = 0;
  for (; i + 2 < input.length; i += 3) {
    const n = (input.charCodeAt(i) << 16) | (input.charCodeAt(i + 1) << 8) | input.charCodeAt(i + 2);
    out +=
      B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = input.length - i;
  if (rest === 1) {
    const n = input.charCodeAt(i) << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (input.charCodeAt(i) << 16) | (input.charCodeAt(i + 1) << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/**
 * Signature payload sent to POST /api/invites/:id/accept.
 *
 * React Native has no canvas, so instead of `data:image/png;base64,...` we
 * serialize the drawn strokes to an SVG document and base64-encode it as
 * `data:image/svg+xml;base64,...`. The backend only requires the value to
 * start with `data:image/`, so this satisfies the contract.
 */
export function strokesToSignatureDataUrl(
  strokes: Stroke[],
  width: number,
  height: number,
): string {
  const svg = strokesToSvg(strokes, width, height);
  return `data:image/svg+xml;base64,${base64EncodeAscii(svg)}`;
}
