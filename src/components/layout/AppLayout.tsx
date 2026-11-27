import React from 'react';
import type { NavTab } from './Sidebar';
import { TopNav } from './TopNav';
import { BottomNav } from './BottomNav';
import { GlobalErrorBanner } from '../../features/library/components/ViewerErrorBoundary';

interface AppLayoutProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  children: React.ReactNode;
  /**
   * Layered over the main content area, below the top bar and above the tab
   * content. The split view renders here so it is an app-level overlay rather
   * than something owned by one tab.
   */
  overlay?: React.ReactNode;
  /** Split view is open; the top-bar icon toggles it. */
  splitOpen?: boolean;
  /** Toggle the split overlay. The ONLY generic entry point for the split. */
  onToggleSplit?: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeTab,
  onSelectTab,
  children,
  overlay,
  splitOpen = false,
  onToggleSplit,
}) => {
  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col bg-bg text-content-primary">
      {/* Main Content Area. A definite height (`h-full` on a `100dvh` shell) is
          what lets the split overlay's `bottom-0` actually reach the viewport
          floor, and what gives the PDF panes a real height to fill. */}
      <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col pb-16 md:pb-0 relative">
        <TopNav
          activeTab={activeTab}
          onSelectTab={onSelectTab}
          splitOpen={splitOpen}
          onToggleSplit={onToggleSplit}
        />
        <main key={activeTab} className="page-enter flex-1 min-h-0 px-4 py-4 md:px-8 md:py-6 max-w-6xl w-full mx-auto overflow-y-auto">
          {children}
        </main>
        {overlay}
      </div>

      {/* Mobile Bottom Navigation (< 768px) */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} />

      {/* Last-resort diagnostics. Mounted at the root so it survives anything a
          viewer throws: there is no console on a phone, and a blank page with no
          message is impossible to act on or report. */}
      <GlobalErrorBanner />
    </div>
  );
};
