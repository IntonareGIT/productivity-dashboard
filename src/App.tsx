import React, { useState, useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import type { NavTab } from './components/layout/Sidebar';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { LibraryPage } from './features/library/LibraryPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { ShiftsPage } from './features/shifts/ShiftsPage';
import { FocusPage } from './features/focus/FocusPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { useStatusThemeStore } from './stores/useStatusThemeStore';
import { initializeDatabaseDefaults } from './db/defaultData';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const initTheme = useStatusThemeStore((s) => s.initTheme);

  useEffect(() => {
    initializeDatabaseDefaults().then(() => {
      initTheme();
    });
  }, [initTheme]);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage onNavigate={(tab) => setActiveTab(tab)} />;
      case 'library':
        return <LibraryPage />;
      case 'calendar':
        return <CalendarPage />;
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
    </AppLayout>
  );
};

export default App;
