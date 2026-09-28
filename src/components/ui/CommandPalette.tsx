import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import {
  BookMarked,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  LayoutDashboard,
  Plane,
  Play,
  Search,
  Settings2,
  Sparkles,
  Timer,
} from 'lucide-react';
import { db } from '../../db/db';
import { setOverrideForDate, clearOverrideForDate } from '../../features/shifts/shiftsRepo';
import { usePomodoroStore } from '../../stores/usePomodoroStore';
import { useAssistantStore } from '../../stores/useAssistantStore';
import type { NavTab } from '../layout/Sidebar';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
  onNewEvent: () => void; // parent navigates to Calendar and opens the event modal
}

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/** Ctrl/Cmd+K quick-add palette: new event, start pomodoro, log PTO, navigation. */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  onNavigate,
  onNewEvent,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const todayOverride = useLiveQuery(
    () => db.shiftOverrides.where('date').equals(todayKey).first(),
    [todayKey]
  );
  const timerRunning = usePomodoroStore((s) => s.isRunning);
  const startTimer = usePomodoroStore((s) => s.startTimer);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      document.body.style.overflow = 'hidden';
      window.setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const isPtoToday = todayOverride?.type === 'pto';
    const list: Command[] = [
      {
        id: 'new-event',
        group: 'Quick add',
        label: 'New event…',
        hint: 'Calendar',
        icon: CalendarPlus,
        run: () => {
          onNewEvent();
          onClose();
        },
      },
      {
        id: 'start-pomodoro',
        group: 'Quick add',
        label: timerRunning ? 'Open focus timer (running)' : 'Start pomodoro',
        hint: timerRunning ? `${Math.floor(usePomodoroStore.getState().timeLeft / 60)}m left` : 'Focus',
        icon: Play,
        run: () => {
          if (!timerRunning) startTimer();
          onNavigate('focus');
          onClose();
        },
      },
      {
        id: 'toggle-pto',
        group: 'Quick add',
        label: isPtoToday ? 'Remove PTO for today' : 'Log PTO for today',
        hint: isPtoToday ? 'Shifts' : 'Shifts',
        icon: Plane,
        run: () => {
          void (isPtoToday
            ? clearOverrideForDate(todayKey)
            : setOverrideForDate({ date: todayKey, type: 'pto', note: 'Logged from command palette' })
          ).then(() => {
            onNavigate('shifts');
            onClose();
          });
        },
      },
      {
        id: 'toggle-ai-assistant',
        group: 'AI Assistant',
        label: 'Open AI assistant',
        hint: 'Assistant',
        icon: Sparkles,
        run: () => {
          onClose();
          useAssistantStore.getState().setOpen(true);
        },
      },
    ];

    const navItems: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
      { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard },
      { id: 'library', label: 'Go to Library', icon: BookMarked },
      { id: 'calendar', label: 'Go to Calendar', icon: CalendarDays },
      { id: 'shifts', label: 'Go to Shifts', icon: CalendarClock },
      { id: 'focus', label: 'Go to Focus', icon: Timer },
      { id: 'settings', label: 'Go to Settings', icon: Settings2 },
    ];
    for (const item of navItems) {
      list.push({
        id: `nav-${item.id}`,
        group: 'Navigate',
        label: item.label,
        icon: item.icon,
        run: () => {
          onNavigate(item.id);
          onClose();
        },
      });
    }
    return list;
  }, [todayKey, todayOverride, timerRunning, startTimer, onNavigate, onClose, onNewEvent]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const trimmed = query.trim();

    if (!q) return commands;

    const matched = commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    );

    const askAssistantCommand: Command = {
      id: 'ai-assistant-ask',
      group: 'AI Assistant',
      label: `Ask Assistant: "${trimmed}"`,
      icon: Sparkles,
      run: () => {
        onClose();
        useAssistantStore.getState().ask(trimmed);
      },
    };

    return [...matched, askAssistantCommand];
  }, [commands, query, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[selected]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Keep the highlighted row visible.
  useEffect(() => {
    const el = listRef.current?.querySelectorAll('[data-command-row]')[selected];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, filtered.length]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full sm:max-w-lg mx-0 sm:mx-4 mt-16 sm:mt-0 bg-bg-surface border border-border rounded-none sm:rounded-2xl shadow-2xl overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 border-b border-border">
          <Search className="w-4 h-4 text-content-tertiary shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Type a command… (new event, start pomodoro, log PTO)"
            className="flex-1 bg-transparent py-4 text-sm text-content-primary outline-none placeholder:text-content-tertiary min-w-0"
          />
          <kbd className="hidden sm:block text-[10px] font-mono text-content-tertiary border border-border rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-content-tertiary text-center py-8">No matching commands.</p>
          ) : (
            filtered.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              return (
                <div key={command.id}>
                  {showGroup && (
                    <div className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-wider font-semibold text-content-tertiary">
                      {command.group}
                    </div>
                  )}
                  <button
                    data-command-row
                    onClick={command.run}
                    onMouseEnter={() => setSelected(index)}
                    className={`w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left transition-colors ${
                      index === selected ? 'bg-accent-subtle' : ''
                    }`}
                  >
                    <command.icon
                      className={`w-4 h-4 shrink-0 ${
                        index === selected ? 'text-accent' : 'text-content-secondary'
                      }`}
                    />
                    <span className="text-sm text-content-primary flex-1 truncate">
                      {command.label}
                    </span>
                    {command.hint && (
                      <span className="text-[11px] text-content-tertiary shrink-0">
                        {command.hint}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-[10px] text-content-tertiary">
          <span>↑↓ to navigate · Enter to run</span>
          <span>Ctrl/⌘ + K to toggle</span>
        </div>
      </div>
    </div>
  );
};
