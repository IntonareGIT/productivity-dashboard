import React, { useEffect, useRef } from 'react';

/**
 * The handle pdf.js's `TextLayer` exposes, declared locally.
 *
 * This module deliberately does NOT import from `pdfjs-dist`. The project keeps
 * exactly one pdf.js importer (`PdfViewer.tsx`) so the worker is registered once
 * and there is a single place that owns the library's lifecycle; a second
 * `import * as pdfjsLib` here would quietly break that invariant. So the layer
 * is constructed by a factory handed down from the viewer instead.
 */
export interface TextLayerHandle {
  /** Resolves once every glyph span has been placed. */
  render(): Promise<void>;
  /** Abandons an in-flight render and releases its internal state. */
  cancel(): void;
}

/** The minimum a page proxy must offer to feed the factory. */
interface PageLike {
  streamTextContent: (...args: unknown[]) => unknown;
}

/**
 * Creates a text layer bound to `container`. Supplied by `PdfViewer`.
 */
export type TextLayerFactory = (
  container: HTMLElement,
  page: PageLike,
  viewport: unknown,
) => TextLayerHandle;

/**
 * One page's transparent text layer.
 *
 * Split out from `PdfViewer` because it owns a lifecycle that does not belong to
 * the canvas: a `pdfjsLib.TextLayer` is created per page per geometry, must be
 * CANCELLED when the page re-renders at a new zoom or scrolls out of the render
 * window, and must be discarded on unmount. Getting that wrong leaks DOM nodes
 * and leaves stale glyph boxes over a freshly drawn page.
 *
 * The text content is requested from the page rather than being passed in, so the
 * caller does not have to join the render pipeline to the text pipeline. A page
 * that fails to yield text (a pure scan) simply gets an empty layer, and the
 * canvas is unaffected.
 */
export const PdfTextLayer: React.FC<{
  /** The pdf.js page proxy. */
  page: PageLike | null;
  /** The same viewport the canvas was rendered with. */
  viewport: unknown;
  /** Builds the layer. Supplied by the single pdf.js owner, `PdfViewer`. */
  createLayer: TextLayerFactory;
  /** Current rotation, so a rotation change discards and rebuilds the layer. */
  rotation: number;
  /** Bumped by the parent to force a rebuild at an unchanged geometry. */
  generation: number;
  /** True while the snippet tool owns the pointer on this page. */
  snippetOn: boolean;
}> = ({ page, viewport, createLayer, rotation, generation, snippetOn }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    // A missing host means the page scrolled out of the render window, and a
    // missing viewport means there is no geometry to align glyphs to. Either
    // way there is nothing to draw.
    if (!host || !page || !viewport) return;

    const layer = createLayer(host, page, viewport);
    // The promise is fire-and-forget on purpose: `render()` resolves once every
    // glyph is placed, and a rejection here would be an unhandled rejection in a
    // component with no error boundary. A text layer that fails is a degraded
    // but perfectly usable canvas underneath.
    layer.render().catch(() => { /* page has no extractable text */ });

    return () => {
      layer.cancel();
      // pdf.js appends into the container; clearing it releases the glyph spans
      // now rather than waiting for the next render to overwrite them.
      host.replaceChildren();
    };
  }, [page, viewport, createLayer, rotation, generation]);

  // NOT `aria-hidden`. The canvas beside it is marked `aria-hidden` instead, so
  // the page is announced once, from this real text, rather than as an opaque
  // labelled image plus a duplicate.
  return (
    <div
      ref={hostRef}
      className="pdf-text-layer"
      data-snippet-on={snippetOn ? 'true' : 'false'}
    />
  );
};