'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

// ============================================
// Types
// ============================================

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

// ============================================
// Context
// ============================================

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function readStoredTheme(): Theme | null {
  try {
    const storedTheme = window.localStorage.getItem('theme');
    return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null;
  } catch {
    return null;
  }
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem('theme', theme);
  } catch {
    // Theme changes should still work for the current session if storage is unavailable.
  }
}

// ============================================
// Provider Component
// ============================================

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';

    const storedTheme = readStoredTheme();
    if (storedTheme) return storedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const isMounted = useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot);

  // Apply the selected theme without turning the initial system preference into
  // a permanent user preference. Only an explicit user choice is persisted.
  useEffect(() => {
    if (!isMounted) return;

    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme, isMounted]);

  // Follow operating-system theme changes until the user explicitly chooses one.
  useEffect(() => {
    if (!isMounted) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (event: MediaQueryListEvent) => {
      if (!readStoredTheme()) {
        setThemeState(event.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [isMounted]);

  const toggleTheme = () => {
    setThemeState((previous) => {
      const next = previous === 'light' ? 'dark' : 'light';
      storeTheme(next);
      return next;
    });
  };

  const setTheme = (newTheme: Theme) => {
    storeTheme(newTheme);
    setThemeState(newTheme);
  };

  // Prevent flash of the wrong theme during hydration.
  if (!isMounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useTheme() {
  const context = useContext(ThemeContext);

  // Return default values if used outside ThemeProvider.
  if (context === undefined) {
    return {
      theme: 'light' as Theme,
      toggleTheme: () => {},
      setTheme: () => {},
    };
  }

  return context;
}
