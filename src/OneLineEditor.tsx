import { useEffect } from 'react';
import { EditorShell } from './components/EditorShell';
import { fitToContentSoon, useKeyboardShortcuts } from './canvas';
import { useLocale, type Locale } from './i18n';
import type { DiagramFile } from './model';
import { useEditorStore } from './store';

export interface OneLineEditorProps {
  className?: string;
  /** Initial DiagramFile to render. Re-renders when this reference changes. */
  diagram?: DiagramFile;
  /** Force a UI language for this editor instance. Re-syncs the global
   *  locale store on change so existing i18n consumers pick it up. Omit
   *  to inherit whatever the persisted store has. */
  locale?: Locale;
  /** Accepted for forward compatibility with embedding apps that want to
   *  toggle dark mode; currently only ``'light'`` is styled, so this is a
   *  no-op the editor accepts without complaint. */
  theme?: 'light' | 'dark';
}

export function OneLineEditor({ className, diagram, locale, theme: _theme }: OneLineEditorProps) {
  useEffect(() => {
    if (locale) useLocale.getState().setLocale(locale);
  }, [locale]);

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

  // Reset the viewport to fit the diagram on first mount — covers both the
  // fresh-seed path above and the case where persisted state rehydrated a
  // diagram from a previous session. `fitToContentSoon` waits a few frames
  // for the canvas DOM to attach.
  useEffect(() => {
    fitToContentSoon();
  }, []);

  useKeyboardShortcuts();

  return (
    <div className={className ?? 'h-full w-full'}>
      <EditorShell />
    </div>
  );
}
