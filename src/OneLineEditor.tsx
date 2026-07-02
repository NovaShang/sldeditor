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
   * Render as a view-only viewer: full pan/zoom/touch gestures and
   * fit-to-content on load are preserved, but every editing interaction and
   * all editing chrome are disabled. In this mode the passed `diagram` always
   * wins over any persisted document, and nothing is written to storage.
   */
  readOnly?: boolean;
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

export function OneLineEditor({ className, diagram, readOnly, locale, theme }: OneLineEditorProps) {
  // Keep the store's view-only flag in sync with the prop. Declared before the
  // seed effect so it runs first (effect order = declaration order) — by the
  // time we force-seed below, storage writes are already suppressed.
  useEffect(() => {
    useEditorStore.getState().setReadOnly(!!readOnly);
  }, [readOnly]);

  useEffect(() => {
    if (!diagram) return;
    if (readOnly) {
      // Viewer: the passed diagram always wins over any persisted document,
      // and we switch to the hand (pan) tool for a clean view-only cursor.
      useEditorStore.getState().setDiagram(diagram);
      useEditorStore.getState().setActiveTool('pan');
      return;
    }
    // Editor: don't clobber persisted/in-progress work on remount or HMR. Only
    // seed the initial diagram if the store is empty (first visit / cleared
    // storage). Consumers wanting to force-replace can call setDiagram
    // imperatively.
    const current = useEditorStore.getState().diagram;
    if (current.elements.length === 0) {
      useEditorStore.getState().setDiagram(diagram);
    }
  }, [diagram, readOnly]);

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
