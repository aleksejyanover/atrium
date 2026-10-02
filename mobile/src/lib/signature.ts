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

/** UTF-8 encode a JS string to bytes (typed signatures contain Cyrillic). */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
      const c2 = input.charCodeAt(i + 1);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      i++;
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

/** Base64 for a (possibly Cyrillic) UTF-8 string. */
export function base64EncodeUtf8(input: string): string {
  const bytes = utf8Bytes(input);
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Decode base64 back to a UTF-8 string. */
export function base64DecodeUtf8(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2raw = clean[i + 2];
    const c3raw = clean[i + 3];
    const c2 = c2raw === undefined || c2raw === '=' ? -1 : B64.indexOf(c2raw);
    const c3 = c3raw === undefined || c3raw === '=' ? -1 : B64.indexOf(c3raw);
    if (c0 < 0 || c1 < 0) break;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i];
    if (c < 0x80) {
      out += String.fromCharCode(c);
      i += 1;
    } else if (c < 0xe0) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (c < 0xf0) {
      out += String.fromCharCode(
        ((c & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((c & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const adj = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff));
      i += 4;
    }
  }
  return out;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 420×120 SVG «рукописной» печатной подписи (шрифт Caveat, курсив). */
export function typedSignatureSvg(text: string): string {
  const value = escapeXml(text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120" viewBox="0 0 420 120">` +
    `<rect width="100%" height="100%" fill="#0A0A0C"/>` +
    `<text x="210" y="80" fill="#ECECEF" font-family="Caveat, cursive" font-size="64" ` +
    `font-style="italic" text-anchor="middle">${value}</text></svg>`
  );
}

/** Печатная подпись → data:image/svg+xml;base64,... (SPEC v3 §17, kind 'typed'). */
export function typedSignatureDataUrl(text: string): string {
  return `data:image/svg+xml;base64,${base64EncodeUtf8(typedSignatureSvg(text))}`;
}

/** Extract the SVG document from a data URL (only for image/svg+xml). */
export function dataUrlToSvg(dataUrl: string | null | undefined): string | null {
  if (!dataUrl) return null;
  const base64Prefix = 'data:image/svg+xml;base64,';
  const urlPrefix = 'data:image/svg+xml,';
  if (dataUrl.startsWith(base64Prefix)) {
    try {
      return base64DecodeUtf8(dataUrl.slice(base64Prefix.length));
    } catch {
      return null;
    }
  }
  if (dataUrl.startsWith(urlPrefix)) {
    try {
      return decodeURIComponent(dataUrl.slice(urlPrefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

/** Text of a typed signature stored as an SVG data URL (null for drawn/png). */
export function signatureTextFromDataUrl(dataUrl: string | null | undefined): string | null {
  const svg = dataUrlToSvg(dataUrl);
  if (!svg) return null;
  const match = /<text[^>]*>([\s\S]*?)<\/text>/.exec(svg);
  if (!match) return null;
  const text = unescapeXml(match[1]).trim();
  return text.length >= 1 ? text : null;
}

/** All path data (`d` attributes) of an SVG document — for preview rendering. */
export function svgPathDataList(svg: string): string[] {
  const out: string[] = [];
  const re = /<path[^>]*?\sd="([^"]*)"/g;
  let match: RegExpExecArray | null = re.exec(svg);
  while (match) {
    out.push(match[1]);
    match = re.exec(svg);
  }
  return out;
}

/** Width/height of an SVG document (falls back to the viewBox). */
export function svgSize(svg: string): { width: number; height: number } {
  const width = /\swidth="(\d+(?:\.\d+)?)/.exec(svg);
  const height = /\sheight="(\d+(?:\.\d+)?)/.exec(svg);
  if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  return { width: 420, height: 120 };
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
