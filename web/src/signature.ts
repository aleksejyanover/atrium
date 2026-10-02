/** Rendering helpers for the personal signature (SPEC v3 §17). */

const SIGNATURE_FONT = 'italic 700 34px Caveat, "Segoe Script", cursive';
const SIGNATURE_STROKE = '#9B8CFF';
const SIGNATURE_BG = '#0A0A0C';
const MAX_WIDTH = 960;

/**
 * Draws a typed signature in the Caveat cursive font and returns
 * `data:image/png;base64,…` (kept as an image — no text→picture conversion
 * happens anywhere else, the image IS the stored signature per SPEC v3 §17).
 */
export function renderTypedSignature(text: string): string {
  const value = text.trim();
  // Make sure the webfont is available before measuring (best effort).
  try {
    void document.fonts?.load?.(SIGNATURE_FONT);
  } catch {
    /* font loading unsupported — canvas falls back to a system cursive */
  }

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Холст недоступен — попробуйте нарисовать подпись');
  measureCtx.font = SIGNATURE_FONT;
  const textWidth = measureCtx.measureText(value).width;

  const scale = textWidth > MAX_WIDTH ? MAX_WIDTH / textWidth : 1;
  const width = Math.max(120, Math.ceil((textWidth + 40) * scale));
  const height = 96;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Холст недоступен — попробуйте нарисовать подпись');

  ctx.fillStyle = SIGNATURE_BG;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (scale !== 1) ctx.scale(scale, 1);
  ctx.font = SIGNATURE_FONT;
  ctx.fillStyle = SIGNATURE_STROKE;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, 20 / scale, height / 2);
  ctx.restore();

  return canvas.toDataURL('image/png');
}
