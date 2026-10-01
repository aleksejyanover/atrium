/** HTML canvas signature pad — pointer events (mouse + touch), violet stroke on dark. */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface SignaturePadHandle {
  clear: () => void;
  /** `data:image/png;base64,…` or null when nothing was drawn yet */
  toDataURL: () => string | null;
}

interface SignaturePadProps {
  onInkChange?: (hasInk: boolean) => void;
}

const STROKE = '#9B8CFF';
const BACKGROUND = '#0A0A0C';

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ onInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const strokes = useRef(0);
    const last = useRef<{ x: number; y: number } | null>(null);
    const inkRef = useRef(onInkChange);
    inkRef.current = onInkChange;

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = STROKE;
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) {
            const rect = canvas.getBoundingClientRect();
            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(0, 0, rect.width, rect.height);
          }
          strokes.current = 0;
          drawing.current = false;
          last.current = null;
          inkRef.current?.(false);
        },
        toDataURL: () => {
          const canvas = canvasRef.current;
          if (!canvas || strokes.current === 0) return null;
          try {
            return canvas.toDataURL('image/png');
          } catch {
            return null;
          }
        },
      }),
      [],
    );

    const pointAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* not supported — drawing still works inside bounds */
      }
      drawing.current = true;
      const p = pointAt(e);
      last.current = p;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y + 0.01);
      ctx.stroke();
      strokes.current += 1;
      if (strokes.current === 1) inkRef.current?.(true);
    };

    const handleMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const p = pointAt(e);
      const from = last.current ?? p;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    };

    const handleUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      drawing.current = false;
      last.current = null;
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    return (
      <canvas
        ref={canvasRef}
        className="sig-pad"
        aria-label="Поле для подписи"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleUp}
      />
    );
  },
);
