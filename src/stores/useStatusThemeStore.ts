import { create } from 'zustand';
import type { UserStatus, ThemeMode, ColorScheme, ThemeStatusMapping } from '../types';
import { db } from '../db/db';
import { defaultThemeStatusMappings } from '../db/defaultData';

interface StatusThemeState {
  currentStatus: UserStatus;
  currentTheme: ThemeMode;
  colorScheme: ColorScheme;
  mappings: Record<UserStatus, ThemeStatusMapping>;
  setStatus: (status: UserStatus) => Promise<void>;
  toggleColorScheme: () => void;
  updateMapping: (status: UserStatus, theme: ThemeMode, colorScheme: ColorScheme) => Promise<void>;
  initTheme: () => Promise<void>;
}

export const useStatusThemeStore = create<StatusThemeState>((set, get) => ({
  currentStatus: 'Studying',
  currentTheme: 'studying',
  colorScheme: 'dark',
  mappings: {
    Studying: { status: 'Studying', theme: 'studying', colorScheme: 'dark' },
    Working: { status: 'Working', theme: 'working', colorScheme: 'dark' },
    Researching: { status: 'Researching', theme: 'researching', colorScheme: 'dark' },
    Playing: { status: 'Playing', theme: 'playing', colorScheme: 'dark' },
  },

  initTheme: async () => {
    try {
      const stored = await db.themeStatusMap.toArray();
      const mappingsMap: Record<UserStatus, ThemeStatusMapping> = {
        Studying: defaultThemeStatusMappings[0],
        Working: defaultThemeStatusMappings[1],
        Researching: defaultThemeStatusMappings[2],
        Playing: defaultThemeStatusMappings[3],
      };

      if (stored.length > 0) {
        stored.forEach((item) => {
          mappingsMap[item.status] = item;
        });
      } else {
        await db.themeStatusMap.bulkPut(defaultThemeStatusMappings);
      }

      const activeStatus = get().currentStatus;
      const activeMapping = mappingsMap[activeStatus] || mappingsMap.Studying;

      // Apply to HTML element
      document.documentElement.setAttribute('data-theme', activeMapping.theme);
      if (activeMapping.colorScheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }

      set({
        mappings: mappingsMap,
        currentTheme: activeMapping.theme,
        colorScheme: activeMapping.colorScheme,
      });
    } catch (e) {
      console.error('Error initializing theme from Dexie:', e);
    }
  },

  setStatus: async (status: UserStatus) => {
    const { mappings } = get();
    const mapping = mappings[status] || {
      status,
      theme: 'studying',
      colorScheme: 'dark'
    };

    document.documentElement.setAttribute('data-theme', mapping.theme);
    if (mapping.colorScheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }

    set({
      currentStatus: status,
      currentTheme: mapping.theme,
      colorScheme: mapping.colorScheme,
    });
  },

  toggleColorScheme: () => {
    const { currentStatus, currentTheme, colorScheme, mappings } = get();
    const nextScheme: ColorScheme = colorScheme === 'dark' ? 'light' : 'dark';

    if (nextScheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }

    const updatedMapping: ThemeStatusMapping = {
      status: currentStatus,
      theme: currentTheme,
      colorScheme: nextScheme,
    };

    const newMappings = {
      ...mappings,
      [currentStatus]: updatedMapping,
    };

    // Save to Dexie
    db.themeStatusMap.put(updatedMapping).catch(console.error);

    set({
      colorScheme: nextScheme,
      mappings: newMappings,
    });
  },

  updateMapping: async (status: UserStatus, theme: ThemeMode, colorScheme: ColorScheme) => {
    const newMapping: ThemeStatusMapping = { status, theme, colorScheme };
    await db.themeStatusMap.put(newMapping);

    const { currentStatus } = get();
    const updatedMappings = {
      ...get().mappings,
      [status]: newMapping,
    };

    if (currentStatus === status) {
      document.documentElement.setAttribute('data-theme', theme);
      if (colorScheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }
      set({
        mappings: updatedMappings,
        currentTheme: theme,
        colorScheme,
      });
    } else {
      set({ mappings: updatedMappings });
    }
  },
}));
