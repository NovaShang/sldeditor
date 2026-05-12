import { useEffect } from 'react';
import { EditorShell } from './components/EditorShell';
import { fitToContentSoon, useKeyboardShortcuts } from './canvas';
import type { DiagramFile } from './model';
import { useEditorStore } from './store';
import { useLocale, type Locale } from './i18n';
import { applyTheme, type Theme } from './hooks/use-theme';

export interface OneLineEditorProps {
  className?: string;
  /** Initial DiagramFile to render. Re-renders when this reference changes. */
  diagram?: DiagramFile;
  /**
   * Force the editor's UI language. When omitted, falls back to the user's
   * previous choice (localStorage) or the browser's locale. When set, the
   * embedder owns the language and any change to this prop is mirrored into
   * the locale store.
   */
  locale?: Locale;
  /**
   * Force the editor's color mode. When omitted, uses the user's previous
   * choice or OS `prefers-color-scheme`. Applied via the `dark` class on
   * `<html>` (the standard Tailwind pattern), so embedding hosts that share
   * the same documentElement will see the same class.
   */
  theme?: Theme;
}

export function OneLineEditor({ className, diagram, locale, theme }: OneLineEditorProps) {
  useEffect(() => {
    if (!diagram) return;
    // Don't clobber persisted/in-progress work on remount or HMR. Only seed
    // the initial diagram if the store is empty (first visit / cleared
    // storage). Consumers wanting to force-replace can call setDiagram
    // imperatively.
    const current = useEditorStore.getState().diagram;
    if (current.elements.length === 0) {
      useEditorStore.getState().setDiagram(diagram);
    }
  }, [diagram]);

  useEffect(() => {
    if (locale) useLocale.getState().setLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  // Reset the viewport to fit the diagram on first mount — covers both the
  // fresh-seed path above and the case where persisted state rehydrated a
  // diagram from a previous session. `fitToContentSoon` waits a few frames
  // for the canvas DOM to attach.
  useEffect(() => {
    fitToContentSoon();
  }, []);

  useKeyboardShortcuts();

  return (
    <div className={`ole-root ${className ?? 'h-full w-full'}`}>
      <EditorShell />
    </div>
  );
}
