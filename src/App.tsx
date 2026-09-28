import React, { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppLayout } from './components/layout/AppLayout';
import type { NavTab } from './components/layout/Sidebar';
import { CommandPalette } from './components/ui/CommandPalette';
import { Toaster } from './components/ui/Toaster';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { LibraryPage } from './features/library/LibraryPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { ShiftsPage } from './features/shifts/ShiftsPage';
import { FocusPage } from './features/focus/FocusPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AssistantLauncher } from './features/ai/components/AssistantLauncher';
import { AssistantPanel } from './features/ai/components/AssistantPanel';
import { providerIsReady } from './features/ai/aiProviderRepo';
import { useAssistantStore } from './stores/useAssistantStore';
import { useStatusThemeStore } from './stores/useStatusThemeStore';
import { usePomodoroStore } from './stores/usePomodoroStore';
import { initializeDatabaseDefaults } from './db/defaultData';
import { db } from './db/db';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Bumped whenever "New event" runs from the palette; CalendarPage opens
  // its event modal for today when this changes.
  const [quickAddEventNonce, setQuickAddEventNonce] = useState(0);
  const initTheme = useStatusThemeStore((s) => s.initTheme);
  const loadPomodoroSettings = usePomodoroStore((s) => s.loadSettings);
  const refreshAssistantProvider = useAssistantStore((s) => s.refreshProvider);

  // Reactive: true once a default provider exists with base URL, key and model.
  // Keeps the launcher/panel disabled-state correct after Settings edits.
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const providers = useLiveQuery(() => db.aiProviders.toArray());
  useEffect(() => {
    const flagged = (providers ?? []).find((p) => p.isDefault) ?? (providers ?? [])[0];
    setAssistantConfigured(providerIsReady(flagged));
    void refreshAssistantProvider();
  }, [providers, refreshAssistantProvider]);

  // The assistant's "not configured" affordances jump straight to Settings.
  const openAssistantSettings = useCallback(() => {
    setPaletteOpen(false);
    useAssistantStore.getState().setOpen(false);
    setActiveTab('settings');
  }, []);

  // Global Ctrl/Cmd+K shortcut for the command palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNewEventFromPalette = useCallback(() => {
    setActiveTab('calendar');
    setQuickAddEventNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    initializeDatabaseDefaults().then(async () => {
      initTheme();
      // Apply stored pomodoro durations to the timer engine.
      const row = await db.appSettings.get('pomodoro');
      if (row) {
        const { id: _id, ...settings } = row;
        loadPomodoroSettings(settings);
      }
    });
  }, [initTheme, loadPomodoroSettings]);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage onNavigate={(tab) => setActiveTab(tab)} />;
      case 'library':
        return <LibraryPage />;
      case 'calendar':
        return <CalendarPage quickAddNonce={quickAddEventNonce} />;
      case 'shifts':
        return <ShiftsPage />;
      case 'focus':
        return <FocusPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage onNavigate={(tab) => setActiveTab(tab)} />;
    }
  };

  return (
    <AppLayout activeTab={activeTab} onSelectTab={setActiveTab}>
      {renderContent()}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={setActiveTab}
        onNewEvent={handleNewEventFromPalette}
      />

      {/* Global AI assistant: floating launcher (every page) + chat panel. */}
      <AssistantLauncher configured={assistantConfigured} onOpenSettings={openAssistantSettings} />
      <AssistantPanel onOpenSettings={openAssistantSettings} />

      {/* Action confirmations raised by the assistant's function calls. */}
      <Toaster />
    </AppLayout>
  );
};

export default App;
