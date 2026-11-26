/**
 * One shared z-index scale.
 *
 * The app grew several layers that each hard-coded `z-50`, which is why a dialog
 * could open *behind* another surface: equal z-indexes fall back to DOM order, so
 * whichever mounted later won, not whichever was meant to be on top. Numbers are
 * declared here once, in one order, so a new layer has to pick a slot instead of
 * guessing 50 again.
 *
 * Tailwind cannot see interpolated class names, so these are complete literal
 * strings and are referenced as `Z.modal`, `Z.nav`, and so on.
 */
export const Z = {
  /** In-page content that should sit above the scrolling body. */
  content: 'z-10',
  /** Sticky sub-headers inside a pane. */
  sticky: 'z-20',
  /** The bottom tab bar and the floating assistant launcher. */
  nav: 'z-40',
  /** Dropdowns, popovers and menus anchored to a control. */
  popover: 'z-50',
  /** Click-away / dimming layer BEHIND a dialog. */
  backdrop: 'z-[60]',
  /** Dialogs: modals, sheets, the command palette, the assistant panel. */
  modal: 'z-[70]',
  /** Toasts. Above dialogs so a save confirmation is never hidden. */
  toast: 'z-[80]',
  /** Full-screen media (PDF/image) and viewer error banners. */
  fullscreen: 'z-[90]',
} as const;