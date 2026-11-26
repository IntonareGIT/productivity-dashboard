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
    // The clock is the only thing in this bar that ticks. While the split view
    // owns the screen there is no reason to run a per-second timer, so the
    // interval is torn down along with the date/time itself (see below).
    if (splitOpen) return;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [splitOpen]);

  return (
    <header className="h-14 shrink-0 border-b border-border bg-bg-surface/80 backdrop-blur-md sticky top-0 z-30 px-4 md:px-6 flex items-center justify-between transition-colors">
      {/* Left side: Date & Time.
          Focus Mode: hidden entirely while the split view is open, so the bar
          carries nothing but the controls on the right. The bar keeps its
          `h-14` height either way — the split overlay is positioned at
          `top-14`, so shrinking it would misalign the two. */}
      {!splitOpen && (
        <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm min-w-0">
          <span className="font-semibold text-content-primary whitespace-nowrap">
            {format(currentTime, 'EEE, MMM d')}
          </span>
          <span className="hidden sm:inline text-content-tertiary">•</span>
          <span className="font-mono text-content-secondary font-medium whitespace-nowrap">
            {format(currentTime, 'HH:mm:ss')}
          </span>
        </div>
      )}
      {splitOpen && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-content-tertiary">
          Split view
        </span>
      )}

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

