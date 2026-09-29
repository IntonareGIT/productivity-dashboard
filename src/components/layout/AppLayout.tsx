import React, { useState } from 'react';
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

  return (
    <div className="min-h-screen flex bg-bg text-content-primary">
      {/* Desktop Collapsible Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0 relative">
        <TopBar onSelectTab={onSelectTab} splitOpen={splitOpen} onToggleSplit={onToggleSplit} />
        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto overflow-y-auto">
          {children}
        </main>
        {overlay}
      </div>

      {/* Mobile Bottom Navigation (< 768px) */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} />
    </div>
  );
};
