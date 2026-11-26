/**
 * The File menu's actions and shortcuts, split out of `FileMenu` so a host
 * can render the menu in its own design system (see `FileMenu`).
 */

import { useEffect } from 'react';
import { fitToContentSoon } from '../canvas';
import { useT } from '../i18n';
import { openDiagram, saveDiagram } from '../lib/file-io';
import { useEditorStore } from '../store';

export interface FileActions {
  onNew: () => void;
  onOpen: () => Promise<void>;
  onSave: () => Promise<void>;
  onSaveAs: () => Promise<void>;
  /** The open file's name, or the editor's "Unnamed". */
  fileName: string;
  /** Menu labels in the editor's current locale. */
  labels: { file: string; new: string; open: string; save: string; saveAs: string };
}

/**
 * The File menu's actions — New (confirming before it discards a drawing),
 * Open / Save / Save As through the OS file picker — with their labels in the
 * editor's locale, for a host that renders the menu in its own design system.
 */
export function useFileActions(): FileActions {
  const t = useT();
  const fileSession = useEditorStore((s) => s.fileSession);
  const loadDiagramFromFile = useEditorStore((s) => s.loadDiagramFromFile);
  const setFileSession = useEditorStore((s) => s.setFileSession);
  const setDiagram = useEditorStore((s) => s.setDiagram);

  const onNew = () => {
    const { diagram } = useEditorStore.getState();
    if (diagram.elements.length > 0) {
      const ok = confirm(t('topbar.file.newConfirm'));
      if (!ok) return;
    }
    // A new drawing hops its wire crossings; a drawing that predates the
    // setting keeps the look it was made with (absent = off).
    setDiagram({ version: '1', meta: { wireHops: true }, elements: [] });
    setFileSession(null);
  };

  const onOpen = async () => {
    try {
      const result = await openDiagram();
      if (result) {
        loadDiagramFromFile(result.diagram, result.session);
        fitToContentSoon();
      }
    } catch (e) {
      alert(t('topbar.file.openFailed', { err: (e as Error).message }));
    }
  };

  const onSave = async () => {
    try {
      const { diagram, fileSession } = useEditorStore.getState();
      const session = await saveDiagram(diagram, fileSession);
      if (session) setFileSession(session);
    } catch (e) {
      alert(t('topbar.file.saveFailed', { err: (e as Error).message }));
    }
  };

  const onSaveAs = async () => {
    try {
      const { diagram, fileSession } = useEditorStore.getState();
      const session = await saveDiagram(diagram, fileSession, { saveAs: true });
      if (session) setFileSession(session);
    } catch (e) {
      alert(t('topbar.file.saveFailed', { err: (e as Error).message }));
    }
  };

  return {
    onNew,
    onOpen,
    onSave,
    onSaveAs,
    fileName: fileSession?.name ?? t('common.unnamed'),
    labels: {
      file: t('topbar.file.label'),
      new: t('topbar.file.new'),
      open: t('topbar.file.open'),
      save: t('topbar.file.save'),
      saveAs: t('topbar.file.saveAs'),
    },
  };
}

/** ⌘O / ⌘S / ⌘⇧S (Ctrl on other platforms) for `actions`. Mount once. */
export function useFileShortcuts(
  actions: Pick<FileActions, 'onOpen' | 'onSave' | 'onSaveAs'>,
): void {
  const { onOpen, onSave, onSaveAs } = actions;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        void onOpen();
      } else if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) void onSaveAs();
        else void onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen, onSave, onSaveAs]);
}
