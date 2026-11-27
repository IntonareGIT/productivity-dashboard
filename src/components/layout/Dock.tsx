import React from 'react';
import { navItems, type NavTab } from './Sidebar';
import { Z } from '../ui/zIndex';

interface DockProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

/** Floating navigation dock. The active destination shows its label. */
export const Dock: React.FC<DockProps> = ({ activeTab, onSelectTab }) => (
  <nav
    data-floating-ai-keepout="bottom-nav"
    aria-label="Main"
    className={`fixed bottom-4 left-1/2 -translate-x-1/2 ${Z.nav} max-w-[calc(100vw-1rem)] flex items-center gap-0.5 rounded-2xl border border-border bg-bg-surface p-1.5`}
    style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
  >
    {navItems.map((item) => {
      const Icon = item.icon;
      const active = activeTab === item.id;
      return (
        <button
          key={item.id}
          onClick={() => onSelectTab(item.id)}
          title={item.label}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={`flex items-center gap-2 h-10 rounded-xl text-sm font-medium ${
            item.hideOnMobile ? 'hidden sm:flex' : ''
          } ${active ? 'bg-accent-subtle text-accent-text px-3' : 'w-10 justify-center text-content-secondary hover:text-content-primary hover:bg-bg-elevated'}`}
        >
          <Icon className="w-5 h-5 shrink-0" />
          {active && <span className="hidden sm:inline">{item.label}</span>}
        </button>
      );
    })}
  </nav>
);
