import * as React from 'react';

// A tiny class-based theme provider (no next-themes dependency). It writes `.dark` onto <html> so the
// CSS-variable token sets in index.css switch, persists the choice, and follows the OS when set to
// 'system'. The initial class is applied by an inline script in index.html to avoid a flash.

export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'wfi-theme';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

// Storage and matchMedia can throw (Safari private mode, embedded webviews, storage disabled). The
// inline script in index.html already guards the same access; mirror that here so the provider can
// never crash the app at mount — theme just falls back to 'system'/light and won't persist.
function readStoredTheme(): Theme | null {
  try {
    return localStorage.getItem(STORAGE_KEY) as Theme | null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage unavailable — the choice applies for this session but won't survive a reload.
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

function applyThemeClass(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => readStoredTheme() ?? 'system');
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() => resolve(theme));

  React.useEffect(() => {
    const resolved = resolve(theme);
    setResolvedTheme(resolved);
    applyThemeClass(resolved);

    if (theme !== 'system') return;
    // Follow the OS while on 'system': re-resolve whenever the media query flips. matchMedia may be
    // unavailable (see systemTheme) — if so, skip the listener; the 'system' resolve above still ran.
    let media: MediaQueryList;
    try {
      media = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = () => {
      const next = systemTheme();
      setResolvedTheme(next);
      applyThemeClass(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    writeStoredTheme(next);
    setThemeState(next);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
