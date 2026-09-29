import React, { useEffect, useRef, useState } from 'react';
import { Sidebar, type NavTab } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // ---- Focus Mode -------------------------------------------------------
  // Entering the split view claims the whole screen, so the sidebar is
  // collapsed to its icon rail and the non-essential top-bar content is
  // hidden (see TopBar). Whatever the user had chosen beforehand is remembered
  // in a ref — not in state — so reopening the split cannot capture a stale
  // value, and leaving restores the user's own preference.
  const userCollapseRef = useRef(false);
  useEffect(() => {
    if (splitOpen) {
      // Capture the pre-split preference exactly once, on entry.
      setIsSidebarCollapsed((wasCollapsed) => {
        userCollapseRef.current = wasCollapsed;
        return true;
      });
    } else {
      setIsSidebarCollapsed(userCollapseRef.current);
    }
  }, [splitOpen]);

  return (
    <div className="h-[100dvh] overflow-hidden flex bg-bg text-content-primary">
      {/* Desktop Collapsible Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => {
          setIsSidebarCollapsed((c) => !c);
          userCollapseRef.current = !isSidebarCollapsed;
        }}
      />

      {/* Main Content Area. A definite height (`h-full` on a `100dvh` shell) is
          what lets the split overlay's `bottom-0` actually reach the viewport
          floor, and what gives the PDF panes a real height to fill. */}
      <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col pb-16 md:pb-0 relative">
        <TopBar
          onSelectTab={onSelectTab}
          splitOpen={splitOpen}
          onToggleSplit={onToggleSplit}
        />
        <main className="flex-1 min-h-0 p-4 md:p-6 max-w-7xl w-full mx-auto overflow-y-auto">
          {children}
        </main>
        {overlay}
      </div>

      {/* Mobile Bottom Navigation (< 768px) */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} />
    </div>
  );
};
