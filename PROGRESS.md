# Overnight work progress

Branch: `overnight-features` (based on `3d09007` from `ai-pdf-reading`).
No merge into `main` will be attempted. No deploy commands will be run.

## Phase status

| Phase | Status |
| --- | --- |
| 0. PDF viewer crash cleanup | skipped, already complete before this run |
| 1. Fix "New group" doing nothing | in progress |
| 2. AI assistant tools | not started |
| 3. Notes editor rich text | not started |

## Phase 0: skipped

Checked `PdfViewer.tsx`, `ImageViewer.tsx`, `useZoomAnchor.ts` and
`ViewerErrorBoundary.tsx` for `probeBefore`, `probeAfter`, `[zoomdbg]`,
`ZOOM_DEBUG`, `frameCounter`, `zdbg`, `canvas-size` and `previewAtRelease`.
Zero remnants. The error boundary already renders stack frames. This cleanup
landed in commit `3d09007`, so the phase is skipped rather than repeated.
