import React from 'react';

/**
 * Where the sidebar's assistant entry point sends people while the built-in
 * AI assistant is hidden (see `ASSISTANT_ENABLED`). Link created through
 * Instinct's own WhatsApp link builder; do not hand-edit the encoding.
 */
const INSTINCT_WHATSAPP_URL =
  'https://wa.me/16506588328?text=Hi%2C+I%27m+on+my+dashboard+and+need+a+hand+with+something.';

export { INSTINCT_WHATSAPP_URL };

/** WhatsApp glyph, drawn at the same stroke width feel as the lucide icons. */
export const WhatsAppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);

interface InstinctSidebarButtonProps {
  isCollapsed: boolean;
}

/**
 * Sidebar replacement for the AI assistant entry point: a quiet nav-style
 * button that opens the Instinct WhatsApp chat in a new tab. Styled to sit
 * exactly where the assistant list used to, with the same shape, spacing and
 * hover treatment as the main nav items.
 */
export const InstinctSidebarButton: React.FC<InstinctSidebarButtonProps> = ({ isCollapsed }) => (
  <div className="px-2 space-y-1">
    <a
      href={INSTINCT_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={isCollapsed ? 'Chat with Instinct on WhatsApp' : undefined}
      className={`w-full flex items-center rounded-xl text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-all duration-150 ${
        isCollapsed ? 'justify-center p-3' : 'space-x-3 px-3 py-2.5'
      }`}
    >
      <WhatsAppIcon className="w-5 h-5 flex-shrink-0" />
      {!isCollapsed && (
        <span className="truncate flex-1 text-left">Chat with Instinct</span>
      )}
    </a>
  </div>
);

/**
 * The same destination as a menu row (used in the profile menu, which is the
 * mobile-reachable entry point while the assistant is hidden).
 */
export const InstinctMenuRow: React.FC<{ className?: string }> = ({ className }) => (
  <a
    role="menuitem"
    href={INSTINCT_WHATSAPP_URL}
    target="_blank"
    rel="noopener noreferrer"
    className={className}
  >
    <WhatsAppIcon className="w-4 h-4 shrink-0" />
    Chat with Instinct
  </a>
);
