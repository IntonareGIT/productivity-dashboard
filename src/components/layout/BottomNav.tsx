import React from 'react';
import { navItems, type NavTab } from './Sidebar';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-bg-surface/90 backdrop-blur-lg border-t border-border z-40 px-2 flex items-center justify-around">
      {/* `hideOnMobile` items are reachable from the desktop sidebar and from
          Settings, but stay out of the phone bar so six labels still fit. */}
      {navItems.filter((item) => !item.hideOnMobile).map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all rounded-lg ${
              isActive
                ? 'text-accent font-semibold'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            <div className={`p-1 rounded-full ${isActive ? 'bg-accent-subtle' : ''}`}>
              <Icon className="w-5 h-5" />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight truncate max-w-[54px]">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
