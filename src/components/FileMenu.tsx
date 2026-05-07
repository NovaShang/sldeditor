/**
 * File menu — New / Open / Save / Save As, plus ⌘O / ⌘S / ⌘⇧S keyboard
 * shortcuts. Renders as a dropdown button. Self-contained: reads/writes the
 * editor store directly and prompts the OS file picker (FS Access API where
 * available, hidden input fallback otherwise).
 *
 * Exported from the library so that embedding apps that want a "local file"
 * mode without backend can drop it into their own toolbar.
 */

import {
  FilePlus,
  FolderOpen,
  Save,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fitToContentSoon } from '../canvas';
import { Button } from './ui/button';
import { useT } from '../i18n';
import { openDiagram, saveDiagram } from '../lib/file-io';
import { useEditorStore } from '../store';

export function FileMenu() {
  const t = useT();
  const fileSession = useEditorStore((s) => s.fileSession);
  const fileLabel = fileSession?.name ?? t('common.unnamed');
  const { onNew, onOpen, onSave, onSaveAs } = useFileActions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        onOpen();
      } else if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) onSaveAs();
        else onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen, onSave, onSaveAs]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <FolderOpen />
        {t('topbar.file.label')}
      </Button>
      {open && (
        <div
          role="menu"
          className="ole-glass absolute left-0 top-full mt-1.5 min-w-44 rounded-md border border-border p-1 shadow-md"
        >
          <div className="border-b border-border px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
            {fileLabel}
          </div>
          <MenuItem onClick={run(onNew)} icon={<FilePlus />}>
            {t('topbar.file.new')}
          </MenuItem>
          <MenuItem onClick={run(onOpen)} icon={<FolderOpen />} hint="⌘O">
            {t('topbar.file.open')}
          </MenuItem>
          <MenuItem onClick={run(onSave)} icon={<Save />} hint="⌘S">
            {t('topbar.file.save')}
          </MenuItem>
          <MenuItem onClick={run(onSaveAs)} icon={<Save />} hint="⌘⇧S">
            {t('topbar.file.saveAs')}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  hint,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground [&>svg]:size-4"
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hint && (
        <span className="text-xs tabular-nums text-muted-foreground">{hint}</span>
      )}
    </button>
  );
}

function useFileActions() {
  const t = useT();
  const loadDiagramFromFile = useEditorStore((s) => s.loadDiagramFromFile);
  const setFileSession = useEditorStore((s) => s.setFileSession);
  const setDiagram = useEditorStore((s) => s.setDiagram);

  const onNew = () => {
    const { diagram } = useEditorStore.getState();
    if (diagram.elements.length > 0) {
      const ok = confirm(t('topbar.file.newConfirm'));
      if (!ok) return;
    }
    setDiagram({ version: '1', elements: [] });
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

  return { onNew, onOpen, onSave, onSaveAs };
}
