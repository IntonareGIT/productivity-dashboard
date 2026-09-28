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
import { AssistantPage } from './features/ai/components/AssistantPage';
import { providerIsReady } from './features/ai/aiProviderRepo';
import { useAssistantStore } from './stores/useAssistantStore';
import { useStatusThemeStore } from './stores/useStatusThemeStore';
import { usePomodoroStore } from './stores/usePomodoroStore';
import { initializeDatabaseDefaults } from './db/defaultData';
import { db } from './db/db';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // True while the full-page assistant (/assistant) is shown.
  const [assistantPage, setAssistantPage] = useState(false);
  // Tab to restore when leaving the full-page assistant.
  const [returnTab, setReturnTab] = useState<NavTab>('dashboard');
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
    setAssistantPage(false);
    useAssistantStore.getState().setOpen(false);
    setActiveTab('settings');
  }, []);

  // Expand the bubble into the full-page assistant, remembering where to return.
  const openAssistantPage = useCallback(() => {
    setReturnTab(activeTab);
    setPaletteOpen(false);
    useAssistantStore.getState().setOpen(true);
    setAssistantPage(true);
    window.history.pushState({ assistant: true }, '', '/assistant');
  }, [activeTab]);

  const closeAssistantPage = useCallback(() => {
    setAssistantPage(false);
    setActiveTab(returnTab);
  }, [returnTab]);

  // Collapse the full page back into the floating bubble.
  const collapseToBubble = useCallback(() => {
    setAssistantPage(false);
    setActiveTab(returnTab);
    useAssistantStore.getState().setOpen(true);
  }, [returnTab]);

  // Browser back closes the full-page assistant rather than leaving the app.
  useEffect(() => {
    const onPop = () => {
      if (assistantPage) {
        setAssistantPage(false);
        setActiveTab(returnTab);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [assistantPage, returnTab]);

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
    // Seeding is gated on sign-in state (see defaultData.ts):
    //  - never signed in  -> seed now, a fresh local start
    //  - signed in         -> wait for the first sync to finish, so this device
    //                         can only fill gaps, never overwrite synced rows.
    const applySettings = async () => {
      initTheme();
      // Apply stored pomodoro durations to the timer engine.
      const row = await db.appSettings.get('pomodoro');
      if (row) {
        const { id: _id, ...settings } = row;
        loadPomodoroSettings(settings);
      }
    };

    const cloud = db.cloud;
    if (!cloud) {
      // No addon (should not happen) or no config: plain local start.
      initializeDatabaseDefaults().then(applySettings);
      return;
    }

    // `currentUserId` is a non-empty string even for the anonymous realm, so
    // the real test is the addon's isLoggedIn flag.
    if (!cloud.currentUser?.value?.isLoggedIn) {
      // Not logged in (anonymous): safe to seed defaults locally.
      initializeDatabaseDefaults().then(applySettings);
      return;
    }

    // Signed in. Wait for the first sync to complete before seeding, so a
    // device that just signed in pulls the account's settings first.
    let cancelled = false;
    const sub = cloud.events.syncComplete.subscribe(async () => {
      if (cancelled) return;
      await initializeDatabaseDefaults();
      await applySettings();
    });
    // Safety net: seed gaps once the DB is open even if offline, so a signed-in
    // user is never left without the theme/pomodoro defaults. Because seeding
    // is insert-if-missing, synced rows always win on the next successful sync.
    initializeDatabaseDefaults().then(applySettings);
    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
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
      {assistantPage ? (
        <AssistantPage
          onOpenSettings={openAssistantSettings}
          onExit={closeAssistantPage}
          onCollapse={collapseToBubble}
        />
      ) : (
        <>
          {renderContent()}
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            onNavigate={setActiveTab}
            onNewEvent={handleNewEventFromPalette}
          />

          {/* Global AI assistant: floating launcher (every page) + chat panel. */}
          <AssistantLauncher configured={assistantConfigured} onOpenSettings={openAssistantSettings} />
          <AssistantPanel onOpenSettings={openAssistantSettings} onExpand={openAssistantPage} />

          {/* Action confirmations raised by the assistant's function calls. */}
          <Toaster />
        </>
      )}
    </AppLayout>
  );
};

export default App;
