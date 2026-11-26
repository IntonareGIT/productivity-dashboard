import React, { useCallback, useRef, useState } from 'react';

/** A drag in progress, in CSS pixels relative to the page surface. */
interface DragBox { x: number; y: number; w: number; h: number }

/**
 * Crop a region of a rendered PDF page to a PNG.
 *
 * The tool works on the CANVAS rather than on the DOM: `getImageData` reads
 * actual pixels, so the output contains the diagram, the equation glyphs or the
 * scanned figure itself. A DOM-screenshot approach cannot see any of those,
 * because they all exist only as pixels in the bitmap.
 *
 * Two details that are easy to get wrong:
 *
 * 1. The drag rectangle is in CSS pixels but the canvas is in DEVICE pixels. The
 *    backing store is larger than the displayed box by the device pixel ratio,
 *    so the crop rectangle must be scaled before it indexes into the pixel data.
 *    Skipping this crops the wrong region, or an empty one, on any HiDPI screen.
 * 2. `getImageData` is called on a canvas that already holds the page, so no
 *    cross-origin taint is possible here. A blob is produced with `toBlob`, not
 *    `toDataURL`, because the result is going to the clipboard as binary and a
 *    base64 round trip would triple its size for nothing.
 */
export const PdfSnippetLayer: React.FC<{
  /** The page's canvas, used as the pixel source. */
  canvas: HTMLCanvasElement | null;
  /** True when the snippet tool is armed. */
  active: boolean;
  /** Called with the cropped PNG blob, or null when the crop was abandoned. */
  onCrop: (blob: Blob | null) => void;
}> = ({ canvas, active, onCrop }) => {
  const [drag, setDrag] = useState<DragBox | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const toLocal = useCallback((e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (!active) return;
    // Capture keeps the drag alive when the pointer leaves the page surface,
    // which otherwise aborts the drag halfway across a large region.
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    originRef.current = p;
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!originRef.current) return;
    const p = toLocal(e);
    const o = originRef.current;
    // Normalised so dragging up and left gives positive width and height, and
    // the resulting rectangle is the same whichever way the user drew it.
    setDrag({
      x: Math.min(o.x, p.x),
      y: Math.min(o.y, p.y),
      w: Math.abs(p.x - o.x),
      h: Math.abs(p.y - o.y),
    });
  };

  const finish = (e: React.PointerEvent) => {
    const box = drag;
    originRef.current = null;
    setDrag(null);
    // SINGLE-USE: the tool disarms on EVERY exit from a drag, not only the happy
    // path. Pointer cancel, a stray click and a degenerate crop all have to turn
    // it off, or the user is left with a crosshair overlay they cannot escape
    // without finding the toolbar button.
    if (!box || !canvas) { onCrop(null); return; }

    // Ignore a stray click: anything under a few CSS pixels is a mis-tap, and
    // cropping it would produce a 1x1 image the user cannot see or use.
    if (box.w < 6 || box.h < 6) { onCrop(null); return; }

    // CSS pixels -> device pixels. See note 1 above.
    const sx = canvas.width / canvas.getBoundingClientRect().width;
    const sy = canvas.height / canvas.getBoundingClientRect().height;
    const px = Math.max(0, Math.round(box.x * sx));
    const py = Math.max(0, Math.round(box.y * sy));
    // Clamp to the bitmap: a drag that runs past the edge must crop what exists
    // rather than throw, which a too-large rect would.
    const pw = Math.min(Math.round(box.w * sx), canvas.width - px);
    const ph = Math.min(Math.round(box.h * sy), canvas.height - py);
    if (pw <= 0 || ph <= 0) { onCrop(null); return; }

    const out = document.createElement('canvas');
    out.width = pw;
    out.height = ph;
    const ctx = out.getContext('2d');
    if (!ctx) { onCrop(null); return; }
    ctx.drawImage(
      canvas,
      px, py, pw, ph,
      0, 0, pw, ph,
    );
    out.toBlob((blob) => onCrop(blob), 'image/png');
    e.preventDefault();
  };

  if (!active) return null;

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={finish}
      onPointerCancel={() => { originRef.current = null; setDrag(null); onCrop(null); }}
    >
      {drag && (
        <div
          className="pointer-events-none absolute border-2 border-accent bg-accent/15 rounded-sm"
          style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}
          aria-hidden
        />
      )}
    </div>
  );
};