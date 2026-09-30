import React from 'react';
import { 
  LayoutDashboard, 
  BookMarked, 
  CalendarDays, 
  CalendarClock, 
  Timer, 
  Settings2,
  ChevronLeft,
  ChevronRight,
  Compass
} from 'lucide-react';

export type NavTab = 'dashboard' | 'library' | 'calendar' | 'shifts' | 'focus' | 'settings' | 'about';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const navItems: {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Omitted from the PHONE bottom bar, where six items is already the practical
   * limit before the labels start to crowd. About is reference material, not a
   * daily destination, so on a phone it is reached from the sidebar collapse /
   * Settings instead of costing a permanent slot.
   */
  hideOnMobile?: boolean;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'library', label: 'Library', icon: BookMarked },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'shifts', label: 'Shifts', icon: CalendarClock },
  { id: 'focus', label: 'Focus', icon: Timer },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'about', label: 'About & Help', icon: Compass, hideOnMobile: true },
];


export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
}) => {
  return (
    <aside
      className={`hidden md:flex flex-col border-r border-border bg-bg-surface/50 backdrop-blur-sm h-screen sticky top-0 transition-all duration-300 ease-in-out z-20 ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        {!isCollapsed && (
          <div className="flex items-center space-x-2.5 overflow-hidden">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
              P
            </div>
            <span className="font-semibold text-sm tracking-tight text-content-primary truncate">
              Productivity
            </span>
          </div>
        )}
        {isCollapsed && (
          <div className="w-full flex justify-center">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm shadow-sm">
              P
            </div>
          </div>
        )}
      </div>

      {/* Nav links */}
      <div className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center rounded-xl text-sm font-medium transition-all duration-150 ${
                isCollapsed ? 'justify-center p-3' : 'space-x-3 px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-accent text-white shadow-sm shadow-accent/20'
                  : 'text-content-secondary hover:text-content-primary hover:bg-bg-elevated'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Collapse Toggle Footer */}
      <div className="p-2 border-t border-border">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors text-xs"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center space-x-2 w-full px-2">
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
