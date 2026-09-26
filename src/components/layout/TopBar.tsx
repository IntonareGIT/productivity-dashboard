import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { 
  Sun, 
  Moon, 
  ChevronDown, 
  BookOpen, 
  Briefcase, 
  Search, 
  Gamepad2 
} from 'lucide-react';
import { useStatusThemeStore } from '../../stores/useStatusThemeStore';
import type { UserStatus } from '../../types';

export const TopBar: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { currentStatus, setStatus, colorScheme, toggleColorScheme } = useStatusThemeStore();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const statuses: { label: UserStatus; icon: React.ReactNode; color: string }[] = [
    { label: 'Studying', icon: <BookOpen className="w-3.5 h-3.5" />, color: 'bg-indigo-500' },
    { label: 'Working', icon: <Briefcase className="w-3.5 h-3.5" />, color: 'bg-zinc-500' },
    { label: 'Researching', icon: <Search className="w-3.5 h-3.5" />, color: 'bg-teal-500' },
    { label: 'Playing', icon: <Gamepad2 className="w-3.5 h-3.5" />, color: 'bg-amber-500' },
  ];

  const currentStatusObj = statuses.find((s) => s.label === currentStatus) || statuses[0];

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

      {/* Right side: Status Selector Pill & Color Mode Toggle */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Status Dropdown Pill */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium bg-bg-elevated hover:bg-border transition-colors border border-border"
          >
            <span className={`w-2 h-2 rounded-full ${currentStatusObj.color}`} />
            <span className="text-content-primary">{currentStatus}</span>
            <ChevronDown className="w-3.5 h-3.5 text-content-secondary" />
          </button>

          {dropdownOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setDropdownOpen(false)} 
              />
              <div className="absolute right-0 mt-1.5 w-40 bg-bg-surface border border-border rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-content-tertiary">
                  Current Status
                </div>
                {statuses.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setStatus(item.label);
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center space-x-2.5 transition-colors ${
                      currentStatus === item.label
                        ? 'bg-accent-subtle text-accent-text font-medium'
                        : 'text-content-secondary hover:bg-bg-elevated hover:text-content-primary'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${item.color}`} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Light/Dark Toggle */}
        <button
          onClick={toggleColorScheme}
          aria-label="Toggle Light/Dark Theme"
          className="p-1.5 rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors border border-transparent hover:border-border"
        >
          {colorScheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700" />
          )}
        </button>
      </div>
    </header>
  );
};
