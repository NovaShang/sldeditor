/**
 * Tiny i18n primitive — Zustand-backed locale + key-based translation.
 *
 * Mirrors `usePanels` / `useTheme` patterns: a single store, localStorage
 * persistence, and a `useT()` hook for components plus a non-hook `t()`
 * for code outside React (compiler/file-io error messages).
 *
 * Substitution: `{name}` in a template is replaced with `params[name]`.
 */

import { create } from 'zustand';
import { messages, type Locale, type LocaleKey } from './messages';

export type { Locale, LocaleKey };

const STORAGE_KEY = 'ole-locale';

function readInitial(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'zh' || raw === 'en') return raw;
  } catch {
    // ignore
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  return 'zh';
}

function persist(loc: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, loc);
  } catch {
    // ignore quota / disabled storage
  }
}

interface LocaleState {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  toggle: () => void;
}

export const useLocale = create<LocaleState>((set, get) => ({
  locale: readInitial(),
  setLocale: (locale) => {
    persist(locale);
    set({ locale });
  },
  toggle: () => {
    const next = get().locale === 'zh' ? 'en' : 'zh';
    persist(next);
    set({ locale: next });
  },
}));

type Params = Record<string, string | number>;

function format(tmpl: string, params?: Params): string {
  if (!params) return tmpl;
  return tmpl.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

function lookup(locale: Locale, key: LocaleKey): string {
  return messages[locale][key] ?? messages.zh[key] ?? key;
}

/** Translate from a non-React context. Reads the current locale from the store. */
export function t(key: LocaleKey, params?: Params): string {
  return format(lookup(useLocale.getState().locale, key), params);
}

/** Hook for components: returns a translator bound to the current locale. */
export function useT(): (key: LocaleKey, params?: Params) => string {
  const locale = useLocale((s) => s.locale);
  return (key, params) => format(lookup(locale, key), params);
}
