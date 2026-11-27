import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Sun, Moon, Columns2 } from 'lucide-react';
import { useStatusThemeStore } from '../../stores/useStatusThemeStore';
import { ProfileMenu } from './ProfileMenu';
import { AssistantMenu } from './AssistantMenu';
import { FocusTimerWidget } from './FocusTimerWidget';
import { QuickCaptureButton } from '../../features/capture/QuickCapture';
import type { NavTab } from './Sidebar';

interface TopToolsProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  splitOpen?: boolean;
  onToggleSplit?: () => void;
}

/**
 * Top navigation: brand and every destination on one line, tools on the right.
 * Replaces the sidebar. On phones only the brand, date and tools show; the
 * destinations live in the bottom bar.
 */
export const TopTools: React.FC<TopToolsProps> = ({ activeTab, onSelectTab, splitOpen, onToggleSplit }) => {
  const [now, setNow] = useState(new Date());
  const { colorScheme, toggleColorScheme } = useStatusThemeStore();

  useEffect(() => {
    if (splitOpen) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [splitOpen]);

  return (
    <header className="h-14 shrink-0 sticky top-0 z-30 bg-bg px-3 md:px-6 flex items-center gap-2">
      <button onClick={() => onSelectTab('dashboard')} className="flex items-center gap-2 mr-1 md:mr-4 shrink-0" aria-label="Dashboard">
        <span className="w-7 h-7 rounded-md bg-accent text-white font-bold text-sm flex items-center justify-center">P</span>
        <span className="font-semibold text-sm text-content-primary">Productivity</span>
      </button>

      {splitOpen && <span className="text-[11px] font-semibold uppercase tracking-wider text-content-tertiary">Split view</span>}

      <div className="flex-1" />

      {!splitOpen && (
        <span className="hidden sm:inline text-xs text-content-secondary whitespace-nowrap mr-1">
          {format(now, 'EEE, MMM d')} <span className="font-mono">{format(now, 'HH:mm')}</span>
        </span>
      )}
      <div className="hidden md:block"><FocusTimerWidget isCollapsed={false} /></div>
      <AssistantMenu />
      <QuickCaptureButton />
      <button
        onClick={toggleColorScheme}
        aria-label="Toggle Light/Dark Theme"
        className="hidden md:inline-flex p-1.5 rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated"
      >
        {colorScheme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
      </button>
      {onToggleSplit && (
        <button
          onClick={onToggleSplit}
          aria-label={splitOpen ? 'Close split view' : 'Open split view'}
          aria-pressed={splitOpen}
          className={`inline-flex p-1.5 rounded-lg ${splitOpen ? 'text-accent bg-accent-subtle' : 'text-content-secondary hover:text-content-primary hover:bg-bg-elevated'}`}
        >
          <Columns2 className="w-4 h-4" />
        </button>
      )}
      <ProfileMenu onNavigate={onSelectTab} />
    </header>
  );
};
