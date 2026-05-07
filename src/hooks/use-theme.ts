import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ole-theme';

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function persist(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore quota / disabled storage
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/**
 * Resolve the theme to apply at startup. Exported so that `src/demo/main.tsx`
 * can apply the class before React mounts and avoid FOUC.
 *
 * Falls back to the OS `prefers-color-scheme` when no stored preference exists.
 */
export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return readStored() ?? (systemPrefersDark() ? 'dark' : 'light');
}

/** Reflect a `Theme` value onto `<html>`'s class list. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Theme hook.
 *
 * - First visit: matches `prefers-color-scheme`. Continues to follow OS changes
 *   until the user explicitly toggles, after which the explicit choice is
 *   persisted and "owns" the theme.
 * - `setTheme` / `toggle` always persist (they are explicit user actions).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (readStored() == null) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    persist(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      persist(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
