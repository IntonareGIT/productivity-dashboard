import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Sun, Moon, Columns2 } from 'lucide-react';
import { useStatusThemeStore } from '../../stores/useStatusThemeStore';
import { ProfileMenu } from './ProfileMenu';
import type { NavTab } from './Sidebar';

interface TopBarProps {
  onSelectTab: (tab: NavTab) => void;
  /** Whether the split overlay is currently open. */
  splitOpen?: boolean;
  /** Toggle the split overlay. Visible on every tab and at every width. */
  onToggleSplit?: () => void;
}

/**
 * Top bar: clock on the left, light/dark toggle, the split-view icon and the
 * profile avatar on the right. Current status is no longer shown or set here —
 * it lives only in the profile menu ("Mood and theme") and in Settings.
 */
export const TopBar: React.FC<TopBarProps> = ({ onSelectTab, splitOpen, onToggleSplit }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  const { colorScheme, toggleColorScheme } = useStatusThemeStore();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="h-14 border-b border-border bg-bg-surface/80 backdrop-blur-md sticky top-0 z-30 px-4 md:px-6 flex items-center justify-between transition-colors">
      {/* Left side: Date & Time */}
      <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm min-w-0">
        <span className="font-semibold text-content-primary whitespace-nowrap">
          {format(currentTime, 'EEE, MMM d')}
        </span>
        <span className="hidden sm:inline text-content-tertiary">•</span>
        <span className="font-mono text-content-secondary font-medium whitespace-nowrap">
          {format(currentTime, 'HH:mm:ss')}
        </span>
      </div>

      {/* Right side: light/dark toggle + profile avatar */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        <button
          onClick={toggleColorScheme}
          aria-label="Toggle Light/Dark Theme"
          className="hidden md:inline-flex p-1.5 rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors border border-transparent hover:border-border"
        >
          {colorScheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700" />
          )}
        </button>

        {/* Split view — the ONLY generic entry point. Visible on every tab and at
            every width, including mobile. */}
        {onToggleSplit && (
          <button
            onClick={onToggleSplit}
            aria-label={splitOpen ? 'Close split view' : 'Open split view'}
            aria-pressed={splitOpen}
            title={splitOpen ? 'Close split view' : 'Open split view'}
            className={`inline-flex p-1.5 rounded-lg transition-colors border ${
              splitOpen
                ? 'text-accent bg-accent-subtle border-accent'
                : 'text-content-secondary hover:text-content-primary hover:bg-bg-elevated border-transparent hover:border-border'
            }`}
          >
            <Columns2 className="w-4 h-4" />
          </button>
        )}

        {/* Profile avatar + menu — visible at every width. */}
        <ProfileMenu onNavigate={onSelectTab} />
      </div>
    </header>
  );
};

